import { NextResponse } from 'next/server';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import { buildCallbackRedirect } from '@/lib/preston-control/gpt-bridge';

// Preston Control - GPT Actions PKCE bridge: Supabase redirects the owner's
// browser here with (code, state). The signed state names the exact ChatGPT
// callback; the composite code carries the PKCE nonce. No token is involved.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  if (!controlSurfaceEnabled(env, 'gpt')) {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  const q = Object.fromEntries(new URL(request.url).searchParams.entries());
  const out = buildCallbackRedirect(env, q);
  if (out.ok || out.location) return NextResponse.redirect(out.location!, 302);
  return NextResponse.json({ error: out.error }, { status: out.error === 'unconfigured' ? 503 : 400 });
}
