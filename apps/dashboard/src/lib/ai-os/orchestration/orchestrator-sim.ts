// Preston AI OS - Phase 7 end-to-end SIMULATION driver. PURE.
// Drives a decomposed GoalState to a terminal state using the completion
// engine + simulation adapters + coordinator, entirely in memory. This is the
// canonical proof that the orchestration chain closes deterministically with
// zero execution, zero sends, and correct approval gating. It is the harness
// the staging-validation packet references and the (future) service wraps.
// It NEVER spawns, sends, pushes, deploys, or approves.

import { step, type EngineAction } from './completion-engine';
import {
  makeSimulationAdapter,
  type AdapterResult,
} from './adapters';
import { observeAndReconcile, type CoordinatorMode } from './coordinator';
import type { AgentRole, GoalJob, GoalState } from './model';

export interface SimTranscriptEntry {
  iteration: number;
  actions: EngineAction[];
  adapter_results: AdapterResult[];
  coordinator_summary: string;
  status: GoalState['goal']['status'];
}

export interface SimOutcome {
  final_status: GoalState['goal']['status'];
  reason: string;
  iterations: number;
  transcript: SimTranscriptEntry[];
  jobs: GoalJob[];
  // hard invariants, asserted by callers/tests
  any_executed: false;
  any_sent: false;
}

// Owner-approval oracle: given a job awaiting approval, decide whether the
// (simulated) owner approves. Injected so tests can exercise approve/deny/hold
// paths. Returns 'approve' | 'reject' | 'hold'. Default oracle HOLDS (the safe
// default: without an explicit owner decision, gated jobs never proceed).
export type ApprovalOracle = (job: GoalJob) => 'approve' | 'reject' | 'hold';

export const HOLD_ORACLE: ApprovalOracle = () => 'hold';

export interface RunOptions {
  coordinatorMode?: CoordinatorMode;
  approvalOracle?: ApprovalOracle;
  ids?: (seed: string) => string;
  maxSteps?: number; // hard harness cap (defense on top of engine budget)
}

// Deterministic id minter if the caller supplies none.
function seqIds(): (seed: string) => string {
  let n = 0;
  return (seed: string) => `${seed}-${++n}`;
}

export function runGoalSimulation(
  initial: GoalState,
  now: () => number,
  opts: RunOptions = {},
): SimOutcome {
  const state: GoalState = {
    goal: { ...initial.goal },
    jobs: initial.jobs.map((j) => ({ ...j })),
    iteration: initial.iteration,
    started_at: initial.started_at,
  };
  const oracle = opts.approvalOracle ?? HOLD_ORACLE;
  const mode = opts.coordinatorMode ?? 'coordinator_simulation';
  const mintId = opts.ids ?? seqIds();
  const maxSteps = Math.min(opts.maxSteps ?? 1000, 5000);

  const adapters: Record<string, ReturnType<typeof makeSimulationAdapter>> = {};
  const adapterFor = (role: AgentRole) =>
    (adapters[role] ??= makeSimulationAdapter(role));

  const transcript: SimTranscriptEntry[] = [];
  const byId = () => new Map(state.jobs.map((j) => [j.id, j]));

  const snapshot = () => state.jobs.map((j) => `${j.id}:${j.status}:${j.approval_id ?? ''}`).join('|');

  let guard = 0;
  while (guard++ < maxSteps) {
    const nowMs = now();
    const before = snapshot();
    const s = step(state, nowMs);
    const results: AdapterResult[] = [];

    for (const act of s.actions) {
      const jobId = (act as { job_id?: string }).job_id;
      const job = jobId ? byId().get(jobId) : undefined;
      switch (act.type) {
        case 'assign':
          if (job) { job.assigned_role = (act.role as AgentRole) ?? 'claude'; job.status = 'assigned'; job.updated_at = new Date(nowMs).toISOString(); }
          break;
        case 'request_approval':
          if (job && !job.approval_id) {
            job.approval_id = mintId(`apr:${job.id}`);
            job.status = 'awaiting_approval';
            job.updated_at = new Date(nowMs).toISOString();
            // Apply the injected owner decision.
            const decision = oracle(job);
            if (decision === 'approve') { job.requires_approval = false; job.status = 'ready'; }
            else if (decision === 'reject') { job.status = 'cancelled'; job.failure_reason = 'owner_rejected'; }
            // 'hold' leaves it awaiting_approval (engine will report blocked)
          }
          break;
        case 'run': {
          if (job) {
            const res = adapterFor(job.assigned_role ?? 'claude').runJob(job, new Date(nowMs).toISOString());
            results.push(res);
            job.attempts += 1;
            job.status = res.outcome === 'completed' ? 'completed' : 'failed';
            job.failure_reason = res.failure_reason;
            job.evidence_refs.push(...res.evidence_refs);
            job.updated_at = new Date(nowMs).toISOString();
          }
          break;
        }
        case 'retry':
          if (job) { job.status = 'ready'; job.failure_reason = null; job.updated_at = new Date(nowMs).toISOString(); }
          break;
        case 'audit':
          if (job) { job.status = 'completed'; job.evidence_refs.push(`audit:${job.id}`); }
          break;
        case 'dead_letter':
          if (job) { job.status = 'dead_lettered'; job.failure_reason = act.reason; }
          break;
        case 'escalate':
        case 'noop':
          break;
      }
    }

    const report = observeAndReconcile(mode, state, nowMs);
    transcript.push({
      iteration: state.iteration,
      actions: s.actions,
      adapter_results: results,
      coordinator_summary: report.intents.find((i) => i.type === 'summarize')?.detail ?? '',
      status: s.status,
    });

    state.goal.status = s.status;
    if (s.done) {
      return {
        final_status: s.status,
        reason: s.reason,
        iterations: state.iteration,
        transcript,
        jobs: state.jobs,
        any_executed: false,
        any_sent: false,
      };
    }
    // Fixpoint: a blocked state that changed nothing this iteration is a
    // stable park awaiting an owner decision the harness cannot make. Stop and
    // report blocked (NOT a dead-letter) - a real service would suspend here
    // until an owner approval arrives out of band.
    if (s.status === 'blocked' && snapshot() === before) {
      return {
        final_status: 'blocked',
        reason: 'awaiting_owner_approval',
        iterations: state.iteration,
        transcript,
        jobs: state.jobs,
        any_executed: false,
        any_sent: false,
      };
    }
    state.iteration += 1;
  }

  // Harness cap hit (should not happen within engine budgets): fail closed.
  return {
    final_status: 'dead_lettered',
    reason: 'harness_max_steps',
    iterations: state.iteration,
    transcript,
    jobs: state.jobs,
    any_executed: false,
    any_sent: false,
  };
}
