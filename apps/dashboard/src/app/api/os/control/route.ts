import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { requestControl, type ControlAction } from '@/lib/ai-os/controlplane';

// Owner-only runtime control (Phase 4). POST { action: pause|resume|stop }.
// These are safe controls - they NEVER enable execution or the remote runner
// (that stays owner-run SQL / a RED gate). Owner re-checked; write audited.
export const dynamic = 'force-dynamic';

const ACTIONS: readonly ControlAction[] = ['pause', 'resume', 'stop'];

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
  const action = body['action'];
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { ok: false, error: 'action must be pause, resume, or stop' },
      { status: 400 },
    );
  }
  const result = await requestControl(depsFrom(ctx), ctx.ownerEmail, action as ControlAction);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
