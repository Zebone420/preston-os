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

import { randomUUID } from 'node:crypto';
import type { RuntimeClient } from '../store';
import { readSystemControlsChecked } from '../store';
import { step, type EngineAction } from './completion-engine';
import { makeSimulationAdapter } from './adapters';
import {
  ORCH_TABLES,
  clearApprovalGate,
  parkApprovalGate,
  listGoals,
  listJobsForGoal,
  readApprovalRecord,
  transitionGoal,
  transitionJob,
  transitionJobOwned,
  verifyAuthoritativeApproval,
} from './store';
import { canonicalActionHash, jobApprovalEnvelope } from './crypto-binding';
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
// How long a job's in_progress execution lease is valid before restart recovery
// may requeue it. Bounds orphan recovery latency; the deployment's oneshot runs
// well within this. (Simulation adapters complete within a single step.)
const RUN_LEASE_MS = 10 * 60 * 1000;
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
    run_id: r.run_id ? String(r.run_id) : null,
    run_lease_expires_at: r.run_lease_expires_at ? String(r.run_lease_expires_at) : null,
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
  lockRequired: boolean; // an edit job could not run: no lock context (#2)
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
  // Injected unique-run-ID minter (audit BLOCKER): each job claim gets a FRESH,
  // globally unique execution-incarnation id. Default is crypto.randomUUID
  // (server-side); tests inject a deterministic-but-unique counter. Ownership is
  // NEVER derived from time or the worktree token (those can repeat).
  newRunId: () => string = () => randomUUID(),
): Promise<DriverStepResult> {
  // Fail closed on a bad execution clock at the boundary (audit MINOR): a
  // non-finite nowMs would otherwise throw at new Date(nowMs).toISOString().
  if (!Number.isFinite(nowMs)) {
    return { halted: true, reason: 'execution_clock_invalid', actions: [], persisted: 0, lockRequired: false };
  }
  const controls = await readSystemControlsChecked(client);
  // The durable worker advances SIMULATION jobs even while execution is
  // disabled (that is the drill), but owner_stop / unreadable controls halt.
  if (!controls.readOk || controls.controls.owner_stop || controls.controls.paused) {
    return { halted: true, reason: 'owner_stop_or_unreadable', actions: [], persisted: 0, lockRequired: false };
  }
  const state = await loadGoalState(client, goalId, depends);
  if (!state) return { halted: true, reason: 'goal_not_found', actions: [], persisted: 0, lockRequired: false };
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
    // Canonical SHA-256 authorization binding (audit #8): rebuild the SAME
    // action envelope the owner approved (from the job being executed + the
    // record's validity window) and compare its canonical digest. The
    // non-authoritative FNV hash is NOT used in this durable auth path. Expiry
    // is checked against the CURRENT execution clock (audit #7, nowMs).
    const expectedHash = record
      ? canonicalActionHash(jobApprovalEnvelope({
          approval_id: job.approval_id,
          job_kind: job.kind,
          job_id: job.id,
          job_objective: job.objective,
          job_title: job.title,
          risk_class: job.risk_class,
          assigned_role: job.assigned_role ?? '',
          owner_identity: state.goal.requested_by,
          created_at: String(record.created_at ?? ''),
          expires_at: String(record.expires_at ?? ''),
        }))
      : '';
    const check = verifyAuthoritativeApproval(record, job, {
      owner_identity: state.goal.requested_by,
      action_hash: expectedHash,
    }, nowMs);
    if (check.ok) {
      // Atomic, TOCTOU-safe clearance (audit #6/MAJOR): the CAS clears the gate
      // ONLY if EVERY bound action field still matches what was just verified,
      // and persists requires_approval=false together with the status change -
      // so a concurrent action-swap between verify and clear cannot inherit the
      // approval, and a restart never sees a ready-but-still-gated row.
      const t = await clearApprovalGate(client, {
        id: job.id, goal_id: job.goal_id, approval_id: job.approval_id,
        kind: job.kind, objective: job.objective, title: job.title,
        risk_class: job.risk_class, assigned_role: job.assigned_role ?? null,
      }, nowIso);
      if (t.ok) { job.requires_approval = false; job.status = 'ready'; }
    }
    // not authoritatively approved => stays awaiting_approval (fail-closed)
  }

  // Restart recovery (audit #4): a job persisted as in_progress across a step
  // boundary is owned by a prior run via its execution lease (run_id +
  // run_lease_expires_at). Recover it ONLY when that lease has DEFINITELY
  // expired, and CAS the requeue on the SAME run_id - so a genuinely running
  // worker (live lease) is never disturbed, and a lock/DB read that cannot
  // prove expiry never requeues (fail-closed). No worktree read is involved, so
  // a transient lock-read failure cannot masquerade as "unlocked".
  for (const job of state.jobs) {
    if (job.status !== 'in_progress') continue;
    const leaseMs = Date.parse(job.run_lease_expires_at ?? '');
    const expired = Number.isFinite(leaseMs) && leaseMs <= nowMs;
    if (!expired) continue; // live lease OR unknown expiry => leave it (fail-closed)
    const rec = await transitionJobOwned(
      client, job.id, 'in_progress', 'ready', job.run_id ?? '',
      { run_id: null, run_lease_expires_at: null, failure_reason: null }, nowIso,
    );
    if (rec.ok) job.status = 'ready';
  }

  // Hard-cap preflight (audit #12 MAJOR): never RESERVE past the durable cap.
  // At/over max_iterations, skip reservation and let the engine escalate/
  // dead-letter this step - the cap is enforced and never exceeded.
  const atCap = state.iteration >= state.goal.budget.max_iterations;
  if (!atCap) {
    // Reserve THIS iteration BEFORE doing work: CAS iteration N -> N+1. A lost
    // CAS (another worker took it) or a DB error HALTS fail-closed - work is
    // never done on an unreserved iteration.
    const reserve = await client
      .from(ORCH_TABLES.goals)
      .update({ iteration: state.iteration + 1, updated_at: nowIso })
      .eq('id', goalId)
      .eq('iteration', String(state.iteration))
      .select('id');
    if (reserve.error) {
      return { halted: true, reason: 'iteration_reserve_error', actions: [], persisted: 0, lockRequired: false };
    }
    if (!reserve.data || reserve.data.length === 0) {
      return { halted: true, reason: 'iteration_reserved_by_other', actions: [], persisted: 0, lockRequired: false };
    }
  }

  const s = step(state, nowMs);
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  let persisted = 0;
  let lockRequired = false;

  for (const act of s.actions) {
    const jobId = (act as { job_id?: string }).job_id;
    const job = jobId ? byId.get(jobId) : undefined;
    if (act.type === 'run' && job) {
      const isEdit = EDIT_KINDS.has(job.kind);
      // Mandatory-lock gate (audit #2): an edit-capable job (code/test/
      // migration/repair/documentation) must NEVER run without an acquired
      // worktree lock. With no lock context we FAIL CLOSED - skip the run and
      // signal lockRequired so the loop halts rather than spinning. Read-only
      // kinds (audit/recommendation/unknown) may proceed without a lock.
      if (isEdit && !lockCtx) { lockRequired = true; continue; }
      const worktreeId = `wt-${job.id}`;
      const token = isEdit ? lockCtx!.token(job.id) : '';
      let fence = 0;
      let acquired = false;
      if (isEdit) {
        const acq = await acquireWorktreeLock(client, {
          worktree_id: worktreeId, repo: 'preston-os', job_id: job.id,
          owner: job.assigned_role ?? 'claude', token,
          base_commit: lockCtx!.base_commit, branch: `wt/${job.id}`,
          allowed_paths: lockCtx!.allowed_paths, now: nowIso,
          tree_dirty: false, branch_exists: false,
        });
        if (!acq.ok) continue; // held by another / unsafe => skip this cycle
        fence = acq.lock.fence;
        acquired = true;
      }
      try {
        // Re-observe controls AFTER acquiring the lock (audit #9): the owner may
        // have stopped/paused during acquisition. Fail closed; finally releases.
        const gate = await readSystemControlsChecked(client);
        if (!gate.readOk || gate.controls.owner_stop || gate.controls.paused) {
          return { halted: true, reason: 'owner_stop_or_unreadable', actions: s.actions, persisted, lockRequired };
        }
        // Claim the job with an EXECUTION LEASE (audit BLOCKER): CAS the job to
        // in_progress and stamp THIS run's run_id + lease. Only one run wins the
        // status CAS, so the job is owned by exactly one run. The worktree lock
        // (edit jobs) provides filesystem isolation; the run_id provides atomic
        // RESULT ownership on the single job row - decoupled, no cross-table
        // TOCTOU. A lost claim (another run took it) skips; finally releases.
        const runId = `${job.id}:${newRunId()}`; // globally unique per claim
        const runLeaseIso = new Date(nowMs + RUN_LEASE_MS).toISOString();
        const mark = await transitionJob(client, job.id, job.status, 'in_progress',
          { run_id: runId, run_lease_expires_at: runLeaseIso }, nowIso);
        if (!mark.ok) continue;
        const res = makeSimulationAdapter(job.assigned_role ?? 'claude').runJob(job, nowIso);
        // Re-observe controls AFTER the adapter, BEFORE persisting the result
        // (audit #9): if the owner stopped mid-run, do NOT persist completion.
        // Requeue THIS run to ready (owned by run_id) so it re-runs once the
        // stop clears; then halt. finally releases the worktree lock.
        const gate2 = await readSystemControlsChecked(client);
        if (!gate2.readOk || gate2.controls.owner_stop || gate2.controls.paused) {
          const requeue = await transitionJobOwned(client, job.id, 'in_progress', 'ready', runId,
            { run_id: null, run_lease_expires_at: null, failure_reason: null }, nowIso);
          // Distinguish an immediate requeue from one deferred to lease recovery
          // (audit MINOR) so operators know whether recovery is already pending.
          const reason = requeue.ok ? 'owner_stop_during_run' : 'owner_stop_during_run:requeue_deferred';
          return { halted: true, reason, actions: s.actions, persisted, lockRequired };
        }
        const to = res.outcome === 'completed' ? 'completed' : 'failed';
        // Evidence, persisted idempotently and BOUND to this run (audit #15):
        // the ref carries the goal/job/run/attempt/outcome so it is traceable,
        // and it is written INSIDE the run-owned terminal CAS below - so exactly
        // one owning run records it, once, per attempt (a superseded/recovered
        // run cannot append; retries accumulate one ref per distinct run_id).
        // Invariant: the driver's run-owned terminal transition is the SOLE
        // writer of evidence_refs, so this read-modify-append cannot lose a
        // concurrent evidence write (none exists by design). A DB-side jsonb
        // append RPC would be the belt-and-suspenders against a hypothetical
        // out-of-band direct UPDATE to the row.
        const evidenceRef = `sim:goal:${goalId}:job:${job.id}:run:${runId}:attempt:${job.attempts + 1}:${to}`;
        // Result persistence OWNED by run_id (audit BLOCKER): atomic on the job
        // row and conditioned on the SAME run_id, so a superseded, revived, or
        // recovered run - or an out-of-band cancellation (status no longer
        // in_progress) - can never persist a result it does not own. Clears the
        // lease on the terminal transition.
        const t = await transitionJobOwned(client, job.id, 'in_progress', to, runId, {
          attempts: job.attempts + 1,
          failure_reason: res.failure_reason,
          evidence_refs: [...job.evidence_refs, evidenceRef],
          run_id: null,
          run_lease_expires_at: null,
        }, nowIso);
        if (t.ok) persisted++;
      } finally {
        // Guaranteed release (audit #10): the lock is released on every path -
        // success, skip, adapter throw, or mid-run halt.
        if (acquired) await releaseWorktreeLock(client, worktreeId, token, fence, nowIso);
      }
    } else if (act.type === 'assign' && job) {
      const t = await transitionJob(client, job.id, job.status, 'assigned', { assigned_role: act.role }, nowIso);
      if (t.ok) persisted++;
    } else if (act.type === 'retry' && job) {
      const t = await transitionJob(client, job.id, job.status, 'ready', { failure_reason: null }, nowIso);
      if (t.ok) persisted++;
    } else if (act.type === 'dead_letter' && job) {
      const t = await transitionJob(client, job.id, job.status, 'dead_lettered', { failure_reason: act.reason }, nowIso);
      if (t.ok) persisted++;
    } else if (act.type === 'request_approval' && job) {
      // PARK a gated job at awaiting_approval (bridge item 5): the engine asked
      // for owner approval. The driver ONLY parks it - it NEVER creates or
      // decides the approval (owner-only). The park CAS also requires the job to
      // be STILL gated, so it cannot re-park a just-cleared job. The job stays
      // parked until the authoritative approval gate above clears it.
      const t = await parkApprovalGate(client, job.id, job.status, nowIso);
      if (t.ok) persisted++;
    }
    // audit / escalate: recorded by the engine status; the driver decides no
    // approvals (owner-only) - handled by the approval gate + owner.
  }

  // (The durable iteration was already RESERVED before work above - audit #12.)

  // Reflect the engine's goal status onto the persisted goal (CAS). Do NOT
  // ignore the result (audit #13): a lost CAS (concurrent worker) or an illegal
  // edge leaves the status unchanged and self-heals next cycle (re-derived from
  // job rows); we never force a contradictory status. Surface it in the reason.
  let reason = s.reason;
  if (s.status !== state.goal.status) {
    const gt = await transitionGoal(client, goalId, state.goal.status, s.status, nowIso);
    if (!gt.ok) reason = `${s.reason}:goal_cas_unapplied`;
  }
  return { halted: false, reason, actions: s.actions, persisted, lockRequired };
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
  newRunId: () => string = () => randomUUID(),
): Promise<{ cycles: number; halted: boolean; reason: string }> {
  let cycles = 0;
  let lastReason = 'noop';
  while (cycles++ < Math.min(maxCycles, 5000)) {
    const r = await driverStep(client, goalId, now(), depends, lockCtx, newRunId);
    lastReason = r.reason;
    if (r.halted) return { cycles, halted: true, reason: r.reason };
    // Fail closed (audit #2): an edit job needed a lock but no lock context was
    // provided and nothing else progressed - do not spin; halt with a clear,
    // actionable reason rather than looping to maxCycles.
    if (r.lockRequired && r.persisted === 0) {
      return { cycles, halted: true, reason: 'lock_context_required' };
    }
    // Reload to check terminality (restart-safe: state is authoritative in DB).
    const state = await loadGoalState(client, goalId, depends);
    if (!state) return { cycles, halted: true, reason: 'goal_not_found' };
    const allTerminal = state.jobs.length > 0 &&
      state.jobs.every((j) => ['completed', 'cancelled', 'dead_lettered'].includes(j.status));
    if (allTerminal) {
      // Correct terminal semantics (audit #14): a goal is NOT "completed" merely
      // because every job is terminal. A dead-lettered job => failed; a
      // cancelled job (none dead-lettered) => cancelled; only all-completed =>
      // completed. Mirrors the completion engine's status derivation.
      const anyDead = state.jobs.some((j) => j.status === 'dead_lettered');
      const anyCancelled = state.jobs.some((j) => j.status === 'cancelled');
      const reason = anyDead ? 'failed' : anyCancelled ? 'cancelled' : 'completed';
      // Durably reflect the terminal status onto the goal row (audit MAJOR): the
      // last driverStep derived goal status BEFORE the final job transitions, so
      // the row may still read 'running'. CAS from its current status to the
      // terminal one; surface (not force) an unapplied CAS.
      const goalStatus = anyDead ? 'failed' : anyCancelled ? 'cancelled' : 'completed';
      const gt = state.goal.status === goalStatus
        ? { ok: true }
        : await transitionGoal(client, goalId, state.goal.status, goalStatus, new Date(now()).toISOString());
      return { cycles, halted: false, reason: gt.ok ? reason : `${reason}:goal_cas_unapplied` };
    }
    const blockedOnApproval = state.jobs.some((j) => j.status === 'awaiting_approval') &&
      state.jobs.every((j) => ['completed', 'cancelled', 'dead_lettered', 'awaiting_approval'].includes(j.status));
    if (blockedOnApproval) return { cycles, halted: false, reason: 'awaiting_owner_approval' };
  }
  return { cycles, halted: true, reason: lastReason };
}
