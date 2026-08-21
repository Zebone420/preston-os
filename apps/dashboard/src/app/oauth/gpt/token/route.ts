import { NextResponse } from 'next/server';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import { buildTokenForward, filterTokenResponse, upstreamErrorTag } from '@/lib/preston-control/gpt-bridge';
import { publicOrigin } from '@/lib/preston-control/metadata';

// Preston Control - GPT Actions PKCE bridge: token endpoint. ChatGPT's
// servers POST here (authorization_code with the composite code, or
// refresh_token). Client credentials are verified in constant time, the PKCE
// verifier is re-derived, and the exchange is forwarded to Supabase. Only
// access_token / refresh_token / expires_in / token_type / scope pass back.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  if (!controlSurfaceEnabled(env, 'gpt')) {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  const clRaw = request.headers.get('content-length');
  const n = clRaw === null ? null : Number(clRaw);
  if (n === null || Number.isNaN(n) || n > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 413 });
  }
  let form: Record<string, string | undefined>;
  try {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = (await request.json()) as Record<string, unknown>;
      form = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
    } else {
      form = Object.fromEntries(new URLSearchParams(await request.text()).entries());
    }
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const out = buildTokenForward(env, form, request.headers.get('authorization'), publicOrigin(request, env));
  if (!out.ok) {
    // Operator diagnostic: booleans/lengths only (see ClientAuthDiagnostic);
    // never the presented or configured values. This is the ONLY log line in
    // the Preston Control adapter and the audit suite pins its shape.
    if (out.diag) console.warn('[preston-control:gpt-token] client_auth_failed ' + JSON.stringify(out.diag));
    return NextResponse.json({ error: out.error }, { status: out.status });
  }

  let upstream: Response;
  try {
    upstream = await fetch(out.forward.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: out.forward.body.toString(),
    });
  } catch {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503 });
  }
  let json: unknown = null;
  try { json = await upstream.json(); } catch { json = null; }
  if (!upstream.ok) {
    // Supabase Auth answers in two shapes: OAuth ({error}) and GoTrue
    // ({error_code, msg}). Surface only the sanitized TAG (never msg/body).
    return NextResponse.json({ error: upstreamErrorTag(json) }, { status: 400 });
  }
  const filtered = filterTokenResponse(json);
  if (!filtered) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  return NextResponse.json(filtered, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
}
