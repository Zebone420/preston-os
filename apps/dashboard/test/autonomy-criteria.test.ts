// Phase 7 graduated autonomy - graduation criteria pins: Wilson numerics,
// model vs deterministic thresholds, and that promotion is NEVER automatic.

import { describe, expect, it } from 'vitest';
import {
  DRILLED_N,
  MODEL_MIN_LOWER_BOUND,
  MODEL_MIN_N,
  ONE_SIDED_95_Z,
  promotionEligible,
  wilsonLowerBound,
} from '../src/lib/business/autonomy/criteria';
import type {
  AutonomyClassRow,
  AutonomyOutcomeRow,
  OutcomeKind,
  Rung,
} from '../src/lib/business/autonomy/types';

function cls(over: Partial<AutonomyClassRow> = {}): AutonomyClassRow {
  return {
    class_id: 'internal_summaries', description: '', kind: 'model',
    approval_class: 'INTERNAL', capability_ids: [], rung: 'CERTIFIED',
    max_rung: 'L1_AUTO', updated_at: '2026-09-08T00:00:00.000Z', ...over,
  };
}

function outcomes(
  classId: string, successes: number, failures = 0, mode: Rung = 'OWNER_APPROVED_LIVE',
  extra: OutcomeKind[] = [],
): AutonomyOutcomeRow[] {
  const rows: AutonomyOutcomeRow[] = [];
  const mk = (i: number, outcome: OutcomeKind): AutonomyOutcomeRow => ({
    id: `o-${i}`, class_id: classId, capability_id: 'preston.echo.read_test',
    side_effect_id: null, outcome, mode_at_time: mode,
    recorded_at: `2026-09-0${1 + (i % 7)}T00:00:00.000Z`, evidence_ref: null,
  });
  let i = 0;
  for (let k = 0; k < successes; k++) rows.push(mk(i++, 'success'));
  for (let k = 0; k < failures; k++) rows.push(mk(i++, 'failure'));
  for (const o of extra) rows.push(mk(i++, o));
  return rows;
}

describe('wilsonLowerBound', () => {
  it('uses the one-sided 95% quantile by default', () => {
    expect(ONE_SIDED_95_Z).toBeCloseTo(1.6449, 4);
  });
  it('30/30 clears 0.90 (n / (n + z^2) = 0.917)', () => {
    const v = wilsonLowerBound(30, 30);
    expect(v).toBeCloseTo(30 / (30 + ONE_SIDED_95_Z ** 2), 6);
    expect(v).toBeCloseTo(0.9173, 3);
    expect(v).toBeGreaterThanOrEqual(0.9);
  });
  it('27/30 and 29/30 fall below 0.90', () => {
    expect(wilsonLowerBound(27, 30)).toBeCloseTo(0.7745, 3);
    expect(wilsonLowerBound(27, 30)).toBeLessThan(0.9);
    expect(wilsonLowerBound(29, 30)).toBeCloseTo(0.8636, 3);
    expect(wilsonLowerBound(29, 30)).toBeLessThan(0.9);
  });
  it('matches the textbook two-sided value p=0.5 n=100 z=1.96 -> 0.4038', () => {
    expect(wilsonLowerBound(50, 100, 1.96)).toBeCloseTo(0.4038, 3);
    expect(wilsonLowerBound(30, 30, 1.96)).toBeCloseTo(0.8865, 3);
  });
  it('is monotone in successes and grows with n at p=1', () => {
    let prev = -1;
    for (let s = 0; s <= 30; s++) {
      const v = wilsonLowerBound(s, 30);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(wilsonLowerBound(60, 60)).toBeGreaterThan(wilsonLowerBound(30, 30));
  });
  it('degenerate input fails closed to 0 and stays in [0,1]', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(5, -1)).toBe(0);
    expect(wilsonLowerBound(Number.NaN, 10)).toBe(0);
    expect(wilsonLowerBound(0, 10)).toBe(0);
    expect(wilsonLowerBound(50, 10)).toBeLessThanOrEqual(1);
  });
});

describe('promotionEligible - model classes', () => {
  it('CERTIFIED -> L1_VETO with 30/30 owner-approved outcomes is eligible', () => {
    const r = promotionEligible(cls(), outcomes('internal_summaries', 30));
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe('wilson_criterion_met');
    expect(r.to_rung).toBe('L1_VETO');
    expect(r.numbers.n).toBe(30);
    expect(r.numbers.wilson_lower).toBeGreaterThanOrEqual(MODEL_MIN_LOWER_BOUND);
    expect(r.numbers.required_n).toBe(MODEL_MIN_N);
  });
  it('27/30 is NOT eligible (lower bound below 0.90)', () => {
    const r = promotionEligible(cls(), outcomes('internal_summaries', 27, 3));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('lower_bound_below_threshold');
    expect(r.proposal).toBeNull();
  });
  it('29/29 is NOT eligible (N below 30)', () => {
    const r = promotionEligible(cls(), outcomes('internal_summaries', 29));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('insufficient_n');
  });
  it('vetoed outcomes count against the success rate', () => {
    const rows = outcomes('internal_summaries', 30, 0, 'L1_VETO', ['vetoed', 'vetoed']);
    const r = promotionEligible(cls({ rung: 'L1_VETO' }), rows);
    expect(r.numbers.n).toBe(32);
    expect(r.numbers.vetoed).toBe(2);
    expect(r.eligible).toBe(false);
  });
  it('outcomes below SHADOW and other classes do not count', () => {
    const r = promotionEligible(cls(), [
      ...outcomes('internal_summaries', 30, 0, 'DEPLOYED'),
      ...outcomes('daily_brief', 30),
    ]);
    expect(r.numbers.n).toBe(0);
    expect(r.eligible).toBe(false);
  });
  it('an anomaly outcome blocks promotion outright', () => {
    const rows = outcomes('internal_summaries', 40, 0, 'OWNER_APPROVED_LIVE', ['anomaly']);
    const r = promotionEligible(cls(), rows);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('anomaly_outcomes_present');
  });
  it('the since option narrows the evidence window', () => {
    const rows = outcomes('internal_summaries', 30);
    const r = promotionEligible(cls(), rows, { since: '2026-09-07T00:00:00.000Z' });
    expect(r.numbers.n).toBeLessThan(30);
    expect(r.eligible).toBe(false);
  });
});

describe('promotionEligible - deterministic classes', () => {
  const det = (approval: AutonomyClassRow['approval_class'], id: string) =>
    cls({ class_id: id, kind: 'deterministic', approval_class: approval,
      rung: 'OWNER_APPROVED_LIVE',
      max_rung: approval === 'STEP_UP' ? 'OWNER_APPROVED_LIVE' : 'L1_AUTO' });
  it('INTERNAL needs a drilled-N of 10 clean outcomes', () => {
    expect(DRILLED_N.INTERNAL).toBe(10);
    const ok = promotionEligible(det('INTERNAL', 'deterministic_filing'),
      outcomes('deterministic_filing', 10));
    expect(ok.eligible).toBe(true);
    expect(ok.reason).toBe('drilled_n_met');
    expect(ok.to_rung).toBe('CERTIFIED');
    const short = promotionEligible(det('INTERNAL', 'deterministic_filing'),
      outcomes('deterministic_filing', 9));
    expect(short.eligible).toBe(false);
    expect(short.reason).toBe('insufficient_drilled_n');
  });
  it('EXTERNAL needs a drilled-N of 20', () => {
    expect(DRILLED_N.EXTERNAL).toBe(20);
    const r19 = promotionEligible(det('EXTERNAL', 'ext_det'), outcomes('ext_det', 19));
    expect(r19.eligible).toBe(false);
    expect(r19.numbers.required_n).toBe(20);
    const r20 = promotionEligible(det('EXTERNAL', 'ext_det'), outcomes('ext_det', 20));
    expect(r20.eligible).toBe(true);
  });
  it('any failure in the drill disqualifies', () => {
    const r = promotionEligible(det('INTERNAL', 'deterministic_filing'),
      outcomes('deterministic_filing', 30, 1));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('drill_failures_present');
  });
  it('STEP_UP never proposes past OWNER_APPROVED_LIVE', () => {
    const r = promotionEligible(det('STEP_UP', 'money_order_actions'),
      outcomes('money_order_actions', 100));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('ceiling_reached');
    expect(r.proposal).toBeNull();
  });
});

describe('promotionEligible - ladder edges and non-automation', () => {
  it('pre-evidence rungs need an owner attestation grant (no numbers)', () => {
    const r = promotionEligible(cls({ rung: 'CODED' }), []);
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe('owner_attestation_required');
    expect(r.to_rung).toBe('TESTED');
    expect(r.proposal?.requires).toBe('owner_grant');
  });
  it('an EXTERNAL model class stops at its max_rung L1_VETO', () => {
    const c = cls({ class_id: 'external_client_send', approval_class: 'EXTERNAL',
      rung: 'L1_VETO', max_rung: 'L1_VETO' });
    const r = promotionEligible(c, outcomes('external_client_send', 100));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('ceiling_reached');
  });
  it('L1_AUTO has nowhere to go', () => {
    const r = promotionEligible(cls({ rung: 'L1_AUTO' }), outcomes('internal_summaries', 50));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('already_at_top');
  });
  it('NEVER mutates the class row and only returns a proposal', () => {
    const c = cls();
    const frozen = JSON.stringify(c);
    const r = promotionEligible(c, outcomes('internal_summaries', 30));
    expect(JSON.stringify(c)).toBe(frozen);
    expect(c.rung).toBe('CERTIFIED');
    expect(r.proposal).toEqual(expect.objectContaining({
      class_id: 'internal_summaries', from_rung: 'CERTIFIED', to_rung: 'L1_VETO',
      requires: 'owner_grant',
    }));
    expect(r.proposal?.evidence).toEqual(expect.objectContaining({
      n: 30, successes: 30, criterion: 'wilson_criterion_met',
    }));
  });
});
