import { describe, expect, it } from 'vitest';
import {
  allUnitsReceived,
  applyReceivingEvent,
  foldReceivingEvents,
  hasOpenExceptions,
  initialReceivingState,
  type ReceivingEvent,
  type ReceivingState,
} from '../src/lib/business/lifecycle/receiving';
import type { ReceivingEventKind } from '../src/lib/business/lifecycle/types';

const P = '00000000-0000-4000-8000-0000000000aa';

function ev(
  id: string,
  event: ReceivingEventKind,
  at = '2026-09-01T10:00:00.000Z',
): ReceivingEvent {
  return { id, project_id: P, event, occurred_at: at, recorded_by: 'owner' };
}

function run(events: ReceivingEvent[]): ReceivingState {
  let s = initialReceivingState(P);
  for (const e of events) {
    const r = applyReceivingEvent(s, e);
    if (!r.ok) throw new Error(`${e.event}: ${r.reason}`);
    s = r.state;
  }
  return s;
}

describe('receiving state machine', () => {
  it('walks shipped -> delivered -> received -> inspected', () => {
    const s = run([
      ev('e1', 'shipped'),
      ev('e2', 'delivered'),
      ev('e3', 'received'),
      ev('e4', 'inspected'),
    ]);
    expect(s.phase).toBe('inspected');
    expect(allUnitsReceived(s)).toBe(true);
    expect(s.applied_event_ids).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('refuses out-of-order events without changing state', () => {
    const s0 = initialReceivingState(P);
    const r = applyReceivingEvent(s0, ev('e1', 'received'));
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s0);
    if (!r.ok) expect(r.reason).toMatch(/not allowed from not_shipped/);
  });

  it('backordered can be shipped later; not after delivery', () => {
    const s = run([ev('e1', 'backordered'), ev('e2', 'shipped')]);
    expect(s.phase).toBe('shipped');
    const late = applyReceivingEvent(
      run([ev('a', 'shipped'), ev('b', 'delivered')]),
      ev('c', 'backordered'),
    );
    expect(late.ok).toBe(false);
  });

  it('is idempotent: a replayed event id is ignored', () => {
    const s1 = run([ev('e1', 'shipped'), ev('e2', 'delivered')]);
    const r = applyReceivingEvent(s1, ev('e2', 'delivered'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ignored).toBe(true);
    expect(r.state).toBe(s1);
    // Even a replay with a DIFFERENT kind under the same id is ignored.
    const r2 = applyReceivingEvent(s1, ev('e1', 'exception'));
    expect(r2.ok && r2.ignored).toBe(true);
    expect(hasOpenExceptions(r2.state)).toBe(false);
  });

  it('rejects malformed events (project mismatch, bad kind, bad time)', () => {
    const s0 = initialReceivingState(P);
    expect(applyReceivingEvent(s0, { ...ev('x', 'shipped'), project_id: 'other' })
      .ok).toBe(false);
    expect(applyReceivingEvent(s0, {
      ...ev('x', 'shipped'), event: 'teleported' as ReceivingEventKind,
    }).ok).toBe(false);
    expect(applyReceivingEvent(s0, { ...ev('x', 'shipped'), occurred_at: 'now' })
      .ok).toBe(false);
    expect(applyReceivingEvent(s0, { ...ev('x', 'shipped'), recorded_by: '' })
      .ok).toBe(false);
  });
});

describe('damage / remake exception branch', () => {
  const base = [ev('e1', 'shipped'), ev('e2', 'delivered'), ev('e3', 'received')];

  it('damage blocks all_units_received until the remake is received', () => {
    const damaged = run([...base, ev('d1', 'damage_reported')]);
    expect(hasOpenExceptions(damaged)).toBe(true);
    expect(allUnitsReceived(damaged)).toBe(false);
    expect(damaged.phase).toBe('received');

    const requested = run([...base, ev('d1', 'damage_reported'),
      ev('d2', 'remake_requested')]);
    expect(requested.open_exceptions[0].stage).toBe('remake_requested');
    expect(allUnitsReceived(requested)).toBe(false);

    const healed = run([...base, ev('d1', 'damage_reported'),
      ev('d2', 'remake_requested'), ev('d3', 'remake_received')]);
    expect(hasOpenExceptions(healed)).toBe(false);
    expect(allUnitsReceived(healed)).toBe(true);
    expect(healed.resolved_exceptions).toHaveLength(1);
    expect(healed.resolved_exceptions[0].resolved_by_event_id).toBe('d3');
  });

  it('remake steps require the prior step', () => {
    const s = run(base);
    expect(applyReceivingEvent(s, ev('r', 'remake_requested')).ok).toBe(false);
    expect(applyReceivingEvent(s, ev('r', 'remake_received')).ok).toBe(false);
    const d = run([...base, ev('d1', 'damage_reported')]);
    expect(applyReceivingEvent(d, ev('r', 'remake_received')).ok).toBe(false);
  });

  it('damage cannot be reported before delivery', () => {
    const s = run([ev('e1', 'shipped')]);
    expect(applyReceivingEvent(s, ev('d', 'damage_reported')).ok).toBe(false);
  });

  it('inspection does NOT clear damage, but clears generic exceptions', () => {
    const withBoth = run([...base, ev('x1', 'exception'),
      ev('d1', 'damage_reported')]);
    expect(withBoth.open_exceptions).toHaveLength(2);
    const inspected = run([...base, ev('x1', 'exception'),
      ev('d1', 'damage_reported'), ev('i1', 'inspected')]);
    expect(inspected.open_exceptions.map((x) => x.kind)).toEqual(['damage']);
    expect(allUnitsReceived(inspected)).toBe(false);
  });

  it('two damage reports need two remakes', () => {
    const s = run([...base, ev('d1', 'damage_reported'),
      ev('d2', 'damage_reported'), ev('r1', 'remake_requested'),
      ev('r2', 'remake_received')]);
    expect(s.open_exceptions).toHaveLength(1);
    expect(allUnitsReceived(s)).toBe(false);
  });
});

describe('foldReceivingEvents', () => {
  it('orders by occurred_at then id and reports rejects', () => {
    const { state, rejected } = foldReceivingEvents(P, [
      ev('e3', 'received', '2026-09-03T00:00:00.000Z'),
      ev('e1', 'shipped', '2026-09-01T00:00:00.000Z'),
      ev('e2', 'delivered', '2026-09-02T00:00:00.000Z'),
      ev('bad', 'remake_received', '2026-09-04T00:00:00.000Z'),
    ]);
    expect(state.phase).toBe('received');
    expect(rejected).toEqual([{ id: 'bad', reason: 'no remake outstanding' }]);
  });
});
