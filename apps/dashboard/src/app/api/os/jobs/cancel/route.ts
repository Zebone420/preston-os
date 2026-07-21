import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { cancelJob } from '@/lib/ai-os/controlplane';

// Owner-only job-cancel request (Phase 5J). POST { job_id, correlation_id,
// reason? } flags ONE job cancel_requested=true - it never executes, leases,
// or transitions the job itself; the worker/dispatcher loop remains solely
// responsible for observing the flag and stopping at its own next safe
// checkpoint. Owner re-checked server-side; job_id is uuid-validated; the
// write is audited (YELLOW, job_cancel_requested). Idempotent: cancelling an
// already cancel_requested job returns ok:true with already:true and writes
// no second audit entry.
export const dynamic = 'force-dynamic';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export async function POST(request: Request) {
  const ctx = await resolveOwner();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'owner authorization required' },
      { status: 401 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const result = await cancelJob(depsFrom(ctx), {
    ownerEmail: ctx.ownerEmail,
    jobId: str(body['job_id']),
    correlation_id: str(body['correlation_id']),
    reason: body['reason'] ? str(body['reason']) : undefined,
  });

  const status = result.ok
    ? 200
    : result.code === 'denied'
      ? 403
      : result.code === 'unknown_job'
        ? 404
        : 400;
  return NextResponse.json(
    { ...result, already: result.code === 'already_requested' },
    { status },
  );
}
