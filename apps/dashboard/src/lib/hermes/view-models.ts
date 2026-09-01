// Hermes Supervisor Dashboard v0 - view models. PURE normalization of the
// Preston Control read results into display shapes. Authoritative IDs and
// states pass through UNCHANGED; nothing is inferred. Where the platform
// reports that a bucket could not be read (read_states / read_ok flags),
// the affected metric renders as 'UNKNOWN' - an invented zero would let a
// broken read masquerade as a healthy empty system.

import type {
  PrestonGoalResult,
  PrestonStatusResult,
} from './adapter';

export type Metric = number | 'UNKNOWN';

// A bucket state counts as trustworthy only when the read succeeded
// ('ok') or succeeded and found nothing ('empty'). 'error' and
// 'migration_absent' both mean the number cannot be known here.
export function metricFromState(state: string, value: number): Metric {
  return state === 'ok' || state === 'empty' ? value : 'UNKNOWN';
}

export interface HermesMetrics {
  total_goals: Metric;
  running_goals: Metric;
  blocked_goals: Metric;
  pending_approvals: Metric;
  failed_jobs: Metric;
  dead_lettered_jobs: Metric;
}

export function toMetrics(status: PrestonStatusResult): HermesMetrics {
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

export function toHeader(status: PrestonStatusResult): HermesHeader {
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

// Goal card built from ONE preston_get_goal result. Counts come from the
// platform's own job_status_counts; evidence availability is the factual
// count of evidence refs across the goal's jobs (0 when jobs unreadable is
// avoided by carrying jobs_read_ok forward).
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

export function toGoalCard(
  found: Extract<PrestonGoalResult, { found: true }>,
): HermesGoalCard {
  const counts = found.job_status_counts;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    goal_id: found.goal.goal_id,
    title: found.goal.title,
    objective: found.goal.objective,
    status: found.goal.status,
    environment: found.goal.environment,
    created_at: found.goal.created_at,
    updated_at: found.goal.updated_at,
    jobs_read_ok: found.jobs_read_ok,
    job_total: found.jobs_read_ok ? total : 'UNKNOWN',
    job_status_counts: counts,
    pending_approvals: found.pending_approvals.length,
    evidence_refs: found.evidence_refs.length,
  };
}

// Job row for the aggregate jobs table. Fields the goal read does not
// carry (provider/model, duration) are NOT invented here - they live on
// the job detail page where preston_get_job reports them.
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

type ProjectedJob =
  Extract<PrestonGoalResult, { found: true }>['jobs'][number];

export function toJobRow(j: ProjectedJob): HermesJobRow {
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
    evidence_refs: j.evidence_refs.length,
    updated_at: j.updated_at,
  };
}

// Newest-first job aggregation across the loaded goal details, bounded.
export function aggregateJobRows(
  details: Array<PrestonGoalResult>,
  cap = 30,
): HermesJobRow[] {
  const rows: HermesJobRow[] = [];
  for (const d of details) {
    if (!d.found) continue;
    for (const j of d.jobs) rows.push(toJobRow(j));
  }
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows.slice(0, cap);
}

// Evidence refs shaped art-<32 hex> resolve to the artifact inspector;
// anything else renders as an opaque reference string.
const ARTIFACT_REF_RE = /^art-[0-9a-f]{32}$/;

export function isArtifactRef(ref: unknown): ref is string {
  return typeof ref === 'string' && ARTIFACT_REF_RE.test(ref);
}
