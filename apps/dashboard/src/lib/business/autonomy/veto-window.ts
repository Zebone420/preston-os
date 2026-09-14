// Preston AI OS - Phase 7 L1_VETO semantics. PURE.
//
// At rung L1_VETO an action is SCHEDULED with a veto window (default 30
// minutes) and may execute only after the window elapses WITHOUT an owner
// veto. This module never executes anything: it produces and transitions
// the schedule record the runner consults.
//
//   pending --(owner veto)--> vetoed          (terminal; never executes)
//   pending --(window elapsed, runner releases)--> released
//
// A veto that arrives after the window but before release still blocks:
// only an explicit release marks the item as handed to execution.

export const DEFAULT_VETO_WINDOW_MINUTES = 30;
export const MIN_VETO_WINDOW_MINUTES = 1;
export const MAX_VETO_WINDOW_MINUTES = 24 * 60;

export type VetoStatus = 'pending' | 'vetoed' | 'released';

export interface VetoItem {
  scheduled_at: string;
  executes_after: string;
  window_minutes: number;
  status: VetoStatus;
  vetoed_by: string | null;
  vetoed_at: string | null;
  released_at: string | null;
}

function parseIso(iso: string): number {
  const v = Date.parse(iso);
  if (!Number.isFinite(v)) throw new RangeError('invalid_timestamp');
  return v;
}

export function scheduleWithVeto(
  nowIso: string, minutes: number = DEFAULT_VETO_WINDOW_MINUTES,
): VetoItem {
  if (!Number.isInteger(minutes) || minutes < MIN_VETO_WINDOW_MINUTES ||
      minutes > MAX_VETO_WINDOW_MINUTES) {
    throw new RangeError('invalid_veto_window');
  }
  const now = parseIso(nowIso);
  return {
    scheduled_at: new Date(now).toISOString(),
    executes_after: new Date(now + minutes * 60_000).toISOString(),
    window_minutes: minutes,
    status: 'pending',
    vetoed_by: null,
    vetoed_at: null,
    released_at: null,
  };
}

// True while the item is pending AND still inside its window. Invalid time
// input -> false (fail closed for the "may I still veto?" question only;
// applyVeto below still blocks a pending item regardless).
export function vetoable(nowIso: string, item: VetoItem): boolean {
  if (item.status !== 'pending') return false;
  const now = Date.parse(nowIso);
  const after = Date.parse(item.executes_after);
  if (!Number.isFinite(now) || !Number.isFinite(after)) return false;
  return now < after;
}

// True only when pending and the window has fully elapsed. Invalid time
// input -> false (never execute on a doubtful clock).
export function readyToExecute(nowIso: string, item: VetoItem): boolean {
  if (item.status !== 'pending') return false;
  const now = Date.parse(nowIso);
  const after = Date.parse(item.executes_after);
  if (!Number.isFinite(now) || !Number.isFinite(after)) return false;
  return now >= after;
}

// Owner veto. Idempotent: an already-vetoed item is returned unchanged; a
// released item cannot be vetoed (execution was already handed off) and is
// returned unchanged. Returns a NEW object; the input is never mutated.
export function applyVeto(item: VetoItem, actor: string, nowIso: string): VetoItem {
  if (item.status !== 'pending') return item;
  const who = String(actor ?? '').trim();
  if (!who) throw new RangeError('invalid_actor');
  return {
    ...item,
    status: 'vetoed',
    vetoed_by: who,
    vetoed_at: new Date(parseIso(nowIso)).toISOString(),
  };
}

// Runner hand-off. Only a pending item whose window has elapsed can be
// released; anything else is returned unchanged (never mutated).
export function release(item: VetoItem, nowIso: string): VetoItem {
  if (!readyToExecute(nowIso, item)) return item;
  return { ...item, status: 'released', released_at: new Date(parseIso(nowIso)).toISOString() };
}
