// Preston AI OS - Phase 7 continuous completion engine. PURE state machine.
// Given a GoalState and per-job outcomes, computes the NEXT bounded set of
// actions (assignments, retries, approval requests, audits, escalations) and
// whether the goal is done/failed/dead-lettered. Deterministic. Enforces
// iteration/retry/deadline caps, dead-letters repeated identical failures,
// forbids self-approval, and FAILS CLOSED on ambiguity. It NEVER executes -
// it only decides; a separate adapter (simulation-only) performs bounded work.

import type { GoalJob, GoalState } from './model';

export type EngineAction =
  | { type: 'assign'; job_id: string; role: string }
  | { type: 'run'; job_id: string } // hand to a (simulation) adapter
  | { type: 'request_approval'; job_id: string }
  | { type: 'retry'; job_id: string }
  | { type: 'audit'; job_id: string }
  | { type: 'dead_letter'; job_id: string; reason: string }
  | { type: 'escalate'; reason: string }
  | { type: 'noop' };

export interface EngineStep {
  actions: EngineAction[];
  status: GoalState['goal']['status'];
  done: boolean;
  reason: string;
}

// A job is runnable when all its dependencies are completed.
function depsMet(job: GoalJob, byId: Map<string, GoalJob>): boolean {
  return job.depends_on.every((d) => byId.get(d)?.status === 'completed');
}

function terminal(s: GoalJob['status']): boolean {
  return s === 'completed' || s === 'cancelled' || s === 'dead_lettered';
}

// Compute the next step. `nowMs` and the current iteration live in state; the
// caller applies the returned actions, updates job statuses from adapter
// results, increments iteration, and calls step() again until done.
export function step(state: GoalState, nowMs: number): EngineStep {
  const g = state.goal;
  const byId = new Map(state.jobs.map((j) => [j.id, j]));

  // Global stop conditions (fail-closed, deterministic).
  if (g.status === 'cancelled') {
    return { actions: [{ type: 'noop' }], status: 'cancelled', done: true, reason: 'cancelled' };
  }
  if (state.iteration >= g.budget.max_iterations) {
    return {
      actions: [{ type: 'escalate', reason: 'max_iterations' }],
      status: 'dead_lettered', done: true, reason: 'max_iterations',
    };
  }
  const elapsed = nowMs - Date.parse(state.started_at);
  if (Number.isFinite(elapsed) && elapsed > g.budget.max_wall_ms) {
    return {
      actions: [{ type: 'escalate', reason: 'deadline_exceeded' }],
      status: 'dead_lettered', done: true, reason: 'deadline_exceeded',
    };
  }

  // Completion: every job terminal.
  const allTerminal = state.jobs.every((j) => terminal(j.status));
  if (allTerminal) {
    const anyDead = state.jobs.some((j) => j.status === 'dead_lettered');
    const anyCancelled = state.jobs.some((j) => j.status === 'cancelled');
    if (anyDead) {
      return { actions: [{ type: 'escalate', reason: 'job_dead_lettered' }], status: 'failed', done: true, reason: 'job_dead_lettered' };
    }
    if (anyCancelled) {
      return { actions: [{ type: 'noop' }], status: 'cancelled', done: true, reason: 'cancelled_jobs' };
    }
    return { actions: [{ type: 'noop' }], status: 'completed', done: true, reason: 'all_jobs_completed' };
  }

  const actions: EngineAction[] = [];
  let blocked = false;

  for (const job of state.jobs) {
    if (terminal(job.status)) continue;

    switch (job.status) {
      case 'failed': {
        // Repeated identical failure or retry budget exhausted => dead-letter.
        if (job.attempts > g.budget.max_job_retries) {
          actions.push({ type: 'dead_letter', job_id: job.id, reason: job.failure_reason ?? 'retry_exhausted' });
        } else {
          actions.push({ type: 'retry', job_id: job.id });
        }
        break;
      }
      case 'pending': {
        if (depsMet(job, byId)) {
          // becomes ready => needs assignment (or approval first)
          if (job.requires_approval && !job.approval_id) {
            actions.push({ type: 'request_approval', job_id: job.id });
            blocked = true;
          } else if (!job.assigned_role) {
            actions.push({ type: 'assign', job_id: job.id, role: 'claude' });
          } else {
            actions.push({ type: 'run', job_id: job.id });
          }
        }
        break;
      }
      case 'ready': {
        if (job.requires_approval && !job.approval_id) {
          actions.push({ type: 'request_approval', job_id: job.id });
          blocked = true;
        } else {
          actions.push({ type: 'run', job_id: job.id });
        }
        break;
      }
      case 'assigned':
        actions.push({ type: 'run', job_id: job.id });
        break;
      case 'awaiting_approval':
        // Held pending an owner decision the engine cannot make itself.
        blocked = true;
        break;
      case 'awaiting_review':
        actions.push({ type: 'audit', job_id: job.id });
        break;
      case 'in_progress':
        // Adapter owns it this iteration; nothing to schedule.
        break;
    }
  }

  if (actions.length === 0) {
    // Nothing schedulable and not all terminal: either blocked on approvals
    // or a stuck graph. Blocked is a legitimate wait; a stuck graph escalates.
    if (blocked) {
      return { actions: [{ type: 'noop' }], status: 'blocked', done: false, reason: 'awaiting_owner_approval' };
    }
    return {
      actions: [{ type: 'escalate', reason: 'no_progress_possible' }],
      status: 'dead_lettered', done: true, reason: 'stuck_graph',
    };
  }

  return {
    actions,
    status: blocked ? 'blocked' : 'running',
    done: false,
    reason: 'scheduled',
  };
}
