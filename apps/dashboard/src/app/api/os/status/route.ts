import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { readStatus } from '@/lib/ai-os/controlplane';
import { loadBridgeReadiness } from '@/lib/ai-os/orchestration/read-model';

// Owner-only runtime status (Phase 4). Read-only; fail-closed; no secrets.
// Reports global execution/owner-stop/pause, Hermes mode, and runner mode.
// Phase 7: additionally reports the orchestration bridge readiness (the same
// read model the drill inspects) so the owner can verify migration state,
// simulation-safe posture, and backlog remotely - no new subsystem, no
// anonymous access, no duplicate read model.
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await resolveOwner();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'owner authorization required' },
      { status: 401 },
    );
  }
  const status = await readStatus(depsFrom(ctx));
  const orchestration = await loadBridgeReadiness(ctx.client);
  return NextResponse.json({ ok: true, status, orchestration });
}
