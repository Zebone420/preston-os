import { NextResponse } from 'next/server';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import { buildAuthorizeRedirect } from '@/lib/preston-control/gpt-bridge';
import { publicOrigin } from '@/lib/preston-control/metadata';

// Preston Control - GPT Actions PKCE bridge: authorization endpoint. The
// Custom GPT sends the owner's browser here; we add PKCE and forward to the
// Supabase Auth OAuth server, which takes the owner through /oauth/consent.
// Stateless; nothing is stored. Disabled with the rest of the surface.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  if (!controlSurfaceEnabled(env, 'gpt')) {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  const q = Object.fromEntries(new URL(request.url).searchParams.entries());
  const out = buildAuthorizeRedirect(env, q, publicOrigin(request, env));
  if (!out.ok) {
    return NextResponse.json({ error: out.error }, { status: out.error === 'unconfigured' ? 503 : 400 });
  }
  return NextResponse.redirect(out.location, 302);
}
