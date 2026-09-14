// Phase 7 graduated autonomy - auto-demotion matrix, severity uplift for
// the section-18 zero-tolerance kinds, and idempotency.

import { describe, expect, it } from 'vitest';
import {
  CRITICAL_KINDS,
  effectiveSeverity,
  onAnomaly,
  saferRung,
} from '../src/lib/business/autonomy/demotion';
import { RUNGS } from '../src/lib/business/autonomy/ladder';
import type { AnomalyKind, Rung } from '../src/lib/business/autonomy/types';

const critical = (kind: AnomalyKind = 'duplicate_side_effect') =>
  ({ severity: 'critical' as const, kind, demoted_to: null });

describe('saferRung', () => {
  it('L1_AUTO / L1_VETO / CERTIFIED -> OWNER_APPROVED_LIVE', () => {
    expect(saferRung('L1_AUTO')).toBe('OWNER_APPROVED_LIVE');
    expect(saferRung('L1_VETO')).toBe('OWNER_APPROVED_LIVE');
    expect(saferRung('CERTIFIED')).toBe('OWNER_APPROVED_LIVE');
  });
  it('OWNER_APPROVED_LIVE -> SHADOW; SHADOW and below unchanged', () => {
    expect(saferRung('OWNER_APPROVED_LIVE')).toBe('SHADOW');
    for (const r of ['SHADOW', 'DEPLOYED', 'TESTED', 'CODED'] as Rung[]) {
      expect(saferRung(r)).toBe(r);
    }
  });
});

describe('effectiveSeverity', () => {
  it('the five zero-tolerance kinds are critical whatever was declared', () => {
    expect(CRITICAL_KINDS).toEqual([
      'duplicate_side_effect', 'contact_leak', 'stale_approval_execution',
      'wrong_project', 'kill_switch',
    ]);
    for (const kind of CRITICAL_KINDS) {
      expect(effectiveSeverity({ severity: 'minor', kind })).toBe('critical');
    }
  });
  it('budget_breach is at least major; other keeps its declared severity', () => {
    expect(effectiveSeverity({ severity: 'minor', kind: 'budget_breach' })).toBe('major');
    expect(effectiveSeverity({ severity: 'critical', kind: 'budget_breach' })).toBe('critical');
    expect(effectiveSeverity({ severity: 'minor', kind: 'other' })).toBe('minor');
    expect(effectiveSeverity({ severity: 'major', kind: 'other' })).toBe('major');
  });
  it('unknown severity or kind fails closed to critical', () => {
    expect(effectiveSeverity({ severity: 'meh' as never, kind: 'other' })).toBe('critical');
    expect(effectiveSeverity({ severity: 'minor', kind: 'novel' as never })).toBe('critical');
  });
});

describe('onAnomaly - critical demotion matrix', () => {
  it('drops each rung to its safer rung immediately', () => {
    const expected: Record<Rung, Rung> = {
      L1_AUTO: 'OWNER_APPROVED_LIVE', L1_VETO: 'OWNER_APPROVED_LIVE',
      CERTIFIED: 'OWNER_APPROVED_LIVE', OWNER_APPROVED_LIVE: 'SHADOW',
      SHADOW: 'SHADOW', DEPLOYED: 'DEPLOYED', TESTED: 'TESTED', CODED: 'CODED',
    };
    for (const rung of RUNGS) {
      const d = onAnomaly({ rung }, critical());
      expect(d.action).toBe('demote');
      expect(d.severity).toBe('critical');
      expect(d.to_rung).toBe(expected[rung]);
      expect(d.changed).toBe(expected[rung] !== rung);
    }
  });
  it('every critical kind demotes (kill switch, stale approval, leak, wrong project)', () => {
    for (const kind of CRITICAL_KINDS) {
      const d = onAnomaly({ rung: 'L1_AUTO' }, critical(kind));
      expect(d.to_rung).toBe('OWNER_APPROVED_LIVE');
      expect(d.changed).toBe(true);
    }
  });
  it('is idempotent: re-applying an anomaly that already demoted changes nothing', () => {
    const first = onAnomaly({ rung: 'L1_AUTO' }, critical());
    expect(first.to_rung).toBe('OWNER_APPROVED_LIVE');
    const applied = { ...critical(), demoted_to: first.to_rung };
    const again = onAnomaly({ rung: first.to_rung }, applied);
    expect(again.changed).toBe(false);
    expect(again.to_rung).toBe('OWNER_APPROVED_LIVE');
    expect(again.reason).toBe('critical_anomaly_already_applied');
    // A third application from the same state is byte-identical.
    expect(onAnomaly({ rung: first.to_rung }, applied)).toEqual(again);
  });
  it('an already-applied anomaly still pins a class that was re-promoted above it', () => {
    const applied = { ...critical(), demoted_to: 'OWNER_APPROVED_LIVE' as Rung };
    const d = onAnomaly({ rung: 'L1_VETO' }, applied);
    expect(d.to_rung).toBe('OWNER_APPROVED_LIVE');
    expect(d.changed).toBe(true);
  });
  it('a class already at the floor records without change', () => {
    const d = onAnomaly({ rung: 'SHADOW' }, critical());
    expect(d.changed).toBe(false);
    expect(d.reason).toBe('critical_anomaly_at_floor');
  });
  it('an unknown rung is treated as CODED', () => {
    const d = onAnomaly({ rung: 'AUTONOMOUS' as never }, critical());
    expect(d.from_rung).toBe('CODED');
    expect(d.to_rung).toBe('CODED');
  });
});

describe('onAnomaly - major and minor', () => {
  it('major freezes promotions without moving the rung', () => {
    const d = onAnomaly({ rung: 'L1_AUTO' },
      { severity: 'major', kind: 'other', demoted_to: null });
    expect(d.action).toBe('freeze_promotions');
    expect(d.to_rung).toBe('L1_AUTO');
    expect(d.changed).toBe(false);
  });
  it('minor is record-only', () => {
    const d = onAnomaly({ rung: 'L1_AUTO' },
      { severity: 'minor', kind: 'other', demoted_to: null });
    expect(d.action).toBe('record_only');
    expect(d.changed).toBe(false);
  });
  it('a budget breach declared minor is still at least a freeze', () => {
    const d = onAnomaly({ rung: 'L1_AUTO' },
      { severity: 'minor', kind: 'budget_breach', demoted_to: null });
    expect(d.action).toBe('freeze_promotions');
  });
});
