// Preston AI OS - Phase 7 graduation criteria. PURE.
//
// Owner-accepted defaults (2026-09-03 council synthesis):
//   - a class advances ONE rung at a time;
//   - MODEL-backed classes: promotion to CERTIFIED / L1_VETO / L1_AUTO needs
//     a one-sided Wilson lower bound >= 0.90 on the success rate with
//     N >= 30 shadow / owner-approved outcomes;
//   - DETERMINISTIC classes: a drilled-N of clean outcomes - 20 for
//     EXTERNAL (and STEP_UP), 10 for INTERNAL;
//   - promotion is NEVER automatic: this module returns a PROPOSAL the owner
//     must turn into an autonomy_grants row. Nothing here mutates state.

import { classCeiling, nextRung, rungAtLeast, rungIndex, isRung } from './ladder';
import type {
  ApprovalClass,
  AutonomyClassRow,
  AutonomyOutcomeRow,
  Rung,
} from './types';

// One-sided 95% normal quantile.
export const ONE_SIDED_95_Z = 1.6449;
export const MODEL_MIN_N = 30;
export const MODEL_MIN_LOWER_BOUND = 0.9;
export const DRILLED_N: Readonly<Record<ApprovalClass, number>> = Object.freeze({
  INTERNAL: 10,
  EXTERNAL: 20,
  STEP_UP: 20,
});

// Rungs whose promotion needs numeric evidence. Below these the move is an
// engineering / owner attestation step (still an explicit grant).
export const EVIDENCE_GATED_TARGETS: readonly Rung[] = [
  'CERTIFIED', 'L1_VETO', 'L1_AUTO',
];

// Outcomes count as evidence only once a class is at least SHADOW (they
// were computed or owner-approved under real conditions).
export const EVIDENCE_FLOOR: Rung = 'SHADOW';

// Wilson score interval, lower bound. z defaults to the one-sided 95%
// quantile. Degenerate input (n <= 0, non-finite, negative) -> 0 (fail
// closed: no evidence, no bound).
export function wilsonLowerBound(
  successes: number, n: number, z: number = ONE_SIDED_95_Z,
): number {
  if (!Number.isFinite(successes) || !Number.isFinite(n) || !Number.isFinite(z)) {
    return 0;
  }
  if (n <= 0 || z <= 0) return 0;
  const s = Math.min(Math.max(successes, 0), n);
  const p = s / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lower = (centre - spread) / denom;
  if (!Number.isFinite(lower)) return 0;
  return Math.min(1, Math.max(0, lower));
}

export interface PromotionNumbers {
  n: number; // counted outcomes (success + failure + vetoed)
  successes: number;
  failures: number;
  vetoed: number;
  anomalies: number;
  wilson_lower: number;
  min_lower_bound: number | null; // model classes only
  required_n: number; // MODEL_MIN_N or the drilled-N
}

export interface PromotionProposal {
  class_id: string;
  from_rung: Rung;
  to_rung: Rung;
  requires: 'owner_grant'; // never applied by code
  evidence: Record<string, unknown>;
}

export interface PromotionAssessment {
  eligible: boolean;
  reason: string;
  from_rung: Rung | null;
  to_rung: Rung | null;
  numbers: PromotionNumbers;
  proposal: PromotionProposal | null;
}

export interface PromotionOptions {
  // Only outcomes recorded at or after this ISO instant count (e.g. since
  // the last acknowledged anomaly). Default: all outcomes.
  since?: string;
}

function countOutcomes(
  classId: string, outcomes: readonly AutonomyOutcomeRow[], since?: string,
): Omit<PromotionNumbers, 'wilson_lower' | 'min_lower_bound' | 'required_n'> {
  const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  let successes = 0; let failures = 0; let vetoed = 0; let anomalies = 0;
  for (const o of outcomes) {
    if (!o || o.class_id !== classId) continue;
    if (!rungAtLeast(o.mode_at_time, EVIDENCE_FLOOR)) continue;
    if (Number.isFinite(sinceMs) && Date.parse(o.recorded_at) < sinceMs) continue;
    if (o.outcome === 'success') successes += 1;
    else if (o.outcome === 'failure') failures += 1;
    else if (o.outcome === 'vetoed') vetoed += 1;
    else if (o.outcome === 'anomaly') anomalies += 1;
  }
  return { n: successes + failures + vetoed, successes, failures, vetoed, anomalies };
}

// Assess whether the class's NEXT rung could be granted. Always returns a
// proposal at most - the owner grants; code never promotes.
export function promotionEligible(
  classRow: AutonomyClassRow,
  outcomes: readonly AutonomyOutcomeRow[],
  opts: PromotionOptions = {},
): PromotionAssessment {
  const counts = countOutcomes(classRow.class_id, outcomes, opts.since);
  const isModel = classRow.kind === 'model';
  const requiredN = isModel
    ? MODEL_MIN_N
    : (DRILLED_N[classRow.approval_class] ?? DRILLED_N.EXTERNAL);
  const numbers: PromotionNumbers = {
    ...counts,
    wilson_lower: wilsonLowerBound(counts.successes, counts.n),
    min_lower_bound: isModel ? MODEL_MIN_LOWER_BOUND : null,
    required_n: requiredN,
  };
  const refuse = (reason: string, from: Rung | null, to: Rung | null) => ({
    eligible: false, reason, from_rung: from, to_rung: to, numbers, proposal: null,
  });

  if (!isRung(classRow.rung)) return refuse('unknown_rung', null, null);
  const from = classRow.rung;
  const to = nextRung(from);
  if (!to) return refuse('already_at_top', from, null);
  const ceiling = classCeiling(classRow.approval_class, classRow.max_rung);
  if (rungIndex(to) > rungIndex(ceiling)) {
    return refuse('ceiling_reached', from, to);
  }
  if (counts.anomalies > 0) return refuse('anomaly_outcomes_present', from, to);

  let reason: string;
  if (!EVIDENCE_GATED_TARGETS.includes(to)) {
    reason = 'owner_attestation_required';
  } else if (isModel) {
    if (counts.n < MODEL_MIN_N) return refuse('insufficient_n', from, to);
    if (numbers.wilson_lower < MODEL_MIN_LOWER_BOUND) {
      return refuse('lower_bound_below_threshold', from, to);
    }
    reason = 'wilson_criterion_met';
  } else {
    if (counts.failures > 0 || counts.vetoed > 0) {
      return refuse('drill_failures_present', from, to);
    }
    if (counts.successes < requiredN) return refuse('insufficient_drilled_n', from, to);
    reason = 'drilled_n_met';
  }

  return {
    eligible: true,
    reason,
    from_rung: from,
    to_rung: to,
    numbers,
    proposal: {
      class_id: classRow.class_id,
      from_rung: from,
      to_rung: to,
      requires: 'owner_grant',
      evidence: {
        criterion: reason,
        kind: classRow.kind,
        approval_class: classRow.approval_class,
        ...numbers,
      },
    },
  };
}
