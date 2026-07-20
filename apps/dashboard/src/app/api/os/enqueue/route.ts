import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { enqueueStagingJob } from '@/lib/ai-os/controlplane';

// Owner-only staging job enqueue (Phase 5D). Turns an existing GREEN command
// PROPOSAL into one QUEUED staging job - nothing more. No execution, no lease,
// no activation; execution_enabled stays false on the written row. Owner is
// re-checked server-side; production-marked commands are rejected; the write
// is audited and idempotent (a replayed idempotency_key returns 'duplicate'
// and creates nothing).
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

  const result = await enqueueStagingJob(depsFrom(ctx), {
    ownerEmail: ctx.ownerEmail,
    jobId: crypto.randomUUID(),
    command_id: str(body['command_id']),
    approval_id: str(body['approval_id']),
    correlation_id: str(body['correlation_id']),
    idempotency_key: str(body['idempotency_key']),
    priority: typeof body['priority'] === 'number' ? body['priority'] : undefined,
    ttl_ms: typeof body['ttl_ms'] === 'number' ? body['ttl_ms'] : undefined,
  });

  const status = result.ok ? 200 : result.code === 'denied' ? 403 : 400;
  return NextResponse.json(result, { status });
}
