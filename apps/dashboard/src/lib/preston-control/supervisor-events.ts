// Preston Control - ChatGPT Supervisor Bridge, slice 1 (design:
// docs/PRESTON_CHATGPT_SUPERVISOR_BRIDGE_DESIGN_v1.md). PURE normalization.
//
// A read-model event feed over the EXISTING SSOT rows (master_goals,
// goal_jobs, orchestration_approvals, system_controls) plus the best-effort
// submit-rejection records in os_events. No new tables, no migration, no
// new write authority: the poll surface performs ZERO writes, and every
// event is DERIVED deterministically from rows the owner surface already
// reads (preston_status / read-model paths).
//
// Dedupe/idempotency contract:
//   - Every event has a DETERMINISTIC id built from (entity, state,
//     state-timestamp). Observing the same row state twice yields the SAME
//     event id and occurred_at, so a repeated poll returns an identical
//     page and an advanced cursor can never re-emit it.
//   - The cursor is an opaque watermark 'v1:<ms>:<event_id>' over the
//     ascending (occurred_at, event_id) order. An INVALID cursor is an
//     ERROR (never silently reset - a reset would re-emit history as
//     duplicates).
//   - A retry that re-enters the same status later carries a new
//     updated_at, hence a NEW event id - transitions are never collapsed.
//
// Fail-closed: an unknown job/goal status maps to NO event and increments
// unmapped_states (the supervisor sees the count, never an invented kind).
// Free text never enters events: reasons are the platform's static codes,
// bounded; evidence refs are bounded; secrets cannot appear (sources are
// already redacted/static).

export const SUPERVISOR_EVENT_KINDS = [
  'queued',
  'running',
  'completed',
  'failed',
  'timed_out',
  'dead_lettered',
  'blocked',
  'paused',
  'stopped',
  'approval_required',
  'kind_not_eligible',
  'task_kind_unresolved',
  // Submit-time rejection whose codes carry the detail (e.g.
  // secret_in_request, ambiguous_request:*). Distinguishes "never entered
  // the runtime" from a runtime failure.
  'submit_rejected',
] as const;
export type SupervisorEventKind = (typeof SUPERVISOR_EVENT_KINDS)[number];

export interface SupervisorEvent {
  event_id: string;
  kind: SupervisorEventKind;
  occurred_at: string; // ISO; the state's own timestamp (row updated_at)
  goal_id: string | null;
  job_id: string | null;
  job_kind: string | null;
  // Provenance. prior_state is set ONLY where the lifecycle guarantees it
  // (a terminal job result is persisted by the run that owned in_progress);
  // otherwise null - a snapshot feed never invents history.
  prior_state: string | null;
  new_state: string;
  provider_role: string | null;
  risk_class: string | null;
  requires_approval: boolean | null;
  approval_id: string | null;
  failure_reason: string | null; // static codes only, bounded
  evidence_refs: string[]; // bounded
  correlation_id: string | null;
}

const MAX_EVIDENCE_REFS = 10;
const MAX_REASON_CHARS = 200;

const str = (r: Record<string, unknown>, k: string) => String(r[k] ?? '');
const opt = (r: Record<string, unknown>, k: string): string | null => {
  const v = r[k];
  return v == null || v === '' ? null : String(v);
};

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function isTimeoutClass(reason: string): boolean {
  return /(^|[:_])time(d[-_]?out|out)\b/i.test(reason) || reason.includes('timeout');
}

// --- cursor ------------------------------------------------------------------

export type CursorDecode =
  | { ok: true; msWatermark: number; lastId: string }
  | { ok: false };

export function decodeCursor(cursor: string | undefined | null): CursorDecode | null {
  if (cursor == null || cursor === '') return null; // start of window
  const m = /^v1:(\d{1,15}):([A-Za-z0-9:._-]{1,200})$/.exec(cursor);
  if (!m) return { ok: false };
  return { ok: true, msWatermark: Number(m[1]), lastId: m[2] };
}

export function encodeCursor(e: SupervisorEvent): string {
  return `v1:${ms(e.occurred_at)}:${e.event_id}`;
}

// Lifecycle rank for same-millisecond ordering (defect SB-1, staging drill
// 2026-08-31): the runtime worker stamps every write of one oneshot cycle
// with a single nowIso, so a job that leases AND completes inside one cycle
// carries the SAME updated_at for its running and terminal states (live
// example: job 0c87b3e5-... running and completed both at ...37.505Z). A
// purely lexicographic tie-break then hides the terminal event from any
// cursor advanced past the running event ('completed' < 'in_progress'), and
// the supervisor silently loses the completion. Same-ms events are therefore
// ordered by lifecycle progression, so a later state always sorts AFTER an
// earlier one and stays visible to an advanced cursor. The rank derives from
// the state token embedded in the DETERMINISTIC event id, so existing v1
// cursors remain valid and replays stay exact.
const STATE_RANK: Record<string, number> = {
  pending: 0, ready: 0,
  in_progress: 1, awaiting_approval: 1, blocked: 1, paused: 1, stopped: 1,
  completed: 2, cancelled: 2, failed: 2, dead_lettered: 2,
};

function idStateRank(eventId: string): number {
  const parts = eventId.split(':');
  if (parts[1] === 'rej') return 1; // no state token; neutral mid rank
  const state = parts.length >= 2 ? parts[parts.length - 2] : '';
  return STATE_RANK[state] ?? 1;
}

function afterCursor(e: SupervisorEvent, c: { msWatermark: number; lastId: string }): boolean {
  const t = ms(e.occurred_at);
  if (t !== c.msWatermark) return t > c.msWatermark;
  const er = idStateRank(e.event_id);
  const lr = idStateRank(c.lastId);
  if (er !== lr) return er > lr;
  return e.event_id > c.lastId;
}

export function sortEvents(events: SupervisorEvent[]): SupervisorEvent[] {
  return [...events].sort((a, b) => {
    const d = ms(a.occurred_at) - ms(b.occurred_at);
    if (d !== 0) return d;
    const r = idStateRank(a.event_id) - idStateRank(b.event_id);
    if (r !== 0) return r;
    return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
  });
}

// --- normalization -----------------------------------------------------------

export interface NormalizeInput {
  goals: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  controls: {
    readable: boolean;
    paused: boolean;
    owner_stop: boolean;
    updated_at: string;
  };
  // Best-effort GoalSubmitRejected rows from os_events (may be absent when
  // that table is not readable by this surface - reported, never guessed).
  rejections: Array<Record<string, unknown>>;
}

export interface NormalizeResult {
  events: SupervisorEvent[]; // ascending (occurred_at, event_id)
  unmapped_states: number;
}

function jobEvent(j: Record<string, unknown>): SupervisorEvent | null {
  const status = str(j, 'status');
  const reason = opt(j, 'failure_reason');
  const base = {
    occurred_at: str(j, 'updated_at'),
    goal_id: opt(j, 'goal_id'),
    job_id: opt(j, 'id'),
    job_kind: opt(j, 'kind'),
    new_state: status,
    provider_role: opt(j, 'assigned_role'),
    risk_class: opt(j, 'risk_class'),
    requires_approval: j['requires_approval'] === true,
    approval_id: opt(j, 'approval_id'),
    failure_reason: reason ? reason.slice(0, MAX_REASON_CHARS) : null,
    evidence_refs: Array.isArray(j['evidence_refs'])
      ? (j['evidence_refs'] as unknown[]).slice(0, MAX_EVIDENCE_REFS).map(String)
      : [],
    correlation_id: opt(j, 'correlation_id'),
  };
  const withId = (kind: SupervisorEventKind, prior: string | null): SupervisorEvent => ({
    event_id: `sup:job:${base.job_id}:${status}:${ms(base.occurred_at)}`,
    kind,
    prior_state: prior,
    ...base,
  });
  switch (status) {
    case 'pending':
    case 'ready':
      return withId('queued', null);
    case 'in_progress':
      return withId('running', null);
    case 'awaiting_approval':
      return withId('approval_required', null);
    case 'completed':
      // A terminal result is persisted only by the run that owned
      // in_progress (run-owned CAS), so the prior state is structural.
      return withId('completed', 'running');
    case 'cancelled':
      return withId('stopped', null);
    case 'failed':
      return withId(reason && isTimeoutClass(reason) ? 'timed_out' : 'failed', 'running');
    case 'dead_lettered': {
      const kind: SupervisorEventKind =
        reason && reason.includes('kind_not_eligible') ? 'kind_not_eligible'
        : reason && isTimeoutClass(reason) ? 'timed_out'
        : 'dead_lettered';
      return withId(kind, null);
    }
    default:
      return null; // unknown status: fail closed, counted by the caller
  }
}

function goalEvent(g: Record<string, unknown>): SupervisorEvent | null {
  const status = str(g, 'status');
  if (status !== 'blocked') return null; // job rows carry the rest
  return {
    event_id: `sup:goal:${str(g, 'id')}:blocked:${ms(str(g, 'updated_at'))}`,
    kind: 'blocked',
    occurred_at: str(g, 'updated_at'),
    goal_id: str(g, 'id'),
    job_id: null,
    job_kind: null,
    prior_state: null,
    new_state: 'blocked',
    provider_role: null,
    risk_class: null,
    requires_approval: null,
    approval_id: null,
    failure_reason: null,
    evidence_refs: [],
    correlation_id: opt(g, 'correlation_id'),
  };
}

const GOAL_TERMINAL_OR_ACTIVE = new Set([
  'proposed', 'decomposed', 'running', 'completed', 'failed', 'cancelled',
  'dead_lettered', 'blocked',
]);

function controlEvents(c: NormalizeInput['controls']): SupervisorEvent[] {
  const out: SupervisorEvent[] = [];
  const mk = (field: 'paused' | 'stopped'): SupervisorEvent => ({
    event_id: `sup:ctl:${field}:${ms(c.updated_at)}`,
    kind: field,
    occurred_at: c.updated_at,
    goal_id: null, job_id: null, job_kind: null,
    prior_state: null, new_state: field,
    provider_role: null, risk_class: null,
    requires_approval: null, approval_id: null,
    failure_reason: null, evidence_refs: [],
    correlation_id: 'system_controls',
  });
  if (c.paused) out.push(mk('paused'));
  if (c.owner_stop) out.push(mk('stopped'));
  return out;
}

function rejectionEvent(r: Record<string, unknown>): SupervisorEvent | null {
  if (str(r, 'type') !== 'GoalSubmitRejected') return null;
  const payload = (r['payload'] ?? {}) as Record<string, unknown>;
  const requestId = String(payload['request_id'] ?? '');
  if (!requestId) return null;
  const codes = Array.isArray(payload['errors'])
    ? (payload['errors'] as unknown[]).slice(0, 8).map(String)
    : [];
  const occurred = String(payload['rejected_at'] ?? r['created_at'] ?? '');
  const kind: SupervisorEventKind = codes.some((c) => c.includes('task_kind_unresolved'))
    ? 'task_kind_unresolved'
    : 'submit_rejected';
  return {
    // One rejection record per request_id (idempotent insert upstream).
    event_id: `sup:rej:${requestId}`,
    kind,
    occurred_at: occurred,
    goal_id: null, // never entered the runtime - that is the point
    job_id: null,
    job_kind: null,
    prior_state: null,
    new_state: 'submit_rejected',
    provider_role: null,
    risk_class: null,
    requires_approval: null,
    approval_id: null,
    failure_reason: codes.join(',').slice(0, MAX_REASON_CHARS) || null,
    evidence_refs: [],
    correlation_id: `submit:${requestId}`,
  };
}

export function normalizeSupervisorEvents(input: NormalizeInput): NormalizeResult {
  const events: SupervisorEvent[] = [];
  let unmapped = 0;

  for (const j of input.jobs) {
    const e = jobEvent(j);
    if (e) events.push(e);
    else unmapped++;
  }
  for (const g of input.goals) {
    const e = goalEvent(g);
    if (e) events.push(e);
    else if (!GOAL_TERMINAL_OR_ACTIVE.has(str(g, 'status'))) unmapped++;
  }
  if (input.controls.readable) events.push(...controlEvents(input.controls));
  for (const r of input.rejections) {
    const e = rejectionEvent(r);
    if (e) events.push(e);
  }
  return { events: sortEvents(events), unmapped_states: unmapped };
}

// Apply the cursor + page bound to an already-normalized ascending list.
export function pageAfterCursor(
  events: SupervisorEvent[],
  decoded: CursorDecode | null,
  limit: number,
): { page: SupervisorEvent[]; next_cursor: string | null } {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const filtered = decoded && decoded.ok
    ? events.filter((e) => afterCursor(e, decoded))
    : events;
  const page = filtered.slice(0, bounded);
  const next = page.length > 0 ? encodeCursor(page[page.length - 1]) : null;
  return { page, next_cursor: next };
}
