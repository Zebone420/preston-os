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
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
