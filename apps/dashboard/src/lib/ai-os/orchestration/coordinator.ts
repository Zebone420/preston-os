// Preston AI OS - Phase 7 Hermes coordinator simulation. PURE.
// A coordinator observes a GoalState and produces reconciliation intents
// (retry requests, audit launches, escalation packets, progress summaries).
// It NEVER approves, executes, pushes, deploys, sends, or changes controls.
// The DB hermes_mode stays observe_only; this coordinator LADDER is a separate
// orchestration concept whose highest Phase-7 rung is coordinator_simulation.

import type { GoalJob, GoalState } from './model';

// Orchestration coordinator ladder (distinct from the DB HermesMode enum).
export type CoordinatorMode =
  | 'observe_only'
  | 'coordinator_simulation'
  | 'coordinator_staging' // future gate
  | 'production_candidate'; // future gate

export const COORDINATOR_LADDER: readonly CoordinatorMode[] = [
  'observe_only',
  'coordinator_simulation',
  'coordinator_staging',
  'production_candidate',
];

export interface CoordinatorIntent {
  type: 'request_retry' | 'launch_audit' | 'escalate' | 'summarize' | 'noop';
  job_id?: string;
  detail: string;
}

export interface CoordinatorReport {
  mode: CoordinatorMode;
  intents: CoordinatorIntent[];
  stalled_jobs: string[];
  failed_jobs: string[];
  blocked_on_approval: string[];
  progress: { total: number; completed: number; terminal: number };
  // Hard invariants, always present so callers/tests can pin them.
  can_approve: false;
  can_execute: false;
}

function isStalled(j: GoalJob, nowMs: number, staleMs: number): boolean {
  if (j.status !== 'in_progress' && j.status !== 'assigned') return false;
  const updated = Date.parse(j.updated_at);
  return Number.isFinite(updated) && nowMs - updated > staleMs;
}

// observeAndReconcile: given a mode and state, emit intents ONLY. In
// observe_only, the coordinator summarizes and escalates but requests no
// retries. In coordinator_simulation, it may additionally request bounded
// retries and launch audits (as intents the completion engine may honor).
export function observeAndReconcile(
  mode: CoordinatorMode,
  state: GoalState,
  nowMs: number,
  staleMs = 10 * 60 * 1000,
): CoordinatorReport {
  const jobs = state.jobs;
  const stalled = jobs.filter((j) => isStalled(j, nowMs, staleMs)).map((j) => j.id);
  const failed = jobs.filter((j) => j.status === 'failed').map((j) => j.id);
  const blocked = jobs.filter((j) => j.status === 'awaiting_approval').map((j) => j.id);
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const terminal = jobs.filter((j) =>
    ['completed', 'cancelled', 'dead_lettered'].includes(j.status),
  ).length;

  const intents: CoordinatorIntent[] = [];
  intents.push({
    type: 'summarize',
    detail: `progress ${completed}/${jobs.length} completed; ` +
      `${failed.length} failed; ${blocked.length} awaiting approval; ` +
      `${stalled.length} stalled`,
  });

  for (const id of stalled) {
    intents.push({ type: 'escalate', job_id: id, detail: 'job stalled past threshold' });
  }
  for (const id of blocked) {
    intents.push({ type: 'escalate', job_id: id, detail: 'awaiting owner approval' });
  }

  if (mode === 'coordinator_simulation') {
    for (const id of failed) {
      const j = jobs.find((x) => x.id === id)!;
      if (j.attempts <= state.goal.budget.max_job_retries) {
        intents.push({ type: 'request_retry', job_id: id, detail: 'bounded retry of failed job' });
      } else {
        intents.push({ type: 'escalate', job_id: id, detail: 'retry budget exhausted' });
      }
    }
    // Completed implementation jobs get an audit intent (review-before-trust).
    for (const j of jobs) {
      if (j.status === 'completed' && ['code', 'migration', 'repair'].includes(j.kind)) {
        intents.push({ type: 'launch_audit', job_id: j.id, detail: 'post-implementation audit' });
      }
    }
  }
  // observe_only and higher-but-ungated modes: NO retry/audit intents here;
  // coordinator_staging / production_candidate are future owner gates.

  return {
    mode,
    intents,
    stalled_jobs: stalled,
    failed_jobs: failed,
    blocked_on_approval: blocked,
    progress: { total: jobs.length, completed, terminal },
    can_approve: false,
    can_execute: false,
  };
}
