import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { readStatus } from '@/lib/ai-os/controlplane';

// Owner-only runtime status (Phase 4). Read-only; fail-closed; no secrets.
// Reports global execution/owner-stop/pause, Hermes mode, and runner mode.
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
  return NextResponse.json({ ok: true, status });
}
