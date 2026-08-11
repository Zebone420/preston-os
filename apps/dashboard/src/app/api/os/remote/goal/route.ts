import { NextResponse } from 'next/server';
import { remoteSurfaceEnvAllowed } from '@/lib/ai-os/remote-surface-env';
import { getServerSupabase } from '@/lib/supabase/server';

// Preston AI OS - Phase 8 Remote Operations V1: remote GOAL submission.
// DISABLED by default. Server-to-server, cookie-less (proxy exclusion),
// env-allowlisted (staging/production per the P1 gate), size-capped
// header-first.
//
// AUTHENTICATION IS FULLY DELEGATED to the SECURITY DEFINER gateway
// (submit_remote_intake): since 0014 it authenticates the presented
// bearer against the legacy global token hash OR an enabled
// actor_registry row (resolve_ssot_actor), stamping actor_id on actor
// submissions. The web tier holds NO token material and performs NO
// comparison - an S4 live defect (2026-08-11) showed the previous
// web-tier equality gate against REMOTE_INTAKE_TOKEN silently blocked
// every valid actor token before it could reach the gateway. Same
// delegate-to-DB shape as /api/os/ssot/status.
//
// This route performs REQUEST RECORDING ONLY. It cannot write the goal
// graph: the gateway applies backpressure and inserts ONE bounded request
// row. The staging host runtime consumes rows through the owner-equivalent
// composer pipeline (validation, risk policy, approval gating) on its next
// tick. No shell, no git, no enqueue, no execution field, no approval is
// ever produced here.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

interface RemoteGoalBody {
  request_id?: unknown;
  owner_identity?: unknown;
  request?: unknown;
  source?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function POST(request: Request) {
  const env = process.env as Record<string, string | undefined>;

  if (env['REMOTE_INTAKE_ENABLED'] !== 'true') {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
  }
  if (!remoteSurfaceEnvAllowed(env['SUPABASE_RUNTIME_ENV'])) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  const clRaw = request.headers.get('content-length');
  const contentLength = clRaw === null ? null : Number(clRaw);
  if (contentLength === null || Number.isNaN(contentLength) || contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, status: 'too_large' }, { status: 413 });
  }

  // Presence-only gate: a missing/empty bearer never reaches the DB. The
  // VALUE is verified exclusively by the gateway (hash compare, both legs).
  const authHeader = request.headers.get('authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!presented) {
    return NextResponse.json({ ok: false, status: 'forbidden' }, { status: 401 });
  }

  let body: RemoteGoalBody;
  try {
    body = (await request.json()) as RemoteGoalBody;
  } catch {
    return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  // The gateway re-authenticates the token against its stored hash; a
  // mismatch between web-tier env and DB config fails closed at the RPC.
  const rpc = (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }).rpc;
  const res = await rpc.call(supabase, 'submit_remote_intake', {
    p_token: presented,
    p_request_id: str(body.request_id).trim(),
    p_owner_identity: str(body.owner_identity).trim(),
    p_raw_request: str(body.request),
    p_source: str(body.source).trim() || 'chatgpt',
  });
  if (res.error) {
    // Never pass raw DB errors through (0011 absent, outage, etc.).
    return NextResponse.json({ ok: false, status: 'unavailable' }, { status: 503 });
  }
  const out = (res.data ?? {}) as Record<string, unknown>;
  const status = String(out.status ?? 'error');
  const httpStatus =
    status === 'accepted' || status === 'duplicate' ? 200 :
    status === 'forbidden' ? 401 :
    status === 'disabled' ? 503 :
    status === 'backpressure' ? 429 : 400;
  return NextResponse.json(out, { status: httpStatus });
}
