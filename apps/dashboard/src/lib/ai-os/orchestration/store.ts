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
): Promise<WriteOutcome> {
  const to = String(patch.status ?? '');
  if (!guard(fromStatus, to)) {
    return { ok: false, error: `illegal_transition:${fromStatus}->${to}` };
  }
  try {
    const res = await client
      .from(table)
      .update({ ...patch, updated_at: nowIso })
      .eq('id', id)
      .eq('status', fromStatus)
      .select('id');
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

// --- approvals -------------------------------------------------------------

export async function insertApproval(
  client: RuntimeClient,
  req: ApprovalRequest,
  goalId: string | null,
  jobId: string | null,
): Promise<WriteOutcome> {
  return insertRow(client, ORCH_TABLES.approvals, {
    approval_id: req.approval_id,
    goal_id: goalId,
    job_id: jobId,
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
