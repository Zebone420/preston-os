// Follow-up clocks: cadence per schedule, inbound pause, owner_final_call
// after max touches, no automatic closed_lost, idempotent tick.

import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_RULES,
  armClock,
  resumeClock,
  stopClock,
  tick,
  toClockRow,
  type ClockSchedule,
} from '../src/lib/business/sales/follow-up-clocks';

const T0 = '2026-09-08T12:00:00.000Z';
const SUBJECT = {
  project_id: '11111111-1111-4111-8111-111111111111',
  subject_type: 'proposal' as const,
  subject_id: '55555555-5555-4555-8555-555555555555',
};
const plus = (iso: string, h: number) =>
  new Date(Date.parse(iso) + h * 3_600_000).toISOString();

describe('armClock', () => {
  it.each([
    ['h24', 24, 2], ['h48', 48, 3], ['weekly', 168, 4],
  ] as Array<[ClockSchedule, number, number]>)(
    '%s arms with next_due_at = start + %ih and max_touches %i', (s, hours, max) => {
      const c = armClock(SUBJECT, s, T0);
      expect(c.state).toBe('armed');
      expect(c.next_due_at).toBe(plus(T0, hours));
      expect(c.max_touches).toBe(max);
      expect(c.touches).toBe(0);
      expect(SCHEDULE_RULES[s].interval_ms).toBe(hours * 3_600_000);
    },
  );
  it('bounds max_touches and rejects unknown schedules', () => {
    expect(() => armClock(SUBJECT, 'h24', T0, { max_touches: 0 })).toThrow();
    expect(() => armClock(SUBJECT, 'h24', T0, { max_touches: 13 })).toThrow();
    expect(() => armClock(SUBJECT, 'daily' as ClockSchedule, T0)).toThrow();
    expect(armClock(SUBJECT, 'h24', T0, { max_touches: 5 }).max_touches).toBe(5);
  });
});

describe('tick - cadence and idempotency', () => {
  it('becomes due at next_due_at and stays due on repeated ticks', () => {
    const c = armClock(SUBJECT, 'h48', T0);
    expect(tick(c, plus(T0, 47)).action).toBe('none');
    const due = tick(c, plus(T0, 48));
    expect(due.action).toBe('due');
    expect(due.clock.state).toBe('due');
    const again = tick(due.clock, plus(T0, 49));
    expect(again.action).toBe('none');
    expect(again.clock).toBe(due.clock);
  });
  it('counts one touch per new outbound, re-arms from the touch time, never double counts', () => {
    const c = armClock(SUBJECT, 'h24', T0, { max_touches: 4 });
    const out1 = plus(T0, 24.5);
    const t1 = tick(c, plus(T0, 25), { lastOutboundAt: out1 });
    expect(t1.action).toBe('touch_recorded');
    expect(t1.clock.touches).toBe(1);
    expect(t1.clock.last_touch_at).toBe(out1);
    expect(t1.clock.next_due_at).toBe(plus(out1, 24));
    expect(t1.clock.state).toBe('armed');
    const same = tick(t1.clock, plus(T0, 26), { lastOutboundAt: out1 });
    expect(same.action).toBe('none');
    expect(same.clock.touches).toBe(1);
    expect(tick(same.clock, plus(out1, 24), { lastOutboundAt: out1 }).action).toBe('due');
  });
  it('an inbound reply pauses the clock; resume is explicit', () => {
    const c = armClock(SUBJECT, 'h48', T0);
    const p = tick(c, plus(T0, 10), { lastInboundAt: plus(T0, 5) });
    expect(p.action).toBe('paused');
    expect(p.clock.state).toBe('paused');
    expect(p.clock.next_due_at).toBeNull();
    expect(tick(p.clock, plus(T0, 100), { lastInboundAt: plus(T0, 5) }).action).toBe('none');
    // A newer outbound after the inbound does not un-pause by itself.
    expect(tick(p.clock, plus(T0, 100), {
      lastInboundAt: plus(T0, 5), lastOutboundAt: plus(T0, 6),
    }).action).toBe('none');
    const r = resumeClock(p.clock, plus(T0, 100));
    expect(r.state).toBe('armed');
    expect(r.next_due_at).toBe(plus(T0, 148));
  });
  it('inbound before the clock started is ignored', () => {
    const c = armClock(SUBJECT, 'h24', T0);
    expect(tick(c, plus(T0, 1), { lastInboundAt: plus(T0, -3) }).action).toBe('none');
  });
  it.each(['h24', 'h48', 'weekly'] as ClockSchedule[])(
    '%s: after max touches -> owner_final_call, NEVER closed_lost', (s) => {
      let c = armClock(SUBJECT, s, T0);
      const max = c.max_touches;
      let t = T0;
      for (let i = 1; i <= max; i += 1) {
        t = plus(t, 1);
        const r = tick(c, plus(t, 0.1), { lastOutboundAt: t });
        c = r.clock;
        expect(c.touches).toBe(i);
        if (i < max) expect(r.action).toBe('touch_recorded');
        else expect(r.action).toBe('owner_final_call');
      }
      expect(c.state).toBe('owner_final_call');
      expect(c.next_due_at).toBeNull();
      // Terminal: further ticks with more outbound or elapsed time change nothing.
      const more = tick(c, plus(t, 500), { lastOutboundAt: plus(t, 400) });
      expect(more.action).toBe('none');
      expect(more.clock.state).toBe('owner_final_call');
      expect(more.clock.state).not.toBe('closed_lost');
    },
  );
});

describe('stopClock - the only path to closed_won / closed_lost', () => {
  it('requires an owner reason and is idempotent once terminal', () => {
    const c = armClock(SUBJECT, 'h48', T0);
    expect(() => stopClock(c, 'lost', '  ', T0)).toThrow();
    const lost = stopClock(c, 'lost', 'owner: client chose another vendor', plus(T0, 1));
    expect(lost.state).toBe('closed_lost');
    expect(lost.stopped_reason).toBe('owner: client chose another vendor');
    expect(stopClock(lost, 'won', 'late change', plus(T0, 2))).toBe(lost);
    expect(tick(lost, plus(T0, 999)).action).toBe('none');
    const won = stopClock(armClock(SUBJECT, 'h24', T0), 'won', 'contract signed', T0);
    expect(won.state).toBe('closed_won');
    const stopped = stopClock(armClock(SUBJECT, 'h24', T0), 'stopped', 'superseded', T0);
    expect(stopped.state).toBe('stopped');
  });
  it('toClockRow mirrors the follow_up_clocks columns', () => {
    const row = toClockRow(armClock(SUBJECT, 'weekly', T0, { id: null }));
    expect(Object.keys(row).sort()).toEqual([
      'last_touch_at', 'max_touches', 'next_due_at', 'project_id', 'schedule', 'started_at',
      'state', 'stopped_reason', 'subject_id', 'subject_type', 'touches', 'updated_at',
    ]);
  });
});
