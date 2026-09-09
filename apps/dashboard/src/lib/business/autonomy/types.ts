// Preston AI OS - Phase 7 graduated autonomy: shared row shapes. PURE.
// Mirrors supabase/migrations/0034_p7_graduated_autonomy.sql exactly. The
// approval-class literals match the capability registry's ApprovalClass
// (ai-os/capabilities/registry.ts) but are declared here so this module
// never depends on a file another gate is concurrently editing.

export type Rung =
  | 'CODED'
  | 'TESTED'
  | 'DEPLOYED'
  | 'SHADOW'
  | 'OWNER_APPROVED_LIVE'
  | 'CERTIFIED'
  | 'L1_VETO'
  | 'L1_AUTO';

export type ClassKind = 'model' | 'deterministic';

export type ApprovalClass = 'INTERNAL' | 'EXTERNAL' | 'STEP_UP';

export interface AutonomyClassRow {
  class_id: string;
  description: string;
  kind: ClassKind;
  approval_class: ApprovalClass;
  capability_ids: string[];
  rung: Rung;
  max_rung: Rung;
  updated_at: string;
}

export interface AutonomyGrantRow {
  id: string;
  class_id: string;
  from_rung: Rung;
  to_rung: Rung;
  granted_by: string; // owner identity
  granted_at: string;
  evidence: Record<string, unknown>; // the criterion numbers
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export type OutcomeKind = 'success' | 'failure' | 'vetoed' | 'anomaly';

export interface AutonomyOutcomeRow {
  id: string;
  class_id: string;
  capability_id: string;
  side_effect_id: string | null;
  outcome: OutcomeKind;
  mode_at_time: Rung;
  recorded_at: string;
  evidence_ref: string | null;
}

export type AnomalySeverity = 'critical' | 'major' | 'minor';

export type AnomalyKind =
  | 'duplicate_side_effect'
  | 'contact_leak'
  | 'stale_approval_execution'
  | 'wrong_project'
  | 'kill_switch'
  | 'budget_breach'
  | 'other';

export interface AutonomyAnomalyRow {
  id: string;
  class_id: string;
  severity: AnomalySeverity;
  kind: AnomalyKind;
  evidence: Record<string, unknown>;
  detected_at: string;
  demoted_to: Rung | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}
