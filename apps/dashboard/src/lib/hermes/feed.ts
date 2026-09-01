// Hermes Supervisor Dashboard v0 - supervisor feed + notification logic.
// PURE, client-safe (no server imports, no I/O). The wire shape mirrors
// preston_poll_events output; the server remains authoritative for event
// ids, ordering (incl. same-millisecond lifecycle ranking) and cursor
// semantics - this module only accumulates, deduplicates and classifies.

// Mirror of SupervisorEvent as serialized by the poll surface. Kept as a
// structural type (not imported) so this module never drags the server
// tool layer into the client bundle.
export interface FeedEvent {
  event_id: string;
  kind: string;
  occurred_at: string;
  goal_id: string | null;
  job_id: string | null;
  job_kind: string | null;
  prior_state: string | null;
  new_state: string;
  provider_role: string | null;
  risk_class: string | null;
  requires_approval: boolean | null;
  approval_id: string | null;
  failure_reason: string | null;
  evidence_refs: string[];
  correlation_id: string | null;
}

export interface FeedWindow {
  goals_covered: number;
  goals_state: string;
  jobs_state: string;
  approvals_state: string;
  controls_readable: boolean;
  rejections_readable: boolean;
  migration_applied: boolean;
}

export interface FeedPage {
  ok: boolean;
  error?: string;
  generated_at?: string;
  events?: FeedEvent[];
  next_cursor?: string | null;
  window?: FeedWindow;
  unmapped_states?: number;
}

// One accumulated feed entry. `backfill` marks events absorbed while
// anchoring (first load, or a re-anchor after cursor_invalid): they are
// window HISTORY being replayed, never fresh news, and must not become
// notifications.
export interface FeedEntry {
  event: FeedEvent;
  backfill: boolean;
  received_at: string;
}

export const FEED_CAP = 200;

// Merge a page into the accumulated entries. Deterministic event ids are
// the dedup key: an id already present is dropped (a repeated page or an
// overlapping poll can never duplicate a row). Returns the entries that
// were actually NEW so the caller can derive notifications from exactly
// those.
export function mergePage(
  entries: FeedEntry[],
  page: FeedEvent[],
  opts: { backfill: boolean; receivedAt: string },
): { entries: FeedEntry[]; added: FeedEntry[] } {
  const seen = new Set(entries.map((e) => e.event.event_id));
  const added: FeedEntry[] = [];
  for (const ev of page) {
    if (!ev || typeof ev.event_id !== 'string' || ev.event_id === '') continue;
    if (seen.has(ev.event_id)) continue;
    seen.add(ev.event_id);
    added.push({
      event: ev,
      backfill: opts.backfill,
      received_at: opts.receivedAt,
    });
  }
  const next = [...entries, ...added];
  // Keep the newest entries when over cap (feed arrives ascending).
  return {
    entries: next.length > FEED_CAP ? next.slice(next.length - FEED_CAP) : next,
    added,
  };
}

// A submit-time rejection never entered the runtime: goal_id is null by
// design and the row must read differently from a runtime failure.
export function isSubmitRejection(ev: FeedEvent): boolean {
  return ev.new_state === 'submit_rejected';
}

// Owner-notification classes for this slice, derived ONLY from
// authoritative supervisor event kinds. Kinds outside this map produce no
// notification (the feed still shows them).
export type NotificationClass =
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'dead_lettered'
  | 'approval_required'
  | 'submit_rejected';

const KIND_TO_CLASS: Record<string, NotificationClass> = {
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed_out',
  dead_lettered: 'dead_lettered',
  kind_not_eligible: 'dead_lettered',
  approval_required: 'approval_required',
  submit_rejected: 'submit_rejected',
  task_kind_unresolved: 'submit_rejected',
};

export interface HermesNotification {
  id: string; // = event_id (deterministic; dedupes with the feed)
  cls: NotificationClass;
  kind: string;
  occurred_at: string;
  goal_id: string | null;
  job_id: string | null;
  approval_id: string | null;
  failure_reason: string | null;
}

// Notifications derive from NEW (non-backfill) entries only.
export function deriveNotifications(
  added: FeedEntry[],
): HermesNotification[] {
  const out: HermesNotification[] = [];
  for (const entry of added) {
    if (entry.backfill) continue;
    const cls = KIND_TO_CLASS[entry.event.kind];
    if (!cls) continue;
    out.push({
      id: entry.event.event_id,
      cls,
      kind: entry.event.kind,
      occurred_at: entry.event.occurred_at,
      goal_id: entry.event.goal_id,
      job_id: entry.event.job_id,
      approval_id: entry.event.approval_id,
      failure_reason: entry.event.failure_reason,
    });
  }
  return out;
}

// localStorage key for the opaque cursor, scoped per environment so a
// staging cursor can never be replayed against production data.
export function cursorStorageKey(environment: string): string {
  const env = /^[a-z_-]{1,32}$/.test(environment) ? environment : 'unknown';
  return `hermes.supervisor.cursor.${env}`;
}
