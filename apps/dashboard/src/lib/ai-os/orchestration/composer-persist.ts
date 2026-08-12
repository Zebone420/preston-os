// Preston AI OS - Phase 7 Composer confirmation persistence. SERVER-ONLY
// (node:crypto for deterministic ids). The OWNER-CONFIRMATION boundary:
// nothing here runs until the owner explicitly confirms a previewed proposal,
// and everything it creates is simulation-only staging state (goals, jobs,
// dependency edges, PENDING approval requests). Nothing executes, sends,
// deploys, or approves - approvals are born pending and only the owner-run
// decide_orchestration_approval RPC can decide them.
//
// Idempotency design: every durable id is DERIVED from the confirmation's
// request key (sha256 -> uuid shape), and the goal's correlation_id binds the
// payload digest. The atomic submit_goal_decomposition RPC (migration 0010)
// then enforces, in one transaction with an advisory lock:
//   - same key + same payload  => same id + same correlation => {created:false}
//     (replay; nothing inserted twice)
//   - same key + different payload => same id, different correlation
//     => idempotency_conflict (rejected; a key can never be silently reused)
//   - any mid-graph failure => full rollback (no partial goal graph)
// Approval rows are inserted AFTER the atomic graph commit (the approval FK
// needs the job rows); a failure there triggers a compensating goal
// cancellation so no ACTIVE partial graph ever remains.

import { createHash } from 'node:crypto';
import { RUNTIME_ID_RE } from '../commands';
import { deploymentEnvironment } from '../runtime-environment';
import type { RuntimeClient } from '../store';
import { composeRequest, type ComposedGoal, type ComposerProposal } from './composer';
import { decomposeGoal, type TaskSpec } from './decomposition';
import { DEFAULT_BUDGET, type GoalJob, type MasterGoal } from './model';
import {
  ORCH_TABLES,
  insertJobApproval,
  listJobsForGoal,
  readGoalById,
  transitionGoal,
  transitionJob,
} from './store';

// The confirmation path requires the atomic RPC surface in addition to the
// runtime CRUD surface. The real server Supabase client provides .rpc();
// tests inject a fake.
export interface ComposerClient extends RuntimeClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // owner decision window

// Deterministic uuid-shaped id from a seed (sha256, version/variant bits set
// so the string satisfies the DB uuid columns). Same seed => same id, which
// is exactly what makes duplicate confirmation collide instead of duplicate.
export function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed, 'utf8').digest('hex');
  return (
    h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20) + '-' +
    h.slice(20, 32)
  );
}

// sha256 payload digest of the proposal's semantic content (stronger than the
// display FNV hash; embedded in correlation_id so the DB-level idempotency
// check also binds the payload).
export function payloadDigest(goals: ComposedGoal[]): string {
  const canon = JSON.stringify(goals.map((g) => ({
    l: g.local_id, t: g.title, o: g.objective,
    k: g.tasks.map((x) => [x.local_id, x.kind, x.title, x.objective,
      x.depends_on_local, x.requested_role, x.requires_approval]),
  })));
  return createHash('sha256').update(canon, 'utf8').digest('hex').slice(0, 12);
}

export interface CreatedGoalGraph {
  goal_local_id: string;
  goal_id: string;
  correlation_id: string;
  replayed: boolean;
  job_ids: Array<{ local_id: string; job_id: string; title: string; requires_approval: boolean }>;
  approval_ids: Array<{ job_id: string; approval_id: string }>;
}

export type ConfirmOutcome =
  | { ok: true; replayed: boolean; created: CreatedGoalGraph[] }
  | { ok: false; errors: string[]; compensated: string[] };

export interface ConfirmInput {
  ownerEmail: string;
  rawRequest: string;
  requestKey: string; // request-level idempotency key minted at compose time
  presentedHash: string; // proposal_hash the owner saw and confirmed
  now: string;
}

// Build the durable jobs for one composed goal. Reuses decomposeGoal (the
// authoritative decomposition + policy + contract checks), then applies the
// owner's explicitly requested role where the contract allows it.
function buildJobs(
  goal: MasterGoal,
  cg: ComposedGoal,
  requestKey: string,
  now: string,
): { ok: true; jobs: GoalJob[] } | { ok: false; errors: string[] } {
  const specs: TaskSpec[] = cg.tasks.map((t) => ({
    local_id: t.local_id,
    kind: t.kind,
    title: t.title,
    objective: t.objective,
    depends_on_local: t.depends_on_local,
  }));
  const d = decomposeGoal(
    goal, specs,
    (localId) => deterministicUuid(`${requestKey}:${cg.local_id}:${localId}`),
    now,
  );
  if (!d.ok) return d;
  const byLocal = new Map(cg.tasks.map((t) => [t.local_id, t]));
  const jobs = d.jobs.map((j) => {
    const src = byLocal.get(j.correlation_id.split(':').pop() ?? '');
    // decomposition assigns audit->audit, else claude; honor an explicit
    // codex request (codex holds the same edit contract as claude).
    if (src && src.requested_role === 'codex' && j.assigned_role === 'claude') {
      return { ...j, assigned_role: 'codex' as const };
    }
    return j;
  });
  return { ok: true, jobs };
}

// Confirm a previously previewed proposal. Recomputes the interpretation
// server-side from the SAME raw request (the client can never submit a
// tampered proposal - only the raw text + the hash it previewed), then
// persists atomically and idempotently.
export async function confirmComposedRequest(
  client: ComposerClient,
  input: ConfirmInput,
): Promise<ConfirmOutcome> {
  const errors: string[] = [];
  if (!RUNTIME_ID_RE.test(input.requestKey)) errors.push('request_key_invalid');
  if (!input.ownerEmail?.trim()) errors.push('owner_identity_required');
  if (!Number.isFinite(Date.parse(input.now))) errors.push('now_invalid');
  if (errors.length) return { ok: false, errors, compensated: [] };

  // Re-interpret the raw request; the deterministic engine yields the same
  // proposal the owner previewed, or the confirmation is refused.
  const composed = composeRequest(input.rawRequest);
  if (!composed.ok) {
    return { ok: false, errors: ['compose_failed', ...composed.errors], compensated: [] };
  }
  if (composed.proposal_hash !== input.presentedHash) {
    return { ok: false, errors: ['proposal_hash_mismatch'], compensated: [] };
  }

  const digest = payloadDigest(composed.goals);
  const created: CreatedGoalGraph[] = [];
  const createdGoalIds: string[] = [];
  let anyReplay = false;

  for (const cg of composed.goals) {
    const goalId = deterministicUuid(`${input.requestKey}:${cg.local_id}`);
    const correlationId =
      `cmp-${input.requestKey.slice(0, 24)}-${cg.local_id}-${digest}`;
    const goal: MasterGoal = {
      id: goalId,
      title: cg.title,
      objective: cg.objective,
      source: 'dashboard',
      requested_by: input.ownerEmail,
      status: 'decomposed',
      environment: deploymentEnvironment(),
      budget: DEFAULT_BUDGET,
      correlation_id: correlationId,
      simulation_only: true,
      created_at: input.now,
      updated_at: input.now,
    };
    const built = buildJobs(goal, cg, input.requestKey, input.now);
    if (!built.ok) {
      return await compensate(client, createdGoalIds, input.now,
        ['decompose_failed:' + built.errors.join(','), `goal:${cg.local_id}`]);
    }

    // Atomic, idempotent graph commit (goal + jobs + edges in one
    // transaction; replay-safe; payload-mismatch-safe). approval_id is NOT
    // set here - the approval rows do not exist yet (FK order).
    const rpcRes = await client.rpc('submit_goal_decomposition', {
      p_goal: {
        id: goal.id, title: goal.title, objective: goal.objective,
        source: goal.source, requested_by: goal.requested_by,
        status: 'decomposed', budget: goal.budget,
        correlation_id: goal.correlation_id,
      },
      p_jobs: built.jobs.map((j) => ({
        id: j.id, kind: j.kind, title: j.title, objective: j.objective,
        risk_class: j.risk_class, assigned_role: j.assigned_role,
        status: 'pending', attempts: 0,
        requires_approval: j.requires_approval, approval_id: null,
        runtime_job_id: null, correlation_id: j.correlation_id,
        evidence_refs: [],
      })),
      p_deps: built.jobs.flatMap((j) =>
        j.depends_on.map((dep) => ({ job_id: j.id, depends_on_job_id: dep }))),
    });
    if (rpcRes.error) {
      const msg = rpcRes.error.message;
      if (/idempotency_conflict/i.test(msg)) {
        return await compensate(client, createdGoalIds, input.now,
          ['idempotency_key_payload_mismatch']);
      }
      return await compensate(client, createdGoalIds, input.now,
        ['persist_failed:' + msg, `goal:${cg.local_id}`]);
    }
    const rpcData = (rpcRes.data ?? {}) as Record<string, unknown>;
    const replayed = rpcData['created'] === false;
    anyReplay = anyReplay || replayed;
    if (!replayed) createdGoalIds.push(goalId);

    // Approval requests for gated jobs: born PENDING, owner-bound,
    // hash-bound, expiring. Idempotent on approval_id (derived), so a replay
    // that reaches this path inserts nothing new.
    const approvalIds: Array<{ job_id: string; approval_id: string }> = [];
    for (const j of built.jobs) {
      if (!j.requires_approval) continue;
      const approvalId =
        'apr-' + createHash('sha256')
          .update(`${input.requestKey}:${cg.local_id}:${j.id}`, 'utf8')
          .digest('hex').slice(0, 24);
      const a = await insertJobApproval(client, {
        approval_id: approvalId,
        goal_id: goalId,
        job: {
          id: j.id, kind: j.kind, objective: j.objective, title: j.title,
          risk_class: j.risk_class, assigned_role: j.assigned_role,
        },
        owner_identity: input.ownerEmail,
        created_at: input.now,
        expires_at: new Date(Date.parse(input.now) + APPROVAL_TTL_MS).toISOString(),
        reason: 'composer: task requires owner approval by policy',
        expected_effect: 'simulation-only gated job may run after owner approval',
        rollback_plan: 'reject or let the approval expire; the job stays parked',
      });
      if (!a.ok) {
        return await compensate(client, createdGoalIds, input.now,
          ['approval_create_failed:' + (a.error ?? approvalId)]);
      }
      // Link the job to its approval (CAS on the still-pending row). The
      // driver reads job.approval_id to find the record to verify.
      const link = await linkJobApproval(client, j.id, approvalId, input.now);
      if (!link.ok) {
        return await compensate(client, createdGoalIds, input.now,
          ['approval_link_failed:' + (link.error ?? j.id)]);
      }
      approvalIds.push({ job_id: j.id, approval_id: approvalId });
    }

    created.push({
      goal_local_id: cg.local_id,
      goal_id: goalId,
      correlation_id: correlationId,
      replayed,
      job_ids: built.jobs.map((j) => ({
        local_id: j.correlation_id.split(':').pop() ?? '',
        job_id: j.id,
        title: j.title,
        requires_approval: j.requires_approval,
      })),
      approval_ids: approvalIds,
    });
  }

  return { ok: true, replayed: anyReplay, created };
}

interface LinkOutcome { ok: boolean; error?: string }

// Set goal_jobs.approval_id on a still-pending job. Not a status transition;
// a plain guarded update. Idempotent: a replay writes the same value.
async function linkJobApproval(
  client: ComposerClient,
  jobId: string,
  approvalId: string,
  nowIso: string,
): Promise<LinkOutcome> {
  try {
    const res = await client
      .from(ORCH_TABLES.jobs)
      .update({ approval_id: approvalId, updated_at: nowIso })
      .eq('id', jobId)
      .eq('status', 'pending')
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      // Already linked on a replay (or moved on): verify rather than fail.
      const row = await client.from(ORCH_TABLES.jobs).select('*').eq('id', jobId).limit(1);
      const existing = row.data?.[0];
      if (existing && String(existing.approval_id ?? '') === approvalId) {
        return { ok: true };
      }
      return { ok: false, error: 'job_not_linkable' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'link failed' };
  }
}

// Compensating cancellation: terminally cancel every goal graph created by
// THIS confirmation so no partial ACTIVE graph survives an error. Rows are
// never deleted (audit trail); a cancelled goal is inert - the driver and
// dispatcher only drive decomposed/running/blocked goals.
async function compensate(
  client: ComposerClient,
  goalIds: string[],
  nowIso: string,
  errors: string[],
): Promise<ConfirmOutcome> {
  const compensated: string[] = [];
  for (const goalId of goalIds) {
    const g = await readGoalById(client, goalId);
    const status = String(g.rows[0]?.status ?? '');
    if (status === 'decomposed') {
      const t = await transitionGoal(client, goalId, 'decomposed', 'cancelled', nowIso);
      if (t.ok) compensated.push(`goal:${goalId}`);
    }
    const jobs = await listJobsForGoal(client, goalId);
    for (const row of jobs.rows) {
      const from = String(row.status ?? '');
      if (from === 'pending' || from === 'ready') {
        const t = await transitionJob(client, String(row.id), from, 'cancelled', {}, nowIso);
        if (t.ok) compensated.push(`job:${row.id}`);
      }
    }
  }
  return { ok: false, errors, compensated };
}

// Compose + hash preview helper for the action layer (single import site).
export function previewProposal(raw: string): ReturnType<typeof composeRequest> {
  return composeRequest(raw);
}

export type { ComposerProposal };
