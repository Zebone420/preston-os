// Phase 7 graduated autonomy - L1_VETO window: executes only after the
// window elapses; an owner veto blocks; nothing here executes anything.

import { describe, expect, it } from 'vitest';
import {
  applyVeto,
  DEFAULT_VETO_WINDOW_MINUTES,
  MAX_VETO_WINDOW_MINUTES,
  readyToExecute,
  release,
  scheduleWithVeto,
  vetoable,
} from '../src/lib/business/autonomy/veto-window';

const T0 = '2026-09-08T12:00:00.000Z';
const plus = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

describe('scheduleWithVeto', () => {
  it('defaults to a 30 minute window', () => {
    expect(DEFAULT_VETO_WINDOW_MINUTES).toBe(30);
    const item = scheduleWithVeto(T0);
    expect(item.status).toBe('pending');
    expect(item.scheduled_at).toBe(T0);
    expect(item.executes_after).toBe(plus(30));
    expect(item.window_minutes).toBe(30);
    expect(item.vetoed_by).toBeNull();
  });
  it('accepts a configurable window inside [1, 1440] minutes', () => {
    expect(scheduleWithVeto(T0, 5).executes_after).toBe(plus(5));
    expect(scheduleWithVeto(T0, MAX_VETO_WINDOW_MINUTES).executes_after).toBe(plus(1440));
  });
  it('rejects zero, negative, fractional, oversized or non-numeric windows', () => {
    for (const bad of [0, -1, 2.5, 1441, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scheduleWithVeto(T0, bad)).toThrow('invalid_veto_window');
    }
    expect(() => scheduleWithVeto('not-a-time')).toThrow('invalid_timestamp');
  });
});

describe('window semantics', () => {
  it('is vetoable inside the window and not ready to execute', () => {
    const item = scheduleWithVeto(T0);
    expect(vetoable(T0, item)).toBe(true);
    expect(vetoable(plus(29), item)).toBe(true);
    expect(readyToExecute(plus(29), item)).toBe(false);
  });
  it('becomes ready exactly when the window elapses and is then no longer vetoable', () => {
    const item = scheduleWithVeto(T0);
    expect(readyToExecute(plus(30), item)).toBe(true);
    expect(vetoable(plus(30), item)).toBe(false);
    expect(readyToExecute(plus(120), item)).toBe(true);
  });
  it('a doubtful clock is never ready and never vetoable', () => {
    const item = scheduleWithVeto(T0);
    expect(readyToExecute('garbage', item)).toBe(false);
    expect(vetoable('garbage', item)).toBe(false);
  });
});

describe('applyVeto', () => {
  it('an in-window veto blocks execution for good', () => {
    const item = scheduleWithVeto(T0);
    const vetoed = applyVeto(item, 'owner:info@preston.nyc', plus(10));
    expect(vetoed.status).toBe('vetoed');
    expect(vetoed.vetoed_by).toBe('owner:info@preston.nyc');
    expect(vetoed.vetoed_at).toBe(plus(10));
    expect(readyToExecute(plus(60), vetoed)).toBe(false);
    expect(release(vetoed, plus(60))).toBe(vetoed);
    // input never mutated
    expect(item.status).toBe('pending');
  });
  it('a late veto (window elapsed, not yet released) still blocks', () => {
    const item = scheduleWithVeto(T0);
    const vetoed = applyVeto(item, 'owner', plus(45));
    expect(vetoed.status).toBe('vetoed');
    expect(readyToExecute(plus(45), vetoed)).toBe(false);
  });
  it('is idempotent and cannot undo a release', () => {
    const item = scheduleWithVeto(T0);
    const once = applyVeto(item, 'owner', plus(1));
    expect(applyVeto(once, 'other', plus(2))).toBe(once);
    const released = release(item, plus(30));
    expect(released.status).toBe('released');
    expect(applyVeto(released, 'owner', plus(31))).toBe(released);
  });
  it('requires an actor', () => {
    expect(() => applyVeto(scheduleWithVeto(T0), '  ', plus(1))).toThrow('invalid_actor');
  });
});

describe('release', () => {
  it('only releases a pending item whose window has elapsed', () => {
    const item = scheduleWithVeto(T0);
    expect(release(item, plus(29))).toBe(item);
    const done = release(item, plus(30));
    expect(done.status).toBe('released');
    expect(done.released_at).toBe(plus(30));
    expect(release(done, plus(40))).toBe(done);
  });
});
