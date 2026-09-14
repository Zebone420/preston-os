// Phase 7 graduated autonomy - effectiveMode(): fail-closed composition of
// grants, anomalies, class ceiling and the GLOBAL controls ceiling.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import { effectiveMode } from '../src/lib/business/autonomy/effective-mode';
import { RUNGS } from '../src/lib/business/autonomy/ladder';
import type {
  AutonomyAnomalyRow,
  AutonomyClassRow,
  AutonomyGrantRow,
  Rung,
} from '../src/lib/business/autonomy/types';

const NOW = '2026-09-08T12:00:00.000Z';
const LIVE: SystemControls = {
  ...DEFAULT_CONTROLS, execution_enabled: true, hermes_mode: 'dispatch_eligible',
};

function cls(over: Partial<AutonomyClassRow> = {}): AutonomyClassRow {
  return {
    class_id: 'deterministic_filing', description: '', kind: 'deterministic',
    approval_class: 'INTERNAL', capability_ids: [], rung: 'CODED',
    max_rung: 'L1_AUTO', updated_at: NOW, ...over,
  };
}

// A full unbroken grant chain from CODED up to `to`, one per day.
function chain(
  classId: string, to: Rung, over: Partial<AutonomyGrantRow> = {},
): AutonomyGrantRow[] {
  const out: AutonomyGrantRow[] = [];
  for (let i = 0; i < RUNGS.indexOf(to); i++) {
    out.push({
      id: `g-${i}`, class_id: classId, from_rung: RUNGS[i], to_rung: RUNGS[i + 1],
      granted_by: 'owner:info@preston.nyc', granted_at: `2026-08-${10 + i}T00:00:00.000Z`,
      evidence: { n: 30 }, expires_at: null, revoked_at: null, revoked_reason: null, ...over,
    });
  }
  return out;
}

function anomaly(over: Partial<AutonomyAnomalyRow> = {}): AutonomyAnomalyRow {
  return {
    id: 'a-1', class_id: 'deterministic_filing', severity: 'critical',
    kind: 'duplicate_side_effect', evidence: { side_effect_id: 'se-x' },
    detected_at: '2026-09-01T00:00:00.000Z', demoted_to: 'OWNER_APPROVED_LIVE',
    acknowledged_by: null, acknowledged_at: null, ...over,
  };
}

describe('effectiveMode - fail-closed basics', () => {
  it('unknown class => CODED, nothing allowed, promotions frozen', () => {
    const m = effectiveMode({ classRow: undefined, grants: [], anomalies: [],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('CODED');
    expect(m.reasons).toEqual(['unknown_class']);
    expect(Object.values(m.allows).every((v) => v === false)).toBe(true);
    expect(m.promotions_frozen).toBe(true);
  });
  it('a malformed class rung => CODED', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L9' as never }), grants: [],
      anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('CODED');
  });
  it('invalid now => CODED', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }),
      grants: chain('deterministic_filing', 'L1_AUTO'), anomalies: [], controls: LIVE,
      now: 'soon' });
    expect(m.rung).toBe('CODED');
    expect(m.reasons).toEqual(['invalid_now']);
  });
  it('a class row with no grants is CODED even if the row claims L1_AUTO', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }), grants: [], anomalies: [],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('CODED');
    expect(m.reasons).toContain('class_row_above_grants');
  });
});

describe('effectiveMode - grant chain', () => {
  it('a full unbroken chain under live controls reaches the class rung', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }),
      grants: chain('deterministic_filing', 'L1_AUTO'), anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('L1_AUTO');
    expect(m.granted_rung).toBe('L1_AUTO');
    expect(m.allows.execute_unattended).toBe(true);
    expect(m.reasons).toEqual([]);
    expect(m.promotions_frozen).toBe(false);
  });
  it('the persisted class rung caps the chain (min wins)', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'SHADOW' }),
      grants: chain('deterministic_filing', 'L1_AUTO'), anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('SHADOW');
    expect(m.reasons).toContain('class_row_below_grants');
  });
  it('an expired grant is ignored and breaks the chain below it', () => {
    const grants = chain('deterministic_filing', 'L1_AUTO');
    grants[4] = { ...grants[4], expires_at: '2026-09-08T11:59:59.000Z' }; // OAL -> CERTIFIED
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }), grants, anomalies: [],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('OWNER_APPROVED_LIVE');
    expect(m.reasons).toContain('grant_expired:g-4');
    expect(m.reasons).toContain('grant_chain_break:g-5');
    expect(m.allows.execute_unattended).toBe(false);
  });
  it('a grant expiring in the future still counts', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }),
      grants: chain('deterministic_filing', 'L1_AUTO', { expires_at: '2027-01-01T00:00:00.000Z' }),
      anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('L1_AUTO');
  });
  it('a revoked grant is ignored', () => {
    const grants = chain('deterministic_filing', 'L1_AUTO');
    grants[6] = { ...grants[6], revoked_at: '2026-09-02T00:00:00.000Z', revoked_reason: 'owner' };
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }), grants, anomalies: [],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('L1_VETO');
    expect(m.reasons).toContain('grant_revoked:g-6');
  });
  it('a grant that skips rungs or targets another class is ignored', () => {
    const skip: AutonomyGrantRow = { ...chain('deterministic_filing', 'TESTED')[0],
      id: 'g-skip', from_rung: 'CODED', to_rung: 'L1_AUTO' };
    const other = chain('daily_brief', 'L1_AUTO');
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }), grants: [skip, ...other],
      anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('CODED');
    expect(m.reasons).toContain('grant_chain_break:g-skip');
  });
});

describe('effectiveMode - anomalies', () => {
  const full = () => chain('deterministic_filing', 'L1_AUTO');
  it('an unacknowledged critical anomaly pins the demoted rung', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'OWNER_APPROVED_LIVE' }), grants: full(),
      anomalies: [anomaly()], controls: LIVE, now: NOW });
    expect(m.rung).toBe('OWNER_APPROVED_LIVE');
    expect(m.promotions_frozen).toBe(true);
    expect(m.reasons.some((r) => r.startsWith('anomaly_demoted:'))).toBe(true);
  });
  it('a later grant cannot lift an UNacknowledged pin', () => {
    const grants = [...full(), {
      ...full()[4], id: 'g-re', granted_at: '2026-09-05T00:00:00.000Z',
    }];
    const m = effectiveMode({ classRow: cls({ rung: 'CERTIFIED' }), grants,
      anomalies: [anomaly()], controls: LIVE, now: NOW });
    expect(m.rung).toBe('OWNER_APPROVED_LIVE');
    expect(m.reasons).toContain('anomaly_pinned:a-1');
  });
  it('once acknowledged, a later one-rung grant lifts the class again', () => {
    const grants = [...full(), {
      ...full()[4], id: 'g-re', granted_at: '2026-09-05T00:00:00.000Z',
    }];
    const m = effectiveMode({ classRow: cls({ rung: 'CERTIFIED' }), grants,
      anomalies: [anomaly({
        acknowledged_by: 'owner', acknowledged_at: '2026-09-03T00:00:00.000Z',
      })],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('CERTIFIED');
    expect(m.promotions_frozen).toBe(false);
  });
  it('an unacknowledged major anomaly freezes promotions but keeps the rung', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }), grants: full(),
      anomalies: [anomaly({ severity: 'major', kind: 'other', demoted_to: null })],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('L1_AUTO');
    expect(m.promotions_frozen).toBe(true);
  });
  it('a kind-critical anomaly declared minor still pins', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }), grants: full(),
      anomalies: [anomaly({ severity: 'minor', kind: 'kill_switch' })],
      controls: LIVE, now: NOW });
    expect(m.rung).toBe('OWNER_APPROVED_LIVE');
  });
});

describe('effectiveMode - ceilings applied last', () => {
  it('STEP_UP class never exceeds OWNER_APPROVED_LIVE', () => {
    const c = cls({ class_id: 'money_order_actions', approval_class: 'STEP_UP',
      rung: 'L1_AUTO', max_rung: 'L1_AUTO' });
    const m = effectiveMode({ classRow: c, grants: chain('money_order_actions', 'L1_AUTO'),
      anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('OWNER_APPROVED_LIVE');
    expect(m.reasons).toContain('step_up_ceiling');
    expect(m.allows.execute_then_veto).toBe(false);
  });
  it('class max_rung caps an EXTERNAL model class at L1_VETO', () => {
    const c = cls({ class_id: 'external_client_send', kind: 'model', approval_class: 'EXTERNAL',
      rung: 'L1_AUTO', max_rung: 'L1_VETO' });
    const m = effectiveMode({ classRow: c, grants: chain('external_client_send', 'L1_AUTO'),
      anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('L1_VETO');
    expect(m.reasons).toContain('class_ceiling');
  });
  it('owner_stop => CODED regardless of a perfect chain', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'L1_AUTO' }),
      grants: chain('deterministic_filing', 'L1_AUTO'), anomalies: [],
      controls: { ...LIVE, owner_stop: true }, now: NOW });
    expect(m.rung).toBe('CODED');
    expect(m.reasons).toContain('controls_ceiling:CODED');
    expect(Object.values(m.allows).every((v) => v === false)).toBe(true);
  });
  it('observe_only => SHADOW at most; DEFAULT_CONTROLS => CODED', () => {
    const base = { classRow: cls({ rung: 'L1_AUTO' }),
      grants: chain('deterministic_filing', 'L1_AUTO'), anomalies: [], now: NOW };
    expect(effectiveMode({ ...base, controls: { ...LIVE, hermes_mode: 'observe_only' } }).rung)
      .toBe('SHADOW');
    expect(effectiveMode({ ...base, controls: DEFAULT_CONTROLS }).rung).toBe('CODED');
    expect(effectiveMode({ ...base, controls: { ...LIVE, execution_enabled: false } }).rung)
      .toBe('SHADOW');
  });
  it('the controls ceiling can never RAISE a rung', () => {
    const m = effectiveMode({ classRow: cls({ rung: 'SHADOW' }),
      grants: chain('deterministic_filing', 'SHADOW'), anomalies: [], controls: LIVE, now: NOW });
    expect(m.rung).toBe('SHADOW');
    expect(m.allows.owner_approved_live).toBe(false);
  });
});
