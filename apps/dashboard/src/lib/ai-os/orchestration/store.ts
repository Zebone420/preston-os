// Preston AI OS - Phase 7 durable orchestration store adapters. Server-side,
// RLS-bound (owner session via the anon key; NEVER the service-role key).
// REUSES the existing RuntimeClient/WriteOutcome idiom from ../store.ts (no
// duplicate persistence layer). Every write validates first, forces the
// simulation pins (executed:false / simulation_only:true / environment:
// staging) regardless of caller input, is idempotent on the primary key, and
// uses compare-and-set for status transitions. Reads fail closed to empty +
// error. This module persists STATE only; it executes nothing.

import type { QueryResult, RuntimeClient, WriteOutcome } from '../store';
import { validateMasterGoal, validateGoalJob } from './model';
import type { GoalJob, GoalState, MasterGoal } from './model';
import {
  canTransitionGoal,
  canTransitionJob,
} from './transitions';
import type { ApprovalRequest } from './approvals';
import { canonicalActionHash, jobApprovalEnvelope } from './crypto-binding';

export const ORCH_TABLES = {
  goals: 'master_goals',
  jobs: 'goal_jobs',
  deps: 'job_dependencies',
  approvals: 'orchestration_approvals',
} as const;

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

async function insertRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(table).insert(row).select('id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: String(row.id ?? '') };
      }
      return { ok: false, error: `${table} insert failed: ` + res.error.message };
    }
    const id = res.data?.[0]?.['id'];
    return { ok: true, id: id ? String(id) : String(row.id ?? '') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `${table} insert failed` };
  }
}

// --- master goals ----------------------------------------------------------

export async function insertMasterGoal(
  client: RuntimeClient,
  goal: MasterGoal,
): Promise<WriteOutcome> {
  const errs = validateMasterGoal(goal);
  if (errs.length) return { ok: false, error: 'invalid goal: ' + errs.join(',') };
  return insertRow(client, ORCH_TABLES.goals, {
    id: goal.id,
    title: goal.title,
    objective: goal.objective,
    source: goal.source,
    requested_by: goal.requested_by,
    status: goal.status,
    environment: 'staging', // forced
    budget: goal.budget,
    correlation_id: goal.correlation_id,
    simulation_only: true, // forced
    iteration: 0, // durable loop counter starts at 0 (matches the DB default)
  });
}

// --- goal jobs -------------------------------------------------------------

export async function insertGoalJob(
  client: RuntimeClient,
  job: GoalJob,
): Promise<WriteOutcome> {
  const errs = validateGoalJob(job);
  if (errs.length) return { ok: false, error: 'invalid job: ' + errs.join(',') };
  return insertRow(client, ORCH_TABLES.jobs, {
    id: job.id,
    goal_id: job.goal_id,
    kind: job.kind,
    title: job.title,
    objective: job.objective,
    risk_class: job.risk_class,
    assigned_role: job.assigned_role,
    status: job.status,
    attempts: job.attempts,
    requires_approval: job.requires_approval,
    approval_id: job.approval_id,
    runtime_job_id: job.runtime_job_id,
    correlation_id: job.correlation_id,
    evidence_refs: job.evidence_refs,
    executed: false, // forced (DB CHECK also pins it)
  });
}

// Persist a whole decomposed goal: goal, jobs, and dependency edges. Each
// insert is idempotent; a dependency edge is written for every depends_on.
export async function persistDecomposedGoal(
  client: RuntimeClient,
  state: GoalState,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const g = await insertMasterGoal(client, state.goal);
  if (!g.ok) errors.push(g.error ?? 'goal');
  for (const job of state.jobs) {
    const j = await insertGoalJob(client, job);
    if (!j.ok) errors.push(j.error ?? `job:${job.id}`);
  }
  for (const job of state.jobs) {
    for (const dep of job.depends_on) {
      const d = await insertRow(client, ORCH_TABLES.deps, {
        goal_id: state.goal.id,
        job_id: job.id,
        depends_on_job_id: dep,
      });
      if (!d.ok) errors.push(d.error ?? `dep:${job.id}->${dep}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// --- CAS status transitions (guarded + compare-and-set) --------------------

async function casStatus(
  client: RuntimeClient,
  table: string,
  id: string,
  fromStatus: string,
  patch: Record<string, unknown>,
  guard: (from: string, to: string) => boolean,
  nowIso: string,
  conds: Array<{ col: string; val: string }> = [],
): Promise<WriteOutcome> {
  const to = String(patch.status ?? '');
  if (!guard(fromStatus, to)) {
    return { ok: false, error: `illegal_transition:${fromStatus}->${to}` };
  }
  try {
    let q = client
      .from(table)
      .update({ ...patch, updated_at: nowIso })
      .eq('id', id)
      .eq('status', fromStatus);
    // Extra CAS conditions (audit BLOCKER/TOCTOU): the update also matches
    // ownership (run_id) or every action-defining field, so only the exact
    // observed row transitions - atomically, on the single row.
    for (const c of conds) q = q.eq(c.col, c.val);
    const res = await q.select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'status_changed_elsewhere' };
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'transition failed' };
  }
}

export function transitionGoal(
  client: RuntimeClient, id: string, from: string, to: MasterGoal['status'],
  nowIso: string,
): Promise<WriteOutcome> {
  return casStatus(client, ORCH_TABLES.goals, id, from, { status: to }, canTransitionGoal, nowIso);
}

export function transitionJob(
  client: RuntimeClient, id: string, from: string, to: GoalJob['status'],
  patch: Record<string, unknown>, nowIso: string,
): Promise<WriteOutcome> {
  return casStatus(client, ORCH_TABLES.jobs, id, from, { ...patch, status: to }, canTransitionJob, nowIso);
}

// Transition a job ONLY if it is still owned by the given run_id (audit
// BLOCKER): the terminal result CAS (in_progress -> completed/failed) and
// lease-expiry recovery (in_progress -> ready) are conditioned on the run that
// claimed the job, so a superseded, revived, or crashed worker can never
// persist a result or requeue a run it no longer owns. Atomic on the job row.
export function transitionJobOwned(
  client: RuntimeClient, id: string, from: string, to: GoalJob['status'],
  runId: string, patch: Record<string, unknown>, nowIso: string,
): Promise<WriteOutcome> {
  return casStatus(
    client, ORCH_TABLES.jobs, id, from, { ...patch, status: to }, canTransitionJob, nowIso,
    [{ col: 'run_id', val: runId }],
  );
}

// Atomically clear a gated job's approval (audit MAJOR/TOCTOU): transition
// awaiting_approval -> ready AND set requires_approval=false, but ONLY if EVERY
// action-defining field still matches what was verified/approved. If any bound
// field (kind/objective/title/risk/role/approval_id/goal_id) was mutated
// between verification and this write, the CAS matches zero rows and the gate
// does NOT clear - so a swapped action can never inherit an old approval.
//
// Why the single-row job CAS is sufficient here: the OTHER inputs to
// verification are already immutable-after-decision. The approval row cannot
// change post-decision - migration 0010 REVOKEs UPDATE on
// orchestration_approvals and routes the one-time pending->terminal decision
// through decide_orchestration_approval, so status/nonce/hash/owner/expiry are
// frozen once approved. The owner identity is bound INTO the action_hash, so a
// later change to master_goals.requested_by cannot retroactively make this
// frozen approval authorize a different owner. A belt-and-suspenders atomic
// three-row RPC is a documented follow-up, not required for correctness here.
export function clearApprovalGate(
  client: RuntimeClient,
  job: {
    id: string; goal_id: string; approval_id: string; kind: string;
    objective: string; title: string; risk_class: string; assigned_role: string | null;
  },
  nowIso: string,
): Promise<WriteOutcome> {
  return casStatus(
    client, ORCH_TABLES.jobs, job.id, 'awaiting_approval',
    { status: 'ready', requires_approval: false }, canTransitionJob, nowIso,
    [
      { col: 'approval_id', val: job.approval_id },
      { col: 'goal_id', val: job.goal_id },
      { col: 'kind', val: job.kind },
      { col: 'objective', val: job.objective },
      { col: 'title', val: job.title },
      { col: 'risk_class', val: job.risk_class },
      { col: 'assigned_role', val: String(job.assigned_role ?? '') },
      { col: 'requires_approval', val: 'true' },
    ],
  );
}

// --- approvals -------------------------------------------------------------

// Simulation/non-durable approval insert. Structurally CANNOT create a
// job-scoped durable authorization (audit BLOCKER): goal_id and job_id are
// forced to null, so a record from this path can never satisfy the durable
// driver's job/goal scope check (record.job_id === job.id). It also carries a
// caller-supplied action_hash, which is exactly why it must never be
// job-scoped. The ONLY path that mints a driver-acceptable job approval is
// insertJobApproval, which derives the hash internally. No production caller.
export async function insertApproval(
  client: RuntimeClient,
  req: ApprovalRequest,
): Promise<WriteOutcome> {
  return insertRow(client, ORCH_TABLES.approvals, {
    approval_id: req.approval_id,
    goal_id: null,
    job_id: null,
    action: req.action,
    environment: 'staging',
    affected_resource: req.affected_resource,
    reason: req.reason,
    risk_class: req.risk_class,
    evidence_refs: req.evidence_refs,
    expected_effect: req.expected_effect,
    rollback_plan: req.rollback_plan,
    action_hash: req.action_hash,
    owner_identity: req.owner_identity,
    nonce: null,
    status: 'pending',
    expires_at: req.expires_at,
  });
}

// Create a gated job's approval, deriving the authorization hash INTERNALLY
// from the authoritative job (audit BLOCKER). The caller can NEVER supply a
// precomputed hash whose bound action differs from what is displayed and later
// executed - create and verify use the SAME jobApprovalEnvelope, so they bind
// identically end to end. created_at/expires_at are set explicitly (not DB
// defaults) so the persisted validity window equals the hashed one.
export async function insertJobApproval(
  client: RuntimeClient,
  args: {
    approval_id: string;
    goal_id: string;
    job: {
      id: string; kind: string; objective: string; title: string;
      risk_class: string; assigned_role: string | null;
    };
    owner_identity: string;
    created_at: string;
    expires_at: string;
    reason?: string;
    expected_effect?: string;
    rollback_plan?: string;
  },
): Promise<WriteOutcome> {
  // A gated job MUST be assigned before an approval is minted (audit MAJOR):
  // the executing role is part of the authorization, and it lets the atomic
  // clearance CAS match a concrete (non-null) role - a null role could not be
  // matched by an equality CAS against a nullable column in real Postgres.
  if (!args.job.assigned_role || !String(args.job.assigned_role).trim()) {
    return { ok: false, error: 'assigned_role_required' };
  }
  const envelope = jobApprovalEnvelope({
    approval_id: args.approval_id,
    job_kind: args.job.kind,
    job_id: args.job.id,
    job_objective: args.job.objective,
    job_title: args.job.title,
    risk_class: args.job.risk_class,
    assigned_role: args.job.assigned_role ?? '',
    owner_identity: args.owner_identity,
    created_at: args.created_at,
    expires_at: args.expires_at,
  });
  return insertRow(client, ORCH_TABLES.approvals, {
    approval_id: args.approval_id,
    goal_id: args.goal_id,
    job_id: args.job.id,
    action: envelope.action,
    environment: 'staging',
    affected_resource: envelope.affected_resource,
    reason: args.reason ?? '',
    risk_class: args.job.risk_class,
    evidence_refs: [],
    expected_effect: args.expected_effect ?? '',
    rollback_plan: args.rollback_plan ?? '',
    action_hash: canonicalActionHash(envelope),
    owner_identity: args.owner_identity,
    nonce: null,
    status: 'pending',
    created_at: args.created_at,
    expires_at: args.expires_at,
  });
}

// One-time pending -> terminal decision. CAS on status='pending' so a second
// decision (or a replay) matches zero rows. The nonce write + DB unique(nonce)
// is the durable replay guard.
export async function decideApproval(
  client: RuntimeClient,
  approvalId: string,
  toStatus: 'approved' | 'rejected' | 'more_info',
  nonce: string,
  decidedAtIso: string,
): Promise<WriteOutcome> {
  if (!nonce) return { ok: false, error: 'nonce_required' };
  try {
    const res = await client
      .from(ORCH_TABLES.approvals)
      .update({ status: toStatus, decided_at: decidedAtIso, nonce })
      .eq('approval_id', approvalId)
      .eq('status', 'pending')
      .select('approval_id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: false, error: 'nonce_replay' };
      }
      return { ok: false, error: res.error.message };
    }
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'not_pending' };
    }
    return { ok: true, id: approvalId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'decide failed' };
  }
}

// --- authoritative approval verification -----------------------------------

// Verify that a persisted orchestration_approvals record AUTHORITATIVELY
// approves a specific gated job. Fail-closed: every bound field must match.
// A non-null approval_id on the job is NEVER sufficient - only a record that
// is approved, owner-bound, hash-bound, scope-bound, nonce-present, and
// non-expired unlocks execution. Returns the reason on refusal.
export interface AuthoritativeApprovalCheck {
  ok: boolean;
  reason: string;
}

export function verifyAuthoritativeApproval(
  record: Record<string, unknown> | undefined,
  job: { id: string; goal_id: string; approval_id: string | null },
  expected: { owner_identity: string; action_hash: string },
  nowMs: number,
): AuthoritativeApprovalCheck {
  if (!record) return { ok: false, reason: 'no_approval_record' };
  if (!job.approval_id) return { ok: false, reason: 'job_has_no_approval_id' };
  if (String(record.approval_id) !== job.approval_id) return { ok: false, reason: 'approval_id_mismatch' };
  if (String(record.status) !== 'approved') return { ok: false, reason: 'not_approved' };
  if (String(record.owner_identity) !== expected.owner_identity) return { ok: false, reason: 'owner_mismatch' };
  if (String(record.action_hash) !== expected.action_hash) return { ok: false, reason: 'action_hash_mismatch' };
  if (String(record.job_id) !== job.id) return { ok: false, reason: 'job_scope_mismatch' };
  if (String(record.goal_id) !== job.goal_id) return { ok: false, reason: 'goal_scope_mismatch' };
  if (String(record.environment) !== 'staging') return { ok: false, reason: 'environment_mismatch' };
  if (!record.nonce) return { ok: false, reason: 'nonce_missing' };
  const decided = Date.parse(String(record.decided_at ?? ''));
  const expires = Date.parse(String(record.expires_at ?? ''));
  if (!Number.isFinite(decided)) return { ok: false, reason: 'decision_timestamp_invalid' };
  if (Number.isFinite(expires) && decided >= expires) return { ok: false, reason: 'decision_expired' };
  // Execution-time expiry (audit #7): authorization is checked against the
  // CURRENT execution clock, not just the decision time. An approval that was
  // validly decided but has since expired must NOT authorize execution. Fail
  // closed if the execution clock OR the expiry is unparseable (a NaN clock
  // must never slip through NaN>=x === false).
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'execution_clock_invalid' };
  if (!Number.isFinite(expires) || nowMs >= expires) return { ok: false, reason: 'expired_at_execution' };
  return { ok: true, reason: 'authoritatively_approved' };
}

// Read the approval record for a job (by its approval_id) so the driver can
// verify it before clearing requires_approval.
export async function readApprovalRecord(
  client: RuntimeClient,
  approvalId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await client.from(ORCH_TABLES.approvals).select('*').eq('approval_id', approvalId).limit(1);
    if (res.error) return undefined;
    return res.data?.[0];
  } catch {
    return undefined;
  }
}

// --- reads (fail closed) ---------------------------------------------------

export interface ListOutcome {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

async function runList(q: PromiseLike<QueryResult>): Promise<ListOutcome> {
  try {
    const res = await q;
    if (res.error) return { ok: false, rows: [], error: res.error.message };
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return { ok: false, rows: [], error: e instanceof Error ? e.message : 'read failed' };
  }
}

export function listGoals(client: RuntimeClient, limit = 50): Promise<ListOutcome> {
  return runList(client.from(ORCH_TABLES.goals).select('*').order('created_at', { ascending: false }).limit(limit));
}
export function listJobsForGoal(client: RuntimeClient, goalId: string, limit = 200): Promise<ListOutcome> {
  return runList(client.from(ORCH_TABLES.jobs).select('*').eq('goal_id', goalId).order('created_at', { ascending: true }).limit(limit));
}
export function listOpenApprovals(client: RuntimeClient, limit = 50): Promise<ListOutcome> {
  return runList(client.from(ORCH_TABLES.approvals).select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(limit));
}
