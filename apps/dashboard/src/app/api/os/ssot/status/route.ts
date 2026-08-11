import { NextResponse } from 'next/server';
import { remoteSurfaceEnvAllowed } from '@/lib/ai-os/remote-surface-env';
import { getServerSupabase } from '@/lib/supabase/server';

// Preston AI OS - Central SSOT B3: canonical status read surface.
// DISABLED by default (SSOT_STATUS_ENABLED must be exactly 'true').
// Cookie-less, env-allowlisted (P1 gate), read-only. Unlike
// /api/os/remote/status there
// is NO env token to compare against: identity is PER-ACTOR, held only as
// sha256 hashes in actor_registry (migration 0012), so authentication is
// fully delegated to the 0013 SECURITY DEFINER gateway, which resolves the
// bearer token through resolve_ssot_actor (the single token-auth path) and
// returns the bounded canonical projection. The route contributes the
// fail-closed gates it CAN enforce header-first: enabled flag, staging
// pin, bearer presence + length cap. Never secrets, never writes.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;

  if (env['SSOT_STATUS_ENABLED'] !== 'true') {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
  }
  if (!remoteSurfaceEnvAllowed(env['SUPABASE_RUNTIME_ENV'])) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!presented || presented.length > 128) {
    return NextResponse.json({ ok: false, status: 'forbidden' }, { status: 401 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }
  const rpc = (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }).rpc;
  const res = await rpc.call(supabase, 'read_ssot_status', { p_token: presented });
  if (res.error) {
    return NextResponse.json({ ok: false, status: 'unavailable' }, { status: 503 });
  }
  const out = (res.data ?? {}) as Record<string, unknown>;
  const status = String(out.status ?? 'error');
  const httpStatus =
    out.ok === true ? 200 :
    status === 'forbidden' ? 401 :
    status === 'disabled' ? 503 : 400;
  return NextResponse.json(out, { status: httpStatus });
}
