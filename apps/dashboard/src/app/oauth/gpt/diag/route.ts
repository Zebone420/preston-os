import { NextResponse } from 'next/server';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import {
  buildCredentialProbe,
  classifyCredentialProbe,
  configuredCallback,
  upstreamErrorTag,
} from '@/lib/preston-control/gpt-bridge';
import { publicOrigin } from '@/lib/preston-control/metadata';

// Preston Control - GPT bridge diagnostics. OWNER SESSION ONLY: /oauth/gpt/*
// is excluded from the cookie proxy gate, so the owner check is done here via
// resolveOwner() (dashboard session + allowlist).
// Reports configuration CONSISTENCY, never values: whether the stored client
// credentials authenticate at Supabase (probed with a bogus refresh token),
// the configured callback/origin, and the bridge's enabled state.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  const ctx = await resolveOwner();
  if (!ctx) return NextResponse.json({ ok: false, status: 'owner_required' }, { status: 403 });
  if (!controlSurfaceEnabled(env, 'gpt')) {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 404 });
  }
  const probe = buildCredentialProbe(env);
  let credentials: 'valid' | 'invalid' | 'unknown' | 'unconfigured' = 'unconfigured';
  let upstream_tag: string | null = null;
  let upstream_status: number | null = null;
  if (probe) {
    try {
      const r = await fetch(probe.url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: probe.body.toString(),
      });
      let json: unknown = null;
      try { json = await r.json(); } catch { json = null; }
      upstream_status = r.status;
      upstream_tag = r.ok ? null : upstreamErrorTag(json);
      credentials = classifyCredentialProbe(r.status, json);
    } catch {
      credentials = 'unknown';
    }
  }
  return NextResponse.json({
    ok: true,
    bridge_configured: Boolean(probe),
    public_origin: publicOrigin(request, env),
    callback_url: configuredCallback(env),
    client_id_suffix: String(env['PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID'] ?? '').slice(-6),
    credentials,
    upstream_status,
    upstream_tag,
  }, { headers: { 'cache-control': 'no-store' } });
}
