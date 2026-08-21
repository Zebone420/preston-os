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
// credentials authenticate at Supabase (probed with a bogus refresh token,
// via client_secret_post - what the bridge uses - and HTTP Basic for
// comparison), the configured callback/origin, and the bridge's state.
export const dynamic = 'force-dynamic';

interface ProbeResult {
  credentials: 'valid' | 'invalid' | 'unknown' | 'unconfigured';
  upstream_status: number | null;
  upstream_tag: string | null;
}

async function runProbe(env: Record<string, string | undefined>, method: 'post' | 'basic'): Promise<ProbeResult> {
  const probe = buildCredentialProbe(env, method);
  if (!probe) return { credentials: 'unconfigured', upstream_status: null, upstream_tag: null };
  try {
    const r = await fetch(probe.url, { method: 'POST', headers: probe.headers, body: probe.body.toString() });
    let json: unknown = null;
    try { json = await r.json(); } catch { json = null; }
    return {
      credentials: classifyCredentialProbe(r.status, json),
      upstream_status: r.status,
      upstream_tag: r.ok ? null : upstreamErrorTag(json),
    };
  } catch {
    return { credentials: 'unknown', upstream_status: null, upstream_tag: null };
  }
}

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  const ctx = await resolveOwner();
  if (!ctx) return NextResponse.json({ ok: false, status: 'owner_required' }, { status: 403 });
  if (!controlSurfaceEnabled(env, 'gpt')) {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 404 });
  }
  const post = await runProbe(env, 'post');
  const basic = await runProbe(env, 'basic');
  return NextResponse.json({
    ok: true,
    bridge_configured: buildCredentialProbe(env) !== null,
    public_origin: publicOrigin(request, env),
    callback_url: configuredCallback(env),
    client_id_suffix: String(env['PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID'] ?? '').slice(-6),
    // 'post' is the method the bridge forwards with; 'basic' is informational.
    credentials: post.credentials,
    upstream_status: post.upstream_status,
    upstream_tag: post.upstream_tag,
    methods: { post, basic },
  }, { headers: { 'cache-control': 'no-store' } });
}
