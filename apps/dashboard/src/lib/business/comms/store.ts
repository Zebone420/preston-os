// Communications intelligence Supabase adapters (0031 tables). Same idiom
// as business-store.ts: RLS-bound client injected, service role never used,
// every write validates first, inserts are idempotent on their unique key,
// status transitions are compare-and-set, reads fail closed to empty. No
// delete path exists (the migration grants none).

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import type { ListOutcome } from '../business-store';
import {
  DETECTORS,
  EVENT_TYPES,
  type AttentionItemDraft,
  type AttentionStatus,
  type CommunicationEventRow,
  type CommunicationMessageRow,
} from './types';

export const COMMS_TABLES = {
  identities: 'mailbox_identities',
  messages: 'communication_messages',
  events: 'communication_events',
  attention: 'attention_items',
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return {
      ok: false,
      error: e instanceof Error ? e.message : `${table} insert failed`,
    };
  }
}

async function runList(q: PromiseLike<QueryResult>): Promise<ListOutcome> {
  try {
    const res = await q;
    if (res.error) return { ok: false, rows: [], error: res.error.message };
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
}

// --- messages --------------------------------------------------------------

export async function insertMessage(
  client: RuntimeClient,
  row: CommunicationMessageRow,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(row.id)) return { ok: false, error: 'invalid message id' };
  if (!row.provider_message_id) {
    return { ok: false, error: 'provider_message_id required' };
  }
  if (row.ingestion_class === 'DROP' && row.body_text !== null) {
    return { ok: false, error: 'DROP rows must not carry body_text' };
  }
  if (row.ingestion_class === 'DROP' && !row.drop_reason) {
    return { ok: false, error: 'DROP rows must carry drop_reason' };
  }
  if (row.snippet.length > 500) {
    return { ok: false, error: 'snippet exceeds 500 chars' };
  }
  if ((row.body_text ?? '').length > 20_000) {
    return { ok: false, error: 'body_text exceeds 20000 chars' };
  }
  if (row.link_confidence === 'confirmed') {
    return { ok: false, error: 'confirmed links are owner-only' };
  }
  return insertRow(client, COMMS_TABLES.messages, { ...row });
}

// --- events ----------------------------------------------------------------

export async function insertEvent(
  client: RuntimeClient,
  row: CommunicationEventRow,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(row.id) || !UUID_RE.test(row.message_id)) {
    return { ok: false, error: 'invalid event or message id' };
  }
  if (!(EVENT_TYPES as readonly string[]).includes(row.event_type)) {
    return { ok: false, error: 'unknown event_type' };
  }
  return insertRow(client, COMMS_TABLES.events, { ...row });
}

// --- attention items -------------------------------------------------------

function validateDraft(draft: AttentionItemDraft): string | null {
  if (!(DETECTORS as readonly string[]).includes(draft.detector)) {
    return 'unknown detector';
  }
  if (!Array.isArray(draft.evidence) || draft.evidence.length === 0) {
    return 'attention item requires evidence';
  }
  if (!draft.dedupe_key || !draft.source_ref || !draft.subject) {
    return 'attention item missing key fields';
  }
  return null;
}

// Insert-or-refresh by dedupe_key: a re-run of the detectors touches
// last_seen_at on the existing row (whatever its status) and never
// duplicates it or reopens an owner-resolved item.
export async function upsertAttentionItem(
  client: RuntimeClient,
  draft: AttentionItemDraft,
  nowIso: string,
): Promise<WriteOutcome> {
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, error: invalid };
  const existing = await runList(
    client
      .from(COMMS_TABLES.attention)
      .select('id,status')
      .eq('dedupe_key', draft.dedupe_key)
      .limit(1),
  );
  if (!existing.ok) return { ok: false, error: existing.error };
  const found = existing.rows[0];
  if (found) {
    const id = String(found['id']);
    try {
      const res = await client
        .from(COMMS_TABLES.attention)
        .update({ last_seen_at: nowIso })
        .eq('id', id)
        .select('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, id, duplicate: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'attention refresh failed',
      };
    }
  }
  return insertRow(client, COMMS_TABLES.attention, {
    ...draft,
    status: 'open',
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  });
}

// CAS transition from 'open'. Zero matched rows => the item is no longer
// open (owner acted elsewhere) and the caller must re-read.
export async function transitionAttentionItemCAS(
  client: RuntimeClient,
  itemId: string,
  toStatus: Exclude<AttentionStatus, 'open'>,
  actor: string,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(itemId)) return { ok: false, error: 'invalid item id' };
  if (!['acknowledged', 'resolved', 'suppressed'].includes(toStatus)) {
    return { ok: false, error: 'invalid status' };
  }
  if (typeof actor !== 'string' || actor.trim() === '') {
    return { ok: false, error: 'actor required' };
  }
  const patch: Record<string, unknown> = {
    status: toStatus,
    last_seen_at: nowIso,
  };
  if (toStatus === 'resolved' || toStatus === 'suppressed') {
    patch.resolved_at = nowIso;
    patch.resolved_by = actor;
  }
  try {
    const res = await client
      .from(COMMS_TABLES.attention)
      .update(patch)
      .eq('id', itemId)
      .eq('status', 'open')
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'not_open' };
    }
    return { ok: true, id: itemId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'attention transition failed',
    };
  }
}

export async function listOpenAttention(
  client: RuntimeClient,
  projectId?: string,
  limit = 200,
): Promise<ListOutcome> {
  const bound = Math.min(Math.max(limit, 1), 500);
  const base = client
    .from(COMMS_TABLES.attention)
    .select('*')
    .eq('status', 'open');
  if (projectId !== undefined) {
    if (!UUID_RE.test(projectId)) {
      return { ok: false, rows: [], error: 'invalid project id' };
    }
    return runList(
      base.eq('project_id', projectId)
        .order('last_seen_at', { ascending: false })
        .limit(bound),
    );
  }
  return runList(
    base.order('last_seen_at', { ascending: false }).limit(bound),
  );
}
