// Phase 4 - follow-up clocks (plan PHASE 4 Follow-up; migration 0033
// follow_up_clocks). PURE: no clock (now is injected), no I/O.
//
// Rules:
//   - schedules: h24 / h48 / weekly touch cadence, each with a bounded
//     max_touches (defaults below; the owner may set 1..12 when arming);
//   - an inbound reply PAUSES the clock; resuming is an explicit call;
//   - after max touches the clock lands in owner_final_call. The clock
//     NEVER auto-closes a deal: closed_lost / closed_won come only from
//     stopClock with an owner outcome and reason;
//   - tick is idempotent: ticking the returned clock again with the same
//     inputs changes nothing.

export type ClockSchedule = 'h24' | 'h48' | 'weekly';
export const CLOCK_SCHEDULES: readonly ClockSchedule[] = ['h24', 'h48', 'weekly'];

export type ClockSubjectType = 'quote' | 'proposal' | 'lead' | 'vendor_quote';
export const CLOCK_SUBJECT_TYPES: readonly ClockSubjectType[] = [
  'quote',
  'proposal',
  'lead',
  'vendor_quote',
];

export type ClockState =
  | 'armed'
  | 'due'
  | 'paused'
  | 'owner_final_call'
  | 'closed_lost'
  | 'closed_won'
  | 'stopped';

export const TERMINAL_CLOCK_STATES: readonly ClockState[] = [
  'owner_final_call',
  'closed_lost',
  'closed_won',
  'stopped',
];

const HOUR_MS = 60 * 60 * 1000;

export interface ScheduleRule {
  interval_ms: number;
  max_touches: number; // default; owner may override at arm time (1..12)
}

export const SCHEDULE_RULES: Readonly<Record<ClockSchedule, ScheduleRule>> =
  Object.freeze({
    h24: { interval_ms: 24 * HOUR_MS, max_touches: 2 },
    h48: { interval_ms: 48 * HOUR_MS, max_touches: 3 },
    weekly: { interval_ms: 7 * 24 * HOUR_MS, max_touches: 4 },
  });

export const MAX_TOUCHES_CEILING = 12;

export interface ClockSubject {
  project_id: string | null;
  subject_type: ClockSubjectType;
  subject_id: string;
}

export interface FollowUpClock extends ClockSubject {
  id: string | null; // null until persisted
  schedule: ClockSchedule;
  started_at: string;
  next_due_at: string | null;
  last_touch_at: string | null;
  touches: number;
  max_touches: number;
  state: ClockState;
  stopped_reason: string | null;
  updated_at: string;
}

export interface ArmOptions {
  max_touches?: number;
  id?: string | null;
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function after(a: string | null | undefined, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return Date.parse(a) > Date.parse(b);
}

export function isClockSchedule(v: unknown): v is ClockSchedule {
  return typeof v === 'string' && (CLOCK_SCHEDULES as string[]).includes(v);
}

export function armClock(
  subject: ClockSubject,
  schedule: ClockSchedule,
  now: string,
  opts: ArmOptions = {},
): FollowUpClock {
  if (!isClockSchedule(schedule)) {
    throw new Error('follow-up-clocks: unknown schedule');
  }
  if (Number.isNaN(Date.parse(now))) {
    throw new Error('follow-up-clocks: invalid now');
  }
  const rule = SCHEDULE_RULES[schedule];
  const max = opts.max_touches ?? rule.max_touches;
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_TOUCHES_CEILING) {
    throw new Error('follow-up-clocks: max_touches out of bounds');
  }
  return {
    id: opts.id ?? null,
    project_id: subject.project_id,
    subject_type: subject.subject_type,
    subject_id: subject.subject_id,
    schedule,
    started_at: now,
    next_due_at: addMs(now, rule.interval_ms),
    last_touch_at: null,
    touches: 0,
    max_touches: max,
    state: 'armed',
    stopped_reason: null,
    updated_at: now,
  };
}

export type TickAction =
  | 'none'
  | 'due'
  | 'paused'
  | 'touch_recorded'
  | 'owner_final_call';

export interface TickSignals {
  lastOutboundAt?: string | null; // most recent outbound touch to the subject
  lastInboundAt?: string | null; // most recent inbound reply from the client
}

export interface TickResult {
  clock: FollowUpClock;
  action: TickAction;
}

// Deterministic, idempotent tick. Precedence: terminal -> inbound pause
// -> new outbound touch counted -> due check -> none.
export function tick(
  clock: FollowUpClock,
  now: string,
  signals: TickSignals = {},
): TickResult {
  if (TERMINAL_CLOCK_STATES.includes(clock.state)) {
    return { clock, action: 'none' };
  }
  const inbound = signals.lastInboundAt ?? null;
  const outbound = signals.lastOutboundAt ?? null;

  // An inbound reply newer than the clock start and newer than the last
  // outbound touch pauses the clock (the conversation is live).
  const inboundIsLatest =
    after(inbound, clock.started_at) && !after(outbound, inbound);
  if (inboundIsLatest) {
    if (clock.state === 'paused') return { clock, action: 'none' };
    return {
      clock: {
        ...clock,
        state: 'paused',
        next_due_at: null,
        updated_at: now,
      },
      action: 'paused',
    };
  }
  if (clock.state === 'paused') return { clock, action: 'none' };

  // A new outbound touch since the last counted one.
  const baseline = clock.last_touch_at ?? clock.started_at;
  if (after(outbound, baseline)) {
    const touches = clock.touches + 1;
    const touchAt = outbound as string;
    if (touches >= clock.max_touches) {
      return {
        clock: {
          ...clock,
          touches,
          last_touch_at: touchAt,
          next_due_at: null,
          state: 'owner_final_call',
          updated_at: now,
        },
        action: 'owner_final_call',
      };
    }
    return {
      clock: {
        ...clock,
        touches,
        last_touch_at: touchAt,
        next_due_at: addMs(touchAt, SCHEDULE_RULES[clock.schedule].interval_ms),
        state: 'armed',
        updated_at: now,
      },
      action: 'touch_recorded',
    };
  }

  if (
    clock.state === 'armed' &&
    clock.next_due_at !== null &&
    Date.parse(now) >= Date.parse(clock.next_due_at)
  ) {
    return {
      clock: { ...clock, state: 'due', updated_at: now },
      action: 'due',
    };
  }
  return { clock, action: 'none' };
}

// Explicit resume after a pause (owner/staff decision or a follow-up
// playbook re-arm). Never automatic.
export function resumeClock(clock: FollowUpClock, now: string): FollowUpClock {
  if (clock.state !== 'paused') return clock;
  return {
    ...clock,
    state: 'armed',
    next_due_at: addMs(now, SCHEDULE_RULES[clock.schedule].interval_ms),
    updated_at: now,
  };
}

export type StopOutcome = 'won' | 'lost' | 'stopped';

// The ONLY path to closed_lost / closed_won: an explicit owner outcome
// with a reason. Idempotent for an already-terminal clock.
export function stopClock(
  clock: FollowUpClock,
  outcome: StopOutcome,
  reason: string,
  now: string,
): FollowUpClock {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('follow-up-clocks: stop reason required');
  }
  if (
    clock.state === 'closed_won' ||
    clock.state === 'closed_lost' ||
    clock.state === 'stopped'
  ) {
    return clock;
  }
  const state: ClockState =
    outcome === 'won' ? 'closed_won' : outcome === 'lost' ? 'closed_lost' : 'stopped';
  return {
    ...clock,
    state,
    next_due_at: null,
    stopped_reason: reason.trim(),
    updated_at: now,
  };
}

// Row shape for follow_up_clocks (migration 0033).
export function toClockRow(clock: FollowUpClock): Record<string, unknown> {
  const row: Record<string, unknown> = {
    project_id: clock.project_id,
    subject_type: clock.subject_type,
    subject_id: clock.subject_id,
    schedule: clock.schedule,
    started_at: clock.started_at,
    next_due_at: clock.next_due_at,
    last_touch_at: clock.last_touch_at,
    touches: clock.touches,
    max_touches: clock.max_touches,
    state: clock.state,
    stopped_reason: clock.stopped_reason,
    updated_at: clock.updated_at,
  };
  if (clock.id) row.id = clock.id;
  return row;
}
