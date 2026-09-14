// Preston AI OS - Phase 7 auto-demotion. PURE.
//
// Plan PHASE 7 "Auto-demotion": a critical anomaly drops the class to the
// safer rung IMMEDIATELY (code decides; no owner in the loop for going
// DOWN):
//   L1_AUTO / L1_VETO / CERTIFIED  -> OWNER_APPROVED_LIVE
//   OWNER_APPROVED_LIVE            -> SHADOW
//   SHADOW and below               -> unchanged (record only)
// A major anomaly freezes promotions (no rung change); a minor anomaly is
// recorded only. The decision is idempotent: re-applying an anomaly that
// already demoted the class changes nothing.

import { isRung, minRung } from './ladder';
import type {
  AnomalyKind,
  AnomalySeverity,
  AutonomyAnomalyRow,
  AutonomyClassRow,
  Rung,
} from './types';

// Section 18 reliability metrics that must stay at zero: any of these is
// critical regardless of the severity the reporter declared.
export const CRITICAL_KINDS: readonly AnomalyKind[] = [
  'duplicate_side_effect',
  'contact_leak',
  'stale_approval_execution',
  'wrong_project',
  'kill_switch',
];

const SEVERITY_RANK: Readonly<Record<AnomalySeverity, number>> = {
  minor: 0, major: 1, critical: 2,
};

// The stronger of the declared severity and the kind-implied severity.
// Unknown severity or kind resolves to critical (fail closed).
export function effectiveSeverity(
  a: Pick<AutonomyAnomalyRow, 'severity' | 'kind'>,
): AnomalySeverity {
  const declared: AnomalySeverity | undefined =
    a.severity in SEVERITY_RANK ? a.severity : undefined;
  if (!declared) return 'critical';
  if (CRITICAL_KINDS.includes(a.kind)) return 'critical';
  if (a.kind === 'budget_breach') {
    return SEVERITY_RANK[declared] >= SEVERITY_RANK.major ? declared : 'major';
  }
  if (a.kind !== 'other') return 'critical'; // unknown kind
  return declared;
}

export function saferRung(r: Rung): Rung {
  switch (r) {
    case 'L1_AUTO':
    case 'L1_VETO':
    case 'CERTIFIED':
      return 'OWNER_APPROVED_LIVE';
    case 'OWNER_APPROVED_LIVE':
      return 'SHADOW';
    default:
      return r;
  }
}

export type DemotionAction = 'demote' | 'freeze_promotions' | 'record_only';

export interface DemotionDecision {
  action: DemotionAction;
  severity: AnomalySeverity;
  from_rung: Rung;
  to_rung: Rung;
  changed: boolean; // true only when the class rung must move
  reason: string;
}

export function onAnomaly(
  classRow: Pick<AutonomyClassRow, 'rung'>,
  anomaly: Pick<AutonomyAnomalyRow, 'severity' | 'kind' | 'demoted_to'>,
): DemotionDecision {
  const from: Rung = isRung(classRow.rung) ? classRow.rung : 'CODED';
  const severity = effectiveSeverity(anomaly);
  if (severity === 'minor') {
    return {
      action: 'record_only', severity, from_rung: from, to_rung: from,
      changed: false, reason: 'minor_anomaly_recorded',
    };
  }
  if (severity === 'major') {
    return {
      action: 'freeze_promotions', severity, from_rung: from, to_rung: from,
      changed: false, reason: 'major_anomaly_freezes_promotions',
    };
  }
  // Critical. If this anomaly already demoted the class (demoted_to set),
  // re-applying it never drops further: pin at min(current, demoted_to).
  if (isRung(anomaly.demoted_to)) {
    const pinned = minRung(from, anomaly.demoted_to);
    return {
      action: 'demote', severity, from_rung: from, to_rung: pinned,
      changed: pinned !== from, reason: 'critical_anomaly_already_applied',
    };
  }
  const to = saferRung(from);
  return {
    action: 'demote', severity, from_rung: from, to_rung: to,
    changed: to !== from,
    reason: to !== from ? 'critical_anomaly_demotes' : 'critical_anomaly_at_floor',
  };
}
