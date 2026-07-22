// Preston AI OS - Phase 7 restart-safe durable driver. Server-side.
// Reconstructs a GoalState from PERSISTED rows (master_goals + goal_jobs) and
// advances it ONE bounded step by consulting the completion engine, then
// persisting each resulting transition via the store (CAS). Because state is
// rebuilt from the DB every cycle, a restart RESUMES from the last persisted
// status - completed jobs stay completed (resolveResume-style idempotency).
// SIMULATION-ONLY execution: the driver hands "run" actions to a simulation
// adapter (executed:false). It NEVER spawns, sends, pushes, or deploys, and it
// halts on owner_stop/pause (fail-closed).
//
// This is the CONTRACT the real deployed worker implements (see the durable
// runtime owner packet). Until migration 0010 is applied and this runs on the
// staging host under the existing dispatcher, NO durable runtime exists.

import type { RuntimeClient } from '../store';
import { readSystemControlsChecked } from '../store';
import { step, type EngineAction } from './completion-engine';
import { makeSimulationAdapter } from './adapters';
import {
  listGoals,
  listJobsForGoal,
  readApprovalRecord,
  transitionGoal,
  transitionJob,
  verifyAuthoritativeApproval,
} from './store';
import { actionHash } from './approvals';
import {
  acquireWorktreeLock,
  releaseWorktreeLock,
} from './worktree-lock-store';

// Optional worktree-lock context: when provided, the driver acquires an
// isolated worktree lock BEFORE running an implementation-kind job and
// releases it after - proving the one-worktree-per-job isolation contract
// end to end (even in simulation). base_commit is the pinned base; a token
// minter yields a per-job ownership token. Omitted => runs without the lock
// (pure orchestration simulation).
export interface DriverLockContext {
  base_commit: string; // pinned base (7-40 hex)
  allowed_paths: string[];
  token: (jobId: string) => string;
}

const EDIT_KINDS = new Set(['code', 'test', 'migration', 'repair', 'documentation']);
import type {
  AgentRole,
  ExecutionBudget,
  GoalJob,
  GoalState,
  MasterGoal,
} from './model';
import { DEFAULT_BUDGET } from './model';

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function budgetFrom(v: unknown): ExecutionBudget {
  const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    max_iterations: num(b.max_iterations, DEFAULT_BUDGET.max_iterations),
    max_job_retries: num(b.max_job_retries, DEFAULT_BUDGET.max_job_retries),
    max_wall_ms: num(b.max_wall_ms, DEFAULT_BUDGET.max_wall_ms),
    max_jobs: num(b.max_jobs, DEFAULT_BUDGET.max_jobs),
  };
}

function goalFromRow(r: Record<string, unknown>): MasterGoal {
  return {
    id: String(r.id), title: String(r.title ?? ''), objective: String(r.objective ?? ''),
    source: (r.source as MasterGoal['source']) ?? 'dashboard',
    requested_by: String(r.requested_by ?? ''),
    status: (r.status as MasterGoal['status']) ?? 'proposed',
    environment: 'staging', budget: budgetFrom(r.budget),
    correlation_id: String(r.correlation_id ?? ''), simulation_only: true,
    created_at: String(r.created_at ?? ''), updated_at: String(r.updated_at ?? ''),
  };
}

function jobFromRow(r: Record<string, unknown>): GoalJob {
  const deps = Array.isArray(r.depends_on) ? (r.depends_on as string[]) : [];
  return {
    id: String(r.id), goal_id: String(r.goal_id), kind: (r.kind as GoalJob['kind']) ?? 'unknown',
    title: String(r.title ?? ''), objective: String(r.objective ?? ''),
    risk_class: (r.risk_class as GoalJob['risk_class']) ?? 'GREEN',
    assigned_role: (r.assigned_role as AgentRole | null) ?? null,
    depends_on: deps, status: (r.status as GoalJob['status']) ?? 'pending',
    attempts: num(r.attempts, 0), requires_approval: r.requires_approval === true,
    approval_id: r.approval_id ? String(r.approval_id) : null,
    runtime_job_id: r.runtime_job_id ? String(r.runtime_job_id) : null,
    correlation_id: String(r.correlation_id ?? ''),
    evidence_refs: Array.isArray(r.evidence_refs) ? (r.evidence_refs as string[]) : [],
    failure_reason: r.failure_reason ? String(r.failure_reason) : null,
    created_at: String(r.created_at ?? ''), updated_at: String(r.updated_at ?? ''),
  };
}

// Reconstruct a GoalState from persisted rows. Dependency edges are read from
// job_dependencies via the caller-provided depends map (or embedded on rows).
export async function loadGoalState(
  client: RuntimeClient,
  goalId: string,
  depends: (jobId: string) => string[] = () => [],
): Promise<GoalState | null> {
  const goals = await listGoals(client, 200);
  const grow = goals.rows.find((r) => String(r.id) === goalId);
  if (!grow) return null;
  const jobsRes = await listJobsForGoal(client, goalId, 500);
  const jobs = jobsRes.rows.map((r) => {
    const j = jobFromRow(r);
    if (j.depends_on.length === 0) j.depends_on = depends(j.id);
    return j;
  });
  const goal = goalFromRow(grow);
  return { goal, jobs, iteration: num(grow.iteration, 0), started_at: goal.created_at };
}

export interface DriverStepResult {
  halted: boolean;
  reason: string;
  actions: EngineAction[];
  persisted: number; // number of DB transitions applied
}

// Advance one durable step. Halts fail-closed on owner_stop/execution-disabled
// unreadable controls. Persists each transition via CAS; a lost CAS (another
// worker moved the job) is skipped, not forced - safe for concurrent workers.
export async function driverStep(
  client: RuntimeClient,
  goalId: string,
  nowMs: number,
  depends: (jobId: string) => string[] = () => [],
  lockCtx?: DriverLockContext,
): Promise<DriverStepResult> {
  const controls = await readSystemControlsChecked(client);
  // The durable worker advances SIMULATION jobs even while execution is
  // disabled (that is the drill), but owner_stop / unreadable controls halt.
  if (!controls.readOk || controls.controls.owner_stop || controls.controls.paused) {
    return { halted: true, reason: 'owner_stop_or_unreadable', actions: [], persisted: 0 };
  }
  const state = await loadGoalState(client, goalId, depends);
  if (!state) return { halted: true, reason: 'goal_not_found', actions: [], persisted: 0 };
  const nowIso = new Date(nowMs).toISOString();

  // AUTHORITATIVE approval gate: for every job awaiting approval, read its
  // approval record and clear requires_approval ONLY if the record
  // authoritatively approves THIS job (verifyAuthoritativeApproval). A forged
  // or absent approval_id can never unlock execution - the record must be
  // approved, owner-bound, hash-bound, scope-bound, non-expired. This mutates
  // the in-memory state before the engine step and persists the clear.
  for (const job of state.jobs) {
    if (job.status !== 'awaiting_approval' || !job.requires_approval || !job.approval_id) continue;
    const record = await readApprovalRecord(client, job.approval_id);
    const expectedHash = actionHash(`${job.kind}: ${job.objective || job.title}`, `goal_job:${job.id}`, 'staging');
    const check = verifyAuthoritativeApproval(record, job, {
      owner_identity: state.goal.requested_by,
      action_hash: expectedHash,
    });
    if (check.ok) {
      const t = await transitionJob(client, job.id, 'awaiting_approval', 'ready', {}, nowIso);
      if (t.ok) { job.requires_approval = false; job.status = 'ready'; }
    }
    // not authoritatively approved => stays awaiting_approval (fail-closed)
  }

  const s = step(state, nowMs);
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  let persisted = 0;

  for (const act of s.actions) {
    const jobId = (act as { job_id?: string }).job_id;
    const job = jobId ? byId.get(jobId) : undefined;
    if (act.type === 'run' && job) {
      // Isolation gate: an implementation job acquires its own worktree lock
      // BEFORE running. A lost acquisition (another holder) skips the run this
      // cycle - concurrent-safe. Released after the simulated run.
      const needsLock = lockCtx && EDIT_KINDS.has(job.kind);
      const worktreeId = `wt-${job.id}`;
      const token = needsLock ? lockCtx!.token(job.id) : '';
      let fence = 0;
      if (needsLock) {
        const acq = await acquireWorktreeLock(client, {
          worktree_id: worktreeId, repo: 'preston-os', job_id: job.id,
          owner: job.assigned_role ?? 'claude', token,
          base_commit: lockCtx!.base_commit, branch: `wt/${job.id}`,
          allowed_paths: lockCtx!.allowed_paths, now: nowIso,
          tree_dirty: false, branch_exists: false,
        });
        if (!acq.ok) continue; // held by another / unsafe => skip this cycle
        fence = acq.lock.fence;
      }
      // Two-phase: mark in_progress (a real running state, restart-visible),
      // then let the SIMULATION adapter complete/fail it. Both are CAS.
      const mark = await transitionJob(client, job.id, job.status, 'in_progress', {}, nowIso);
      if (!mark.ok) {
        if (needsLock) await releaseWorktreeLock(client, worktreeId, token, fence, nowIso);
        continue; // another worker took it (concurrent-safe)
      }
      const res = makeSimulationAdapter(job.assigned_role ?? 'claude').runJob(job, nowIso);
      const to = res.outcome === 'completed' ? 'completed' : 'failed';
      const t = await transitionJob(client, job.id, 'in_progress', to, {
        attempts: job.attempts + 1,
        failure_reason: res.failure_reason,
      }, nowIso);
      if (t.ok) persisted++;
      if (needsLock) await releaseWorktreeLock(client, worktreeId, token, fence, nowIso);
    } else if (act.type === 'assign' && job) {
      const t = await transitionJob(client, job.id, job.status, 'assigned', { assigned_role: act.role }, nowIso);
      if (t.ok) persisted++;
    } else if (act.type === 'retry' && job) {
      const t = await transitionJob(client, job.id, job.status, 'ready', { failure_reason: null }, nowIso);
      if (t.ok) persisted++;
    } else if (act.type === 'dead_letter' && job) {
      const t = await transitionJob(client, job.id, job.status, 'dead_lettered', { failure_reason: act.reason }, nowIso);
      if (t.ok) persisted++;
    }
    // request_approval / audit / escalate: the driver records but does NOT
    // decide approvals (owner-only) - handled by the approval router + owner.
  }

  // Reflect the engine's goal status onto the persisted goal (CAS).
  if (s.status !== state.goal.status) {
    await transitionGoal(client, goalId, state.goal.status, s.status, nowIso);
  }
  return { halted: false, reason: s.reason, actions: s.actions, persisted };
}

// Restart-safe drive: bounded loop over driverStep until done/halted. Reloads
// state each cycle (so a crash mid-loop simply re-reads persisted status on
// the next process start). maxCycles is a harness backstop atop engine budgets.
export async function driveGoal(
  client: RuntimeClient,
  goalId: string,
  now: () => number,
  maxCycles = 500,
  depends: (jobId: string) => string[] = () => [],
  lockCtx?: DriverLockContext,
): Promise<{ cycles: number; halted: boolean; reason: string }> {
  let cycles = 0;
  let lastReason = 'noop';
  while (cycles++ < Math.min(maxCycles, 5000)) {
    const r = await driverStep(client, goalId, now(), depends, lockCtx);
    lastReason = r.reason;
    if (r.halted) return { cycles, halted: true, reason: r.reason };
    // Reload to check terminality (restart-safe: state is authoritative in DB).
    const state = await loadGoalState(client, goalId, depends);
    if (!state) return { cycles, halted: true, reason: 'goal_not_found' };
    const done = state.jobs.every((j) => ['completed', 'cancelled', 'dead_lettered'].includes(j.status));
    const blockedOnApproval = state.jobs.some((j) => j.status === 'awaiting_approval') &&
      state.jobs.every((j) => ['completed', 'cancelled', 'dead_lettered', 'awaiting_approval'].includes(j.status));
    if (done) return { cycles, halted: false, reason: 'completed' };
    if (blockedOnApproval) return { cycles, halted: false, reason: 'awaiting_owner_approval' };
  }
  return { cycles, halted: true, reason: lastReason };
}
