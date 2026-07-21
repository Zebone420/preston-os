import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { requestControl, type ControlAction } from '@/lib/ai-os/controlplane';

// Owner-only runtime control (Phase 4; `kill` added Phase 5J).
// POST { action: pause|resume|stop|kill }. These are safe controls - they
// NEVER enable execution or the remote runner (that stays owner-run SQL / a
// RED gate). `kill` writes the same hard-halt patch as `stop` but is audited
// RED (see controlplane.requestControl). Owner re-checked; write audited.
export const dynamic = 'force-dynamic';

const ACTIONS: readonly ControlAction[] = ['pause', 'resume', 'stop', 'kill'];

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
      { ok: false, error: 'action must be pause, resume, stop, or kill' },
      { status: 400 },
    );
  }
  const result = await requestControl(depsFrom(ctx), ctx.ownerEmail, action as ControlAction);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
