import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/ai-os/telegram-security';
import { getServerSupabase } from '@/lib/supabase/server';

// Preston AI OS - Phase 8 Remote Operations V1: remote STATUS retrieval.
// DISABLED by default. Bearer-token authenticated (constant-time),
// cookie-less, staging-only. Read-only: forwards to the 0011 SECURITY
// DEFINER read gateway, which re-authenticates the token and returns a
// BOUNDED projection of one request's goals, jobs, evidence refs, and open
// approvals - enough for a remote caller (phone/ChatGPT) to follow progress
// and see when an owner approval is pending. Never secrets, never
// unrelated rows.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;

  if (env['REMOTE_INTAKE_ENABLED'] !== 'true') {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
  }
  const token = env['REMOTE_INTAKE_TOKEN'];
  if (!token || env['SUPABASE_RUNTIME_ENV'] !== 'staging') {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!presented || !constantTimeEqual(presented, token)) {
    return NextResponse.json({ ok: false, status: 'forbidden' }, { status: 401 });
  }

  const requestId = new URL(request.url).searchParams.get('request_id') ?? '';
  if (!requestId || requestId.length > 64) {
    return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }
  const rpc = (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }).rpc;
  const res = await rpc.call(supabase, 'read_remote_intake_status', {
    p_token: presented,
    p_request_id: requestId,
  });
  if (res.error) {
    return NextResponse.json({ ok: false, status: 'unavailable' }, { status: 503 });
  }
  const out = (res.data ?? {}) as Record<string, unknown>;
  const status = String(out.status ?? 'error');
  const httpStatus =
    out.ok === true ? 200 :
    status === 'forbidden' ? 401 :
    status === 'not_found' ? 404 :
    status === 'disabled' ? 503 : 400;
  return NextResponse.json(out, { status: httpStatus });
}
