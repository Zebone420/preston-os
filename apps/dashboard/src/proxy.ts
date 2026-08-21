import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { evaluateOwnerGate, isAuthConfigured } from './lib/owner-auth';

// Owner auth gate (Next 16 proxy convention, replaces middleware.ts).
// Thin adapter: all decisions live in lib/owner-auth.ts (unit-tested).
// FAIL-CLOSED SETUP MODE (Phase 1B owner-login gate): when the Supabase
// auth env is not configured, every matched path except /login redirects
// to /login, which renders a safe setup notice and no data. Enforcement
// with real sessions activates the moment the owner sets the Supabase
// env values AND OWNER_EMAIL_ALLOWLIST (empty allowlist blocks everyone).
export async function proxy(request: NextRequest) {
  const env = process.env;
  const path = request.nextUrl.pathname;

  let response = NextResponse.next({ request });
  let userEmail: string | null = null;

  if (isAuthConfigured(env)) {
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL as string,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
  }

  const decision = evaluateOwnerGate({ path, userEmail, env });
  if (decision === 'allow') return response;

  const to = request.nextUrl.clone();
  // 'home' sends a signed-in owner away from /login; every blocked
  // state ('setup', 'login', 'deny') lands on the safe /login surface.
  to.pathname = decision === 'home' ? '/' : '/login';
  to.search = '';
  // Preston Control OAuth consent: an unauthenticated owner arriving from
  // the Supabase OAuth server must come BACK to the consent page (with its
  // authorization_id) after signing in. Only that one same-origin path is
  // carried; the login page re-validates it (lib/preston-control/consent).
  if (decision === 'login' && path === '/oauth/consent') {
    to.searchParams.set('next', path + request.nextUrl.search);
  }
  return NextResponse.redirect(to);
}

export const config = {
  // api/os/chatgpt, api/os/remote/*, and api/os/ssot/* are excluded
  // alongside api/health: they are server-to-server bearer-token routes
  // (Phase 5J / Phase 8 / SSOT B3) that self-authenticate inside their
  // handlers (constant-time token compare; the remote routes are ALSO
  // re-authenticated by the 0011 DB gateway's stored token hash, and the
  // ssot route delegates auth entirely to the 0012/0013 gateways). /mcp
  // (Preston Control, OAuth bearer-authenticated inside the handler) and
  // /api/control/* (the same tools as a Custom GPT Actions facade),
  // /oauth/gpt/* (its PKCE bridge; ChatGPT-driven, cookie-less) and
  // /.well-known/ (public RFC 9728 metadata) are excluded for the same
  // reason. They
  // carry no owner session cookie, so the cookie-session redirect must
  // never intercept them (that would return an HTML redirect instead of
  // the routes' own fail-closed JSON 503/401). The ssot route is inert
  // until SSOT_STATUS_ENABLED=true (an owner gate).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/os/chatgpt|api/os/remote|api/os/ssot|api/control|oauth/gpt/|mcp$|\\.well-known/).*)'],
};
