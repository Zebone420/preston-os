// Preston AI OS - Phase 7 orchestration data model. PURE (no I/O, no clock,
// no randomness; callers inject now/ids). Sits ABOVE the existing job runtime
// (queue.ts/os_jobs, leases, checkpoints). A master goal decomposes into a
// dependency-ordered set of goal-jobs; each goal-job later maps onto exactly
// one runtime os_job for bounded simulation execution. Nothing here executes,
// sends, or writes externally.

import type { RiskClass } from '../types';
import { RUNTIME_ID_RE } from '../commands';

export type GoalStatus =
  | 'proposed' // intake; not yet decomposed
  | 'decomposed' // dependency graph built
  | 'running' // jobs in flight (simulation)
  | 'blocked' // awaiting an owner approval / dependency
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered';

export type GoalJobStatus =
  | 'pending' // deps unmet
  | 'ready' // deps met, awaiting assignment
  | 'assigned'
  | 'in_progress'
  | 'awaiting_review'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered';

export type JobKind =
  | 'documentation'
  | 'code'
  | 'test'
  | 'migration'
  | 'audit'
  | 'repair'
  | 'recommendation'
  | 'unknown';

// Which agent role a job is assigned to. Fixed roles - no agent derives
// authority from another (see agent-contracts.ts).
export type AgentRole =
  | 'chatgpt' // architect / intake (never an implementer)
  | 'claude' // implementer + auditor
  | 'codex' // implementer + reviewer
  | 'hermes' // coordinator (never implements, never approves)
  | 'audit'; // dedicated audit worker

export interface ExecutionBudget {
  max_iterations: number; // hard loop cap for the whole goal
  max_job_retries: number; // per-job retry cap
  max_wall_ms: number; // deadline from goal start
  max_jobs: number; // decomposition size cap
}

// Fail-closed default budget: small, bounded, non-runaway.
export const DEFAULT_BUDGET: ExecutionBudget = {
  max_iterations: 200,
  max_job_retries: 2,
  max_wall_ms: 6 * 60 * 60 * 1000, // 6h
  max_jobs: 100,
};

export interface GoalJob {
  id: string;
  goal_id: string;
  kind: JobKind;
  title: string;
  objective: string;
  risk_class: RiskClass;
  assigned_role: AgentRole | null; // null until assigned
  depends_on: string[]; // goal-job ids that must complete first
  status: GoalJobStatus;
  attempts: number;
  requires_approval: boolean; // policy decision (default-deny)
  approval_id: string | null; // set once an approval request is raised
  runtime_job_id: string | null; // linked os_jobs row (simulation)
  correlation_id: string;
  evidence_refs: string[]; // checkpoint / audit ids
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasterGoal {
  id: string;
  title: string;
  objective: string;
  source: 'chatgpt' | 'telegram' | 'dashboard' | 'owner_cli';
  requested_by: string; // owner identity
  status: GoalStatus;
  environment: 'staging'; // Phase 7 is staging-only, hard-pinned
  budget: ExecutionBudget;
  correlation_id: string;
  simulation_only: true; // DB-pinned; never executes
  created_at: string;
  updated_at: string;
}

export interface GoalState {
  goal: MasterGoal;
  jobs: GoalJob[];
  iteration: number;
  started_at: string;
}

// --- validation (fail-closed) ---------------------------------------------

function ok(id: unknown): boolean {
  return typeof id === 'string' && RUNTIME_ID_RE.test(id);
}

export const JOB_KINDS: readonly JobKind[] = [
  'documentation', 'code', 'test', 'migration', 'audit', 'repair',
  'recommendation', 'unknown',
];

export const AGENT_ROLES: readonly AgentRole[] = [
  'chatgpt', 'claude', 'codex', 'hermes', 'audit',
];

export function validateBudget(b: ExecutionBudget): string[] {
  const errs: string[] = [];
  const pos = (n: number, name: string) => {
    if (!Number.isInteger(n) || n <= 0) errs.push(`${name}_invalid`);
  };
  pos(b.max_iterations, 'max_iterations');
  pos(b.max_job_retries + 1, 'max_job_retries'); // 0 retries allowed
  pos(b.max_wall_ms, 'max_wall_ms');
  pos(b.max_jobs, 'max_jobs');
  if (b.max_iterations > 10000) errs.push('max_iterations_too_large');
  if (b.max_jobs > 1000) errs.push('max_jobs_too_large');
  return errs;
}

export function validateMasterGoal(g: MasterGoal): string[] {
  const errs: string[] = [];
  if (!ok(g.id)) errs.push('id_invalid');
  if (!ok(g.correlation_id)) errs.push('correlation_id_invalid');
  if (!g.title?.trim()) errs.push('title_required');
  if (!g.objective?.trim()) errs.push('objective_required');
  if (g.environment !== 'staging') errs.push('environment_must_be_staging');
  if (g.simulation_only !== true) errs.push('simulation_only_must_be_true');
  errs.push(...validateBudget(g.budget));
  return errs;
}

export function validateGoalJob(j: GoalJob): string[] {
  const errs: string[] = [];
  if (!ok(j.id)) errs.push('id_invalid');
  if (!ok(j.goal_id)) errs.push('goal_id_invalid');
  if (!ok(j.correlation_id)) errs.push('correlation_id_invalid');
  if (!JOB_KINDS.includes(j.kind)) errs.push('kind_invalid');
  if (j.assigned_role !== null && !AGENT_ROLES.includes(j.assigned_role)) {
    errs.push('assigned_role_invalid');
  }
  if (!Array.isArray(j.depends_on)) errs.push('depends_on_invalid');
  else if (j.depends_on.some((d) => !ok(d))) errs.push('depends_on_id_invalid');
  if (j.depends_on?.includes(j.id)) errs.push('self_dependency');
  return errs;
}
