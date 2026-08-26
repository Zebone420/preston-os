// Preston Control - tool handlers. INTERFACE ADAPTER ONLY.
//
// Every handler maps 1:1 onto an EXISTING owner-session Preston function:
//   preston_status          -> readSystemControlsChecked + loadOrchestrationReadModel
//                              + loadLatestHermesStatus (the dashboard read model)
//   preston_submit_goal     -> composeRequest + confirmComposedRequest (the owner
//                              composer: deterministic decomposition, policy
//                              classification, approval gating, idempotent
//                              persistence through submit_goal_decomposition)
//   preston_get_goal        -> readGoalById + listJobsForGoal
//   preston_list_approvals  -> listOpenApprovals (+ decision_open annotation)
//   preston_decide_approval -> decide_orchestration_approval RPC (owner-only,
//                              one-time nonce, fail-closed in-transaction audit)
//   preston_get_evidence    -> goal_jobs.evidence_refs / failure_reason
//
// No business logic lives here. No shell, no SQL text, no service role. The
// client handed in is the OWNER's RLS-bound session (see auth.ts), so the DB
// remains the authority for every read and write.
//
// Output discipline: rows are PROJECTED through explicit field allowlists
// (never spread), and free-text fields are screened with hasSecretText so a
// secret can never leave through a tool result even if one were stored.

import { randomUUID } from 'node:crypto';
import { RUNTIME_ID_RE, hasSecretText } from '@/lib/ai-os/commands';
import { readSystemControlsChecked, type RuntimeClient } from '@/lib/ai-os/store';
import { composeRequest, MAX_REQUEST_CHARS } from '@/lib/ai-os/orchestration/composer';
import {
  confirmComposedRequest,
  type ComposerClient,
} from '@/lib/ai-os/orchestration/composer-persist';
import {
  loadLatestHermesStatus,
  loadOrchestrationReadModel,
} from '@/lib/ai-os/orchestration/read-model';
import {
  listJobsForGoal,
  listOpenApprovals,
  readGoalById,
} from '@/lib/ai-os/orchestration/store';
import { deploymentEnvironment } from '@/lib/ai-os/runtime-environment';

export interface ToolContext {
  client: ComposerClient;
  ownerEmail: string;
  now: string; // ISO
}

type Row = Record<string, unknown>;
const REDACTED = '[redacted]';
const MAX_REASON_CHARS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Output screen: the shared secret-text detector PLUS token-shaped patterns
// (JWT bodies, vendor key prefixes, *_token=/key= assignments) so a stored
// credential can never be reflected into the model context.
const TOKEN_SHAPES =
  /(eyJ[A-Za-z0-9_-]{10,}\.eyJ|\bsk-[A-Za-z0-9]{10,}|\bghp_[A-Za-z0-9]{10,}|\bxox[baprs]-|\bAKIA[0-9A-Z]{16}\b|\b[a-z_]*token\s*[=:]\s*\S{8,}|\b[a-z_]*key\s*[=:]\s*\S{8,})/i;

export function looksSecret(s: string): boolean {
  return hasSecretText(s) || TOKEN_SHAPES.test(s);
}

function safeText(v: unknown, max = 2000): string {
  const s = String(v ?? '');
  if (looksSecret(s)) return REDACTED;
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function safeJsonList(v: unknown, max = 50): unknown[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map((item) => {
    const s = typeof item === 'string' ? item : JSON.stringify(item);
    return looksSecret(s) ? REDACTED : item;
  });
}

export function projectGoal(r: Row) {
  return {
    goal_id: String(r['id'] ?? ''),
    title: safeText(r['title'], 200),
    objective: safeText(r['objective'], 1000),
    status: String(r['status'] ?? ''),
    source: String(r['source'] ?? ''),
    requested_by: String(r['requested_by'] ?? ''),
    environment: String(r['environment'] ?? ''),
    correlation_id: String(r['correlation_id'] ?? ''),
    simulation_only: r['simulation_only'] === true,
    iteration: Number(r['iteration'] ?? 0),
    created_at: String(r['created_at'] ?? ''),
    updated_at: String(r['updated_at'] ?? ''),
  };
}

export function projectJob(r: Row) {
  return {
    job_id: String(r['id'] ?? ''),
    goal_id: String(r['goal_id'] ?? ''),
    kind: String(r['kind'] ?? ''),
    title: safeText(r['title'], 200),
    objective: safeText(r['objective'], 1000),
    status: String(r['status'] ?? ''),
    risk_class: String(r['risk_class'] ?? ''),
    assigned_role: r['assigned_role'] == null ? null : String(r['assigned_role']),
    attempts: Number(r['attempts'] ?? 0),
    requires_approval: r['requires_approval'] === true,
    approval_id: r['approval_id'] == null ? null : String(r['approval_id']),
    failure_reason: r['failure_reason'] == null ? null : safeText(r['failure_reason'], 500),
    evidence_refs: safeJsonList(r['evidence_refs']),
    created_at: String(r['created_at'] ?? ''),
    updated_at: String(r['updated_at'] ?? ''),
  };
}

// Approval projection: nonce, action_hash and owner_identity are DELIBERATELY
// omitted (the nonce is the one-time decision credential; the owner identity
// is the caller's own email, not something to re-broadcast into chat).
export function projectApproval(r: Row, nowMs: number) {
  const exp = Date.parse(String(r['expires_at'] ?? ''));
  return {
    approval_id: String(r['approval_id'] ?? ''),
    goal_id: r['goal_id'] == null ? null : String(r['goal_id']),
    job_id: r['job_id'] == null ? null : String(r['job_id']),
    action: safeText(r['action'], 300),
    affected_resource: safeText(r['affected_resource'], 300),
    reason: safeText(r['reason'], 500),
    risk_class: String(r['risk_class'] ?? ''),
    environment: String(r['environment'] ?? ''),
    expected_effect: safeText(r['expected_effect'], 500),
    rollback_plan: safeText(r['rollback_plan'], 500),
    status: String(r['status'] ?? ''),
    created_at: String(r['created_at'] ?? ''),
    expires_at: String(r['expires_at'] ?? ''),
    decided_at: r['decided_at'] == null ? null : String(r['decided_at']),
    decision_open: String(r['status'] ?? '') === 'pending' && Number.isFinite(exp) && exp > nowMs,
  };
}

// P0.1 (2026-08-26): the counts embedded in a hermes decision row's reasons
// (open_approvals:N / failed:N / dead_lettered:N) are a SNAPSHOT recorded by a
// PAST hermes tick at observed_bucket (minute granularity) over the same
// bounded recent-goals window - they are NOT live values and may lag or
// disagree with `summary` (which is computed live per read over the current
// window). Surfacing them under distinct names prevents the two metrics from
// being conflated (live drill finding: summary said 2 dead-letters while a
// stale hermes row said 5 - both correct for their own time/window).
export function parseHermesSnapshotCounts(reasons: string[]) {
  const num = (prefix: string): number | null => {
    const m = reasons.find((r) => r.startsWith(prefix));
    if (!m) return null;
    const tail = m.slice(prefix.length);
    // Strict digits only: Number('') is 0, which would fabricate a count.
    return /^\d+$/.test(tail) ? Number(tail) : null;
  };
  return {
    open_approvals: num('open_approvals:'),
    failed_jobs: num('failed:'),
    dead_lettered_jobs: num('dead_lettered:'),
  };
}

// ---------------------------------------------------------------------------
// 1. preston_status (READ ONLY)
export async function prestonStatus(ctx: ToolContext) {
  const client = ctx.client as unknown as RuntimeClient;
  const nowMs = Date.parse(ctx.now);
  const ctl = await readSystemControlsChecked(client);
  const model = await loadOrchestrationReadModel(client, 10, nowMs);
  const hermes = await loadLatestHermesStatus(client);
  const c = ctl.controls;
  const halted = c.owner_stop || c.paused;
  const posture = !ctl.readOk ? 'controls_unreadable'
    : !model.applied ? 'migration_absent'
    : halted ? 'halted'
    : 'operating';
  const attention: string[] = [];
  if (!ctl.readOk) attention.push('control plane unreadable (fail-closed)');
  if (c.owner_stop) attention.push('owner_stop is set');
  if (c.paused) attention.push('runtime is paused');
  if (model.summary.open_approvals > 0) attention.push(`${model.summary.open_approvals} approval(s) waiting for the owner`);
  if (model.summary.failed_jobs > 0) attention.push(`${model.summary.failed_jobs} failed job(s)`);
  if (model.summary.dead_lettered_jobs > 0) attention.push(`${model.summary.dead_lettered_jobs} dead-lettered job(s)`);
  if (model.summary.blocked_goals > 0) attention.push(`${model.summary.blocked_goals} blocked goal(s)`);

  return {
    generated_at: ctx.now,
    environment: deploymentEnvironment(),
    posture,
    controls: {
      readable: ctl.readOk,
      execution_enabled: c.execution_enabled,
      remote_runner_enabled: c.remote_runner_enabled,
      owner_stop: c.owner_stop,
      paused: c.paused,
      hermes_mode: c.hermes_mode,
      updated_at: c.updated_at,
    },
    hermes: {
      state: hermes.state,
      hermes_mode: hermes.hermes_mode ?? null,
      observed_bucket: hermes.observed_bucket ?? null,
      reasons: (hermes.reasons ?? []).map((r) => safeText(r, 200)),
      // Historical snapshot as of observed_bucket - NOT live. Live
      // bounded-window counts are in `summary`.
      snapshot_counts: {
        as_of_bucket: hermes.observed_bucket ?? null,
        ...parseHermesSnapshotCounts(hermes.reasons ?? []),
      },
      snapshot_note:
        'snapshot_counts were recorded by a past hermes tick at ' +
        'observed_bucket; live bounded-window counts are in summary',
    },
    summary: model.summary,
    recent_goals: model.goals.rows.map(projectGoal),
    pending_approvals: model.approvals.rows.map((r) => projectApproval(r, nowMs)),
    failures: model.failures.rows.map(projectJob),
    dead_letters: model.dead_letters.rows.map(projectJob),
    read_states: {
      goals: model.goals.state, approvals: model.approvals.state,
      jobs: model.jobs.state, failures: model.failures.state,
      dead_letters: model.dead_letters.state,
    },
    needs_attention: attention,
  };
}

// ---------------------------------------------------------------------------
// 2. preston_submit_goal (WRITE, idempotent on request_id)
export interface SubmitGoalInput {
  request: string;
  context?: string;
  priority?: 'normal' | 'high';
  request_id?: string;
}

export function normalizeRequestId(v: string | undefined): string {
  const s = (v ?? '').trim();
  // Caller-supplied ids are accepted only in the runtime-id shape; otherwise
  // a fresh key is minted (a retry WITHOUT the same id is a new request).
  return RUNTIME_ID_RE.test(s) ? s : `pc-${randomUUID()}`;
}

export async function prestonSubmitGoal(ctx: ToolContext, input: SubmitGoalInput) {
  const requestId = normalizeRequestId(input.request_id);
  const base = String(input.request ?? '').trim();
  const extra = String(input.context ?? '').trim();
  if (!base) {
    return { status: 'rejected' as const, request_id: requestId, errors: ['request_required'], goals: [] };
  }
  // The composer interprets the whole text deterministically; context is
  // appended as plain sentences (data, never instruction authority).
  let raw = extra ? `${base}\n\n${extra}` : base;
  if (input.priority === 'high') raw += '\n\nPriority: high.';
  if (raw.length > MAX_REQUEST_CHARS) {
    return { status: 'rejected' as const, request_id: requestId, errors: ['request_too_long'], goals: [] };
  }
  if (looksSecret(raw)) {
    return { status: 'rejected' as const, request_id: requestId, errors: ['secret_in_request'], goals: [] };
  }

  const composed = composeRequest(raw);
  if (!composed.ok) {
    return { status: 'rejected' as const, request_id: requestId, errors: composed.errors.slice(0, 8), goals: [] };
  }
  const outcome = await confirmComposedRequest(ctx.client, {
    ownerEmail: ctx.ownerEmail,
    rawRequest: raw,
    requestKey: requestId,
    presentedHash: composed.proposal_hash,
    now: ctx.now,
  });
  if (!outcome.ok) {
    return {
      status: 'rejected' as const,
      request_id: requestId,
      errors: outcome.errors.slice(0, 8).map((e) => safeText(e, 200)),
      compensated: outcome.compensated,
      goals: [],
    };
  }
  return {
    status: outcome.replayed ? ('duplicate' as const) : ('accepted' as const),
    request_id: requestId,
    approvals_required: composed.approvals_required,
    warnings: composed.warnings.slice(0, 8),
    goals: outcome.created.map((g) => ({
      goal_id: g.goal_id,
      correlation_id: g.correlation_id,
      replayed: g.replayed,
      jobs: g.job_ids.map((j) => ({
        job_id: j.job_id, title: safeText(j.title, 200), requires_approval: j.requires_approval,
      })),
      approval_ids: g.approval_ids.map((a) => a.approval_id),
    })),
    note: composed.approvals_required > 0
      ? 'Gated jobs await owner approval via preston_list_approvals / preston_decide_approval.'
      : 'Accepted into the Preston control plane; the runtime drives it on its next tick.',
  };
}

// ---------------------------------------------------------------------------
// 3. preston_get_goal (READ ONLY)
export async function prestonGetGoal(ctx: ToolContext, goalId: string) {
  const client = ctx.client as unknown as RuntimeClient;
  const id = String(goalId ?? '').trim();
  if (!UUID_RE.test(id)) return { found: false as const, error: 'goal_id_invalid' };
  const g = await readGoalById(client, id);
  if (!g.ok) return { found: false as const, error: 'read_failed' };
  if (g.rows.length === 0) return { found: false as const, error: 'not_found' };
  const jobs = await listJobsForGoal(client, id, 200);
  const jobRows = jobs.ok ? jobs.rows.map(projectJob) : [];
  const nowMs = Date.parse(ctx.now);
  const approvals = await listOpenApprovals(client, 50);
  const related = approvals.ok
    ? approvals.rows.filter((r) => String(r['goal_id'] ?? '') === id).map((r) => projectApproval(r, nowMs))
    : [];
  const counts: Record<string, number> = {};
  for (const j of jobRows) counts[j.status] = (counts[j.status] ?? 0) + 1;
  return {
    found: true as const,
    goal: projectGoal(g.rows[0]),
    jobs: jobRows,
    jobs_read_ok: jobs.ok,
    job_status_counts: counts,
    pending_approvals: related,
    evidence_refs: jobRows.flatMap((j) => j.evidence_refs.map((e) => ({ job_id: j.job_id, ref: e }))),
  };
}

// ---------------------------------------------------------------------------
// 3b. preston_get_job (READ ONLY) - first-class per-job inspection (bridge B1).
//
// Result reports (bridge B2): the runtime driver records one bounded,
// redacted, human-readable JobResultRecorded event per job attempt into
// os_events (id ev-result-<job>-<attempt>, correlation result:job:<job>).
// This reader surfaces them; until the runtime emits them (host build at the
// B2 commit or later) the list is simply empty - absence is a normal state.
const RESULT_CORRELATION_PREFIX = 'result:job:';
const MAX_RESULT_REPORTS = 20;

export async function readJobResultReports(ctx: ToolContext, jobId: string) {
  try {
    const client = ctx.client as unknown as RuntimeClient;
    const r = await client
      .from('os_events').select('*')
      .eq('correlation_id', RESULT_CORRELATION_PREFIX + jobId)
      .limit(MAX_RESULT_REPORTS);
    if (r.error || !Array.isArray(r.data)) return { read_ok: false as const, reports: [] };
    const reports = r.data.map((row) => {
      const p = (row['payload'] ?? {}) as Row;
      return {
        attempt: Number(p['attempt'] ?? 0),
        outcome: String(p['outcome'] ?? ''),
        executed: p['executed'] === true,
        mode: String(p['mode'] ?? ''),
        provider_role: String(p['provider_role'] ?? ''),
        summary: safeText(p['summary'], 400),
        failure_reason: p['failure_reason'] == null ? null : safeText(p['failure_reason'], 300),
        result_excerpt: p['result_excerpt'] == null ? null : safeText(p['result_excerpt'], 2000),
        files_changed: safeJsonList(p['files_changed']).map((f) => safeText(f, 300)),
        evidence_refs: safeJsonList(p['evidence_refs']),
        recorded_at: String(row['created_at'] ?? ''),
      };
    });
    reports.sort((a, b) => a.attempt - b.attempt);
    return { read_ok: true as const, reports };
  } catch {
    return { read_ok: false as const, reports: [] };
  }
}

export async function prestonGetJob(ctx: ToolContext, jobId: string) {
  const client = ctx.client as unknown as RuntimeClient;
  const id = String(jobId ?? '').trim();
  if (!UUID_RE.test(id)) return { found: false as const, error: 'job_id_invalid' };
  let rows: Row[] = [];
  try {
    const r = await client.from('goal_jobs').select('*').eq('id', id).limit(1);
    if (r.error) return { found: false as const, error: 'read_failed' };
    rows = r.data ?? [];
  } catch {
    return { found: false as const, error: 'read_failed' };
  }
  if (rows.length === 0) return { found: false as const, error: 'not_found' };
  const row = rows[0];
  const job = projectJob(row);
  const nowMs = Date.parse(ctx.now);
  // Run liveness: a non-null run_id with an unexpired lease means a runtime
  // run currently owns the job. Progress resolution is per-attempt (one
  // orchestrator tick); there is no intra-job stream by design.
  const leaseMs = Date.parse(String(row['run_lease_expires_at'] ?? ''));
  const run = {
    active: row['run_id'] != null && Number.isFinite(leaseMs) && leaseMs > nowMs,
    lease_expires_at: row['run_lease_expires_at'] == null ? null : String(row['run_lease_expires_at']),
  };
  const approval = job.approval_id ? await restateApproval(ctx, job.approval_id) : null;
  const results = await readJobResultReports(ctx, id);
  return {
    found: true as const,
    job,
    run,
    approval,
    result_reports: results.reports,
    result_reports_read_ok: results.read_ok,
  };
}

// ---------------------------------------------------------------------------
// 4. preston_list_approvals (READ ONLY)
export async function prestonListApprovals(ctx: ToolContext) {
  const client = ctx.client as unknown as RuntimeClient;
  const res = await listOpenApprovals(client, 50);
  if (!res.ok) return { read_ok: false as const, approvals: [] };
  const nowMs = Date.parse(ctx.now);
  return { read_ok: true as const, approvals: res.rows.map((r) => projectApproval(r, nowMs)) };
}

// ---------------------------------------------------------------------------
// 5. preston_decide_approval (CONSEQUENTIAL WRITE)
const DECIDE_ERROR_TAGS = [
  'owner_required', 'outcome_invalid', 'nonce_required', 'approval_not_found',
  'not_pending', 'already_decided', 'expired',
] as const;

// G8 owner-boundary invariant: the authoritative decision RPC is reachable
// ONLY through a confirmation phrase that NAMES the exact approval id and the
// requested outcome. An ambiguous reference ("Approve that.", "go ahead",
// "the pending one") can never satisfy this check because the id itself must
// appear in the phrase - so a conversational layer that resolved a pronoun to
// an approval id still cannot decide until the owner has typed the id.
// Accepted forms (case-insensitive verb, optional word "approval", trailing
// ./! ignored): "approve <id>", "approved <id>", "reject <id>",
// "rejected <id>". Anything else is a refusal WITHOUT any decision.
const CONFIRMATION_RE = /^(approve|approved|reject|rejected)(?:\s+approval)?\s+([A-Za-z0-9._:-]{8,128})$/i;

export type OwnerConfirmationCheck =
  | { ok: true }
  | { ok: false; error: 'owner_confirmation_required' | 'owner_confirmation_id_mismatch' | 'owner_confirmation_outcome_mismatch' };

export function evaluateOwnerConfirmation(
  raw: unknown,
  approvalId: string,
  outcome: 'approved' | 'rejected',
): OwnerConfirmationCheck {
  const s = String(raw ?? '').trim().replace(/[.!]+$/, '').trim().replace(/\s+/g, ' ');
  if (!s) return { ok: false, error: 'owner_confirmation_required' };
  const m = CONFIRMATION_RE.exec(s);
  if (!m) return { ok: false, error: 'owner_confirmation_required' };
  if (m[2].toLowerCase() !== approvalId.toLowerCase()) {
    return { ok: false, error: 'owner_confirmation_id_mismatch' };
  }
  const verbOutcome = m[1].toLowerCase().startsWith('approve') ? 'approved' : 'rejected';
  if (verbOutcome !== outcome) return { ok: false, error: 'owner_confirmation_outcome_mismatch' };
  return { ok: true };
}

// Bounded read used only to RESTATE the approval back to the owner during the
// confirmation handshake (same projection discipline as every other read).
async function restateApproval(ctx: ToolContext, approvalId: string) {
  try {
    const client = ctx.client as unknown as RuntimeClient;
    const r = await client
      .from('orchestration_approvals').select('*').eq('approval_id', approvalId).limit(1);
    if (r.error || !Array.isArray(r.data) || r.data.length === 0) return null;
    return projectApproval(r.data[0] as Row, Date.parse(ctx.now));
  } catch {
    return null;
  }
}

export async function prestonDecideApproval(
  ctx: ToolContext,
  input: { approval_id: string; outcome: 'approved' | 'rejected'; reason?: string; owner_confirmation?: string },
) {
  const approvalId = String(input.approval_id ?? '').trim();
  const outcome = input.outcome === 'approved' || input.outcome === 'rejected' ? input.outcome : null;
  if (!outcome || !RUNTIME_ID_RE.test(approvalId)) {
    return { ok: false as const, approval_id: approvalId, error: 'invalid_input' };
  }
  const reason = String(input.reason ?? '').slice(0, MAX_REASON_CHARS);
  if (looksSecret(reason)) {
    return { ok: false as const, approval_id: approvalId, error: 'secret_in_reason' };
  }
  // G8 handshake: no valid owner confirmation -> NO decision, restate instead.
  const confirmation = evaluateOwnerConfirmation(input.owner_confirmation, approvalId, outcome);
  if (!confirmation.ok) {
    const approval = await restateApproval(ctx, approvalId);
    const phrase = `${outcome === 'approved' ? 'Approve' : 'Reject'} ${approvalId}`;
    return {
      ok: false as const,
      decision_made: false as const,
      approval_id: approvalId,
      requested_outcome: outcome,
      error: confirmation.error,
      restatement: approval,
      required_confirmation: phrase,
      instructions:
        'NO decision was recorded. Show the owner the restated approval (exact ' +
        'approval_id and action text). To proceed, the OWNER must reply with the ' +
        `exact phrase "${phrase}" themselves. Never construct that phrase from an ` +
        'ambiguous reference such as "approve that", "approve it", "go ahead", or ' +
        '"the pending one" - even if only one approval is open. If the owner used ' +
        'ambiguous wording, ask them to state the exact approval id.',
    };
  }
  // Fresh one-time nonce per attempt; the DB partial unique index is the
  // durable replay guard. The RPC re-enforces is_owner() under auth.uid().
  const nonce = `pc-${randomUUID()}`;
  try {
    const res = await ctx.client.rpc('decide_orchestration_approval', {
      p_approval_id: approvalId,
      p_outcome: outcome,
      p_nonce: nonce,
    });
    if (res.error) {
      const tag = DECIDE_ERROR_TAGS.find((t) => res.error!.message.includes(t));
      return { ok: false as const, approval_id: approvalId, error: tag ?? 'decide_failed' };
    }
    return {
      ok: true as const,
      approval_id: approvalId,
      outcome,
      decided_by: ctx.ownerEmail,
      decided_at: ctx.now,
      note: 'Recorded through decide_orchestration_approval (owner-only, one-time, audited in-transaction). The runtime clears the gate on its next tick.',
    };
  } catch {
    return { ok: false as const, approval_id: approvalId, error: 'decide_failed' };
  }
}

// ---------------------------------------------------------------------------
// 6. preston_get_evidence (READ ONLY)
export async function prestonGetEvidence(
  ctx: ToolContext,
  input: { goal_id?: string; job_id?: string },
) {
  const client = ctx.client as unknown as RuntimeClient;
  const goalId = String(input.goal_id ?? '').trim();
  const jobId = String(input.job_id ?? '').trim();
  if (!goalId && !jobId) return { ok: false as const, error: 'goal_id_or_job_id_required', items: [] };
  if (goalId && !UUID_RE.test(goalId)) return { ok: false as const, error: 'goal_id_invalid', items: [] };
  if (jobId && !UUID_RE.test(jobId)) return { ok: false as const, error: 'job_id_invalid', items: [] };

  let rows: Row[] = [];
  if (goalId) {
    const r = await listJobsForGoal(client, goalId, 200);
    if (!r.ok) return { ok: false as const, error: 'read_failed', items: [] };
    rows = r.rows;
  } else {
    // Job lookup by id goes through the same bounded select surface.
    const r = await client.from('goal_jobs').select('*').eq('id', jobId).limit(1);
    if (r.error) return { ok: false as const, error: 'read_failed', items: [] };
    rows = r.data ?? [];
  }
  if (jobId) rows = rows.filter((r) => String(r['id'] ?? '') === jobId);
  if (rows.length === 0) return { ok: false as const, error: 'not_found', items: [] };

  return {
    ok: true as const,
    items: rows.map((r) => {
      const j = projectJob(r);
      return {
        job_id: j.job_id,
        goal_id: j.goal_id,
        kind: j.kind,
        title: j.title,
        status: j.status,
        assigned_role: j.assigned_role,
        attempts: j.attempts,
        requires_approval: j.requires_approval,
        approval_id: j.approval_id,
        failure_summary: j.failure_reason,
        evidence_refs: j.evidence_refs,
        updated_at: j.updated_at,
      };
    }),
  };
}
