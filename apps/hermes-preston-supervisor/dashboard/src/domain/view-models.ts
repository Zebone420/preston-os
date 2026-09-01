// Preston Supervisor - view models. PURE normalization of Preston
// Control read results into display shapes, ported from the
// staging-verified reference (feature/hermes-dashboard @ 1f97e87).
// Authoritative IDs and states pass through UNCHANGED; nothing is
// inferred. Where the platform reports that a bucket could not be
// read, the affected metric renders as 'UNKNOWN' - an invented zero
// would let a broken read masquerade as a healthy empty system.
//
// Wire shapes are STRUCTURAL mirrors of the Preston Control REST
// responses (the plugin backend passes them through verbatim);
// unknown extra fields are ignored.

export type Metric = number | "UNKNOWN";

export function metricFromState(state: string, value: number): Metric {
  return state === "ok" || state === "empty" ? value : "UNKNOWN";
}

export interface GoalWire {
  goal_id: string;
  title: string;
  objective: string;
  status: string;
  source: string;
  requested_by: string;
  environment: string;
  correlation_id: string;
  simulation_only: boolean;
  iteration: number;
  created_at: string;
  updated_at: string;
}

export interface JobWire {
  job_id: string;
  goal_id: string;
  kind: string;
  title: string;
  objective: string;
  status: string;
  risk_class: string;
  assigned_role: string | null;
  attempts: number;
  requires_approval: boolean;
  approval_id: string | null;
  failure_reason: string | null;
  evidence_refs: unknown[];
  created_at: string;
  updated_at: string;
}

export interface ApprovalWire {
  approval_id: string;
  goal_id: string | null;
  job_id: string | null;
  action: string;
  affected_resource: string;
  reason: string;
  risk_class: string;
  environment: string;
  expected_effect: string;
  rollback_plan: string;
  status: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decision_open: boolean;
}

export interface StatusWire {
  generated_at: string;
  environment: string;
  posture: string;
  controls: {
    readable: boolean;
    execution_enabled: boolean;
    remote_runner_enabled: boolean;
    owner_stop: boolean;
    paused: boolean;
    hermes_mode: string;
    updated_at: string;
  };
  summary: {
    total_goals: number;
    running_goals: number;
    blocked_goals: number;
    open_approvals: number;
    failed_jobs: number;
    dead_lettered_jobs: number;
  };
  recent_goals: GoalWire[];
  pending_approvals: ApprovalWire[];
  failures: JobWire[];
  dead_letters: JobWire[];
  read_states: {
    goals: string;
    approvals: string;
    jobs: string;
    failures: string;
    dead_letters: string;
  };
  needs_attention: string[];
}

export interface GoalDetailWire {
  found: boolean;
  error?: string;
  goal?: GoalWire;
  jobs?: JobWire[];
  jobs_read_ok?: boolean;
  job_status_counts?: Record<string, number>;
  pending_approvals?: ApprovalWire[];
  evidence_refs?: Array<{ job_id: string; ref: unknown }>;
  parent_goal_id?: string | null;
  child_goal_ids?: string[];
}

export interface HermesMetrics {
  total_goals: Metric;
  running_goals: Metric;
  blocked_goals: Metric;
  pending_approvals: Metric;
  failed_jobs: Metric;
  dead_lettered_jobs: Metric;
}

export function toMetrics(status: StatusWire): HermesMetrics {
  const rs = status.read_states;
  const s = status.summary;
  return {
    total_goals: metricFromState(rs.goals, s.total_goals),
    running_goals: metricFromState(rs.goals, s.running_goals),
    blocked_goals: metricFromState(rs.goals, s.blocked_goals),
    pending_approvals: metricFromState(rs.approvals, s.open_approvals),
    // Failure counts derive from the JOBS sweep; a partial jobs read
    // undercounts, so the jobs bucket state governs both.
    failed_jobs: metricFromState(rs.jobs, s.failed_jobs),
    dead_lettered_jobs: metricFromState(rs.jobs, s.dead_lettered_jobs),
  };
}

export interface HermesHeader {
  environment: string;
  posture: string;
  controls_readable: boolean;
  execution_enabled: boolean;
  remote_runner_enabled: boolean;
  owner_stop: boolean;
  paused: boolean;
  hermes_mode: string;
  generated_at: string;
  needs_attention: string[];
}

export function toHeader(status: StatusWire): HermesHeader {
  return {
    environment: status.environment,
    posture: status.posture,
    controls_readable: status.controls.readable,
    execution_enabled: status.controls.execution_enabled,
    remote_runner_enabled: status.controls.remote_runner_enabled,
    owner_stop: status.controls.owner_stop,
    paused: status.controls.paused,
    hermes_mode: status.controls.hermes_mode,
    generated_at: status.generated_at,
    needs_attention: status.needs_attention,
  };
}

export interface HermesGoalCard {
  goal_id: string;
  title: string;
  objective: string;
  status: string;
  environment: string;
  created_at: string;
  updated_at: string;
  jobs_read_ok: boolean;
  job_total: Metric;
  job_status_counts: Record<string, number>;
  pending_approvals: number;
  evidence_refs: number;
}

export function toGoalCard(found: GoalDetailWire): HermesGoalCard {
  const goal = found.goal as GoalWire;
  const counts = found.job_status_counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const jobsReadOk = found.jobs_read_ok === true;
  return {
    goal_id: goal.goal_id,
    title: goal.title,
    objective: goal.objective,
    status: goal.status,
    environment: goal.environment,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
    jobs_read_ok: jobsReadOk,
    job_total: jobsReadOk ? total : "UNKNOWN",
    job_status_counts: counts,
    pending_approvals: (found.pending_approvals ?? []).length,
    evidence_refs: (found.evidence_refs ?? []).length,
  };
}

export interface HermesJobRow {
  job_id: string;
  goal_id: string;
  kind: string;
  title: string;
  status: string;
  risk_class: string;
  assigned_role: string | null;
  attempts: number;
  requires_approval: boolean;
  approval_id: string | null;
  failure_reason: string | null;
  evidence_refs: number;
  updated_at: string;
}

export function toJobRow(j: JobWire): HermesJobRow {
  return {
    job_id: j.job_id,
    goal_id: j.goal_id,
    kind: j.kind,
    title: j.title,
    status: j.status,
    risk_class: j.risk_class,
    assigned_role: j.assigned_role,
    attempts: j.attempts,
    requires_approval: j.requires_approval,
    approval_id: j.approval_id,
    failure_reason: j.failure_reason,
    evidence_refs: (j.evidence_refs ?? []).length,
    updated_at: j.updated_at,
  };
}

export function aggregateJobRows(
  details: GoalDetailWire[],
  cap = 30,
): HermesJobRow[] {
  const rows: HermesJobRow[] = [];
  for (const d of details) {
    if (!d.found || !d.jobs) continue;
    for (const j of d.jobs) rows.push(toJobRow(j));
  }
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows.slice(0, cap);
}

// Evidence refs arrive either bare (art-<32 hex>) or prefixed
// (artifact:art-<32 hex>) - the runtime records the prefixed form.
// v0 only matched the bare form and rendered prefixed refs as plain
// text (known cosmetic defect); both now resolve to the artifact id.
const ARTIFACT_REF_RE = /^(?:artifact:)?(art-[0-9a-f]{32})$/;

export function artifactIdFromRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const m = ARTIFACT_REF_RE.exec(ref);
  return m ? m[1] : null;
}
