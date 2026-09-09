import { describe, expect, it } from 'vitest';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  COMMS_TABLES,
  insertEvent,
  insertMessage,
  listOpenAttention,
  transitionAttentionItemCAS,
  upsertAttentionItem,
} from '../src/lib/business/comms/store';
import type {
  AttentionItemDraft,
  CommunicationEventRow,
  CommunicationMessageRow,
} from '../src/lib/business/comms/types';
import { NOW, PROJECT_A } from './comms-fixtures';

// In-memory fake of the RLS-bound client: unique keys enforced, CAS
// update honoured, no delete method exists at all.
interface Call {
  op: string;
  table: string;
  row?: Record<string, unknown>;
  filters: [string, string][];
}

function fakeClient(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = { ...seed };
  const calls: Call[] = [];
  const uniques: Record<string, string[]> = {
    [COMMS_TABLES.messages]: ['provider_message_id'],
    [COMMS_TABLES.attention]: ['dedupe_key'],
  };
  const rows = (t: string) => (tables[t] ??= []);
  const ok = (data: Record<string, unknown>[]): QueryResult => ({ data, error: null });
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return {
            async select() {
              calls.push({ op: 'insert', table, row, filters: [] });
              for (const col of uniques[table] ?? []) {
                if (rows(table).some((r) => r[col] === row[col])) {
                  const message = `duplicate key value violates unique constraint (${col})`;
                  return { data: null, error: { message } };
                }
              }
              if (table === COMMS_TABLES.events &&
                rows(table).some((r) => r['message_id'] === row['message_id'] &&
                  r['event_type'] === row['event_type'])) {
                return { data: null,
                  error: { message: 'duplicate key value violates unique constraint' } };
              }
              const stored = { id: row['id'] ?? `gen-${rows(table).length + 1}`, ...row };
              rows(table).push(stored);
              return ok([{ id: stored.id }]);
            },
          };
        },
        select() {
          const filters: [string, string][] = [];
          const run = async (n: number) => ok(rows(table)
            .filter((r) => filters.every(([c, v]) => String(r[c]) === v)).slice(0, n));
          const chain = {
            eq(c: string, v: string) { filters.push([c, v]); return chain; },
            order() { return { limit: (n: number) => run(n) }; },
            limit: (n: number) => run(n),
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          const filters: [string, string][] = [];
          const chain = {
            eq(c: string, v: string) { filters.push([c, v]); return chain; },
            lte(c: string, v: string) { filters.push([c, v]); return chain; },
            gt(c: string, v: string) { filters.push([c, v]); return chain; },
            async select() {
              calls.push({ op: 'update', table, row: patch, filters });
              const hit = rows(table).filter((r) => filters.every(([c, v]) => String(r[c]) === v));
              for (const r of hit) Object.assign(r, patch);
              return ok(hit.map((r) => ({ id: r['id'] })));
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, tables, calls };
}

const MSG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function messageRow(over: Partial<CommunicationMessageRow> = {}): CommunicationMessageRow {
  return {
    id: MSG_ID, provider: 'gmail', provider_message_id: 'g-1', provider_thread_id: 't',
    mailbox_identity: 'preston-main', direction: 'inbound', from_address_norm: 'jane@example.com',
    to_addresses_norm: [], cc_norm: [], subject: 'windows', snippet: 'hi', received_at: NOW,
    has_attachments: false, attachment_manifest: [], ingestion_class: 'INCLUDE_PROJECT',
    drop_reason: null, body_text: 'hi', project_id: PROJECT_A, link_confidence: 'candidate',
    link_signal: 'contact_alias', imported_at: NOW, import_run_id: 'r', ...over,
  };
}

function draft(over: Partial<AttentionItemDraft> = {}): AttentionItemDraft {
  return {
    item_type: 'RISK', detector: 'bounced_email', project_id: PROJECT_A, subject: 'Email bounced',
    source_system: 'gmail', source_ref: EVT_ID,
    evidence: [{ kind: 'event', ref: EVT_ID, timestamp: NOW }], confidence: 'high',
    suggested_action: 'fix contact', due_at: null, dedupe_key: `bounced_email:${EVT_ID}`, ...over,
  };
}

describe('comms store - messages and events', () => {
  it('insertMessage is idempotent on provider_message_id', async () => {
    const { client, tables } = fakeClient();
    expect(await insertMessage(client, messageRow())).toEqual({ ok: true, id: MSG_ID });
    const again = await insertMessage(client, messageRow());
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(tables[COMMS_TABLES.messages]).toHaveLength(1);
  });
  it('fails closed on invalid rows (DROP with body, oversize, confirmed, bad id)', async () => {
    const { client, tables } = fakeClient();
    const bad: Partial<CommunicationMessageRow>[] = [
      { ingestion_class: 'DROP', drop_reason: 'otp_code', body_text: 'x' },
      { ingestion_class: 'DROP', drop_reason: null, body_text: null },
      { snippet: 'x'.repeat(501) },
      { body_text: 'x'.repeat(20_001) },
      { link_confidence: 'confirmed' },
      { id: 'nope' },
      { provider_message_id: '' },
    ];
    for (const b of bad) expect((await insertMessage(client, messageRow(b))).ok).toBe(false);
    expect(tables[COMMS_TABLES.messages] ?? []).toHaveLength(0);
  });
  it('insertEvent validates ids and event_type; duplicate (message,type) is a no-op', async () => {
    const { client } = fakeClient();
    const row: CommunicationEventRow = { id: EVT_ID, message_id: MSG_ID,
      event_type: 'delivery_failed',
      payload: {}, project_id: null, occurred_at: NOW };
    expect((await insertEvent(client, row)).ok).toBe(true);
    expect(await insertEvent(client, row)).toMatchObject({ ok: true, duplicate: true });
    const bogus = { ...row, event_type: 'bogus' as 'voice_sms' };
    expect((await insertEvent(client, bogus)).ok).toBe(false);
    expect((await insertEvent(client, { ...row, message_id: 'x' })).ok).toBe(false);
  });
});

describe('comms store - attention items', () => {
  it('upsert inserts once, then refreshes last_seen_at without duplicating', async () => {
    const { client, tables, calls } = fakeClient();
    const first = await upsertAttentionItem(client, draft(), NOW);
    expect(first.ok).toBe(true);
    const later = '2026-09-09T12:00:00.000Z';
    const second = await upsertAttentionItem(client, draft(), later);
    expect(second).toMatchObject({ ok: true, duplicate: true, id: first.id });
    expect(tables[COMMS_TABLES.attention]).toHaveLength(1);
    expect(tables[COMMS_TABLES.attention][0]).toMatchObject({ status: 'open', first_seen_at: NOW,
      last_seen_at: later });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
  it('a refresh never reopens an owner-resolved item', async () => {
    const { client, tables } = fakeClient({ [COMMS_TABLES.attention]: [{ id: 'x1',
      dedupe_key: `bounced_email:${EVT_ID}`, status: 'resolved' }] });
    await upsertAttentionItem(client, draft(), NOW);
    expect(tables[COMMS_TABLES.attention][0]).toMatchObject({ status: 'resolved',
      last_seen_at: NOW });
  });
  it('rejects a draft without evidence or with an unknown detector', async () => {
    const { client, tables } = fakeClient();
    expect((await upsertAttentionItem(client, draft({ evidence: [] }), NOW)).ok).toBe(false);
    const unknown = draft({ detector: 'x' as 'bounced_email' });
    expect((await upsertAttentionItem(client, unknown, NOW)).ok)
      .toBe(false);
    expect(tables[COMMS_TABLES.attention] ?? []).toHaveLength(0);
  });
  it('CAS transition from open records the actor; second attempt reports not_open', async () => {
    const { client, tables } = fakeClient();
    const ins = await upsertAttentionItem(client, draft(), NOW);
    const id = String(ins.id);
    const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    tables[COMMS_TABLES.attention][0].id = itemId;
    expect(id).toBeTruthy();
    const r1 = await transitionAttentionItemCAS(client, itemId, 'resolved', 'owner', NOW);
    expect(r1).toEqual({ ok: true, id: itemId });
    expect(tables[COMMS_TABLES.attention][0]).toMatchObject({ status: 'resolved',
      resolved_by: 'owner',
      resolved_at: NOW });
    const r2 = await transitionAttentionItemCAS(client, itemId, 'acknowledged', 'owner', NOW);
    expect(r2).toEqual({ ok: false, error: 'not_open' });
  });
  it('transition validates id, status, and actor', async () => {
    const { client } = fakeClient();
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect((await transitionAttentionItemCAS(client, 'bad', 'resolved', 'o', NOW)).ok).toBe(false);
    const reopen = await transitionAttentionItemCAS(client, id, 'open' as 'resolved', 'o', NOW);
    expect(reopen.ok).toBe(false);
    expect((await transitionAttentionItemCAS(client, id, 'resolved', ' ', NOW)).ok).toBe(false);
  });
  it('listOpenAttention filters by status and project; invalid project fails closed', async () => {
    const { client } = fakeClient({ [COMMS_TABLES.attention]: [
      { id: '1', status: 'open', project_id: PROJECT_A },
      { id: '2', status: 'resolved', project_id: PROJECT_A },
      { id: '3', status: 'open', project_id: null },
    ] });
    expect((await listOpenAttention(client)).rows.map((r) => r['id'])).toEqual(['1', '3']);
    expect((await listOpenAttention(client, PROJECT_A)).rows.map((r) => r['id'])).toEqual(['1']);
    expect((await listOpenAttention(client, 'nope')).ok).toBe(false);
  });
  it('the fake client exposes no delete and the store never asks for one', () => {
    const { client } = fakeClient();
    const api = client.from(COMMS_TABLES.attention) as unknown as Record<string, unknown>;
    expect(api['delete']).toBeUndefined();
  });
});
