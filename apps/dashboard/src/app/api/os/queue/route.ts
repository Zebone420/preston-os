import { NextResponse } from 'next/server';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { listCommandPackets, listJobs } from '@/lib/ai-os/store';

// Owner-only queue view (Phase 4). Read-only; lists recent command proposals
// and jobs from the control plane. No execution; no secrets.
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await resolveOwner();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'owner authorization required' },
      { status: 401 },
    );
  }
  const commands = await listCommandPackets(ctx.client, 20);
  const jobs = await listJobs(ctx.client, 20);
  return NextResponse.json({
    ok: true,
    commands: commands.rows,
    jobs: jobs.rows,
    errors: { commands: commands.error ?? null, jobs: jobs.error ?? null },
  });
}
