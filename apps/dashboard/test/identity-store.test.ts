// Phase 1 Lane A - identity store adapters against an in-memory fake
// RuntimeClient. NOT a database: RLS/CHECK/locking are proven on the
// migrated staging DB; this pins validation, CAS and error propagation.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  decideReviewItem,
  IDENTITY_TABLES,
  insertAlias,
  insertIdentityLink,
  insertReviewItem,
  listIdentityLinks,
  listOpenReviewItems,
} from '../src/lib/business/identity/store';

type Row = Record<string, unknown>;

interface FakeOpts {
  failInsert?: (table: string, row: Row) => string | null;
  failUpdate?: (table: string) => string | null;
}

function makeFakeDb(opts: FakeOpts = {}) {
  const tables = new Map<string, Row[]>();
  let seq = 0;
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const res = (data: Row[] | null, error: string | null): Promise<QueryResult> =>
    Promise.resolve({ data, error: error ? { message: error } : null });
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Row) {
          return {
            select() {
              const fail = opts.failInsert?.(table, row);
              if (fail) return res(null, fail);
              const rows = rowsOf(table);
              const stored: Row = {
                ...row,
                id: row.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
              };
              if (table === IDENTITY_TABLES.links && rows.some(
                (r) => r.external_system === row.external_system &&
                  r.external_id === row.external_id)) {
                return res(null, 'duplicate key value violates unique constraint');
              }
              rows.push(stored);
              return res([{ ...stored }], null);
            },
          };
        },
        select() {
          const chain = (f: Array<(r: Row) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order(col: string, o: { ascending: boolean }) {
              return {
                limit(n: number) {
                  const sorted = rowsOf(table).filter((r) => f.every((g) => g(r)))
                    .sort((a, b) => {
                      const x = String(a[col] ?? ''); const y = String(b[col] ?? '');
                      return o.ascending ? x.localeCompare(y) : y.localeCompare(x);
                    });
                  return res(sorted.slice(0, n), null);
                },
              };
            },
            limit(n: number) {
              return res(rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), null);
            },
          });
          return chain([]);
        },
        update(patch: Row) {
          const chain = (f: Array<(r: Row) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte(c: string, v: string) { return chain([...f, (r) => String(r[c]) <= v]); },
            gt(c: string, v: string) { return chain([...f, (r) => String(r[c]) > v]); },
            select() {
              const fail = opts.failUpdate?.(table);
              if (fail) return res(null, fail);
              const m = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of m) Object.assign(r, patch);
              return res(m.map((r) => ({ ...r })), null);
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

const PROJ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const NOW = '2026-09-08T12:00:00.000Z';

describe('insertIdentityLink', () => {
  it('validates every enum and id before touching the client', () => {
    const { client, rowsOf } = makeFakeDb();
    const base = {
      entity_type: 'project' as const, entity_id: PROJ,
      external_system: 'gmail_thread' as const, external_id: 'thread-1',
      confidence: 'linked_auto' as const, signal: 'gmail_thread',
      proposed_by: 'deterministic-matcher',
    };
    const bad = [
      { ...base, entity_type: 'invoice' as unknown as 'project' },
      { ...base, entity_id: 'nope' },
      { ...base, external_system: 'zapier' as unknown as 'airtable' },
      { ...base, external_id: '' },
      { ...base, confidence: 'verified' as unknown as 'confirmed' },
      { ...base, signal: '' },
      { ...base, proposed_by: '' },
    ];
    return Promise.all(bad.map((b) => insertIdentityLink(client, b))).then((outs) => {
      for (const o of outs) expect(o.ok).toBe(false);
      expect(rowsOf(IDENTITY_TABLES.links)).toHaveLength(0);
    });
  });

  it('a confirmed link requires confirmed_by and confirmed_at', async () => {
    const { client, rowsOf } = makeFakeDb();
    const out = await insertIdentityLink(client, {
      entity_type: 'project', entity_id: PROJ,
      external_system: 'airtable', external_id: 'recABC',
      confidence: 'confirmed', signal: 'external_id', proposed_by: 'owner',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/confirmed_by/);
    expect(rowsOf(IDENTITY_TABLES.links)).toHaveLength(0);
    const ok = await insertIdentityLink(client, {
      entity_type: 'project', entity_id: PROJ,
      external_system: 'airtable', external_id: 'recABC',
      confidence: 'confirmed', signal: 'external_id', proposed_by: 'owner',
      confirmed_by: 'owner', confirmed_at: NOW,
    });
    expect(ok.ok).toBe(true);
    expect(rowsOf(IDENTITY_TABLES.links)[0]).toMatchObject({
      confidence: 'confirmed', confirmed_by: 'owner', confirmed_at: NOW,
      evidence: [],
    });
  });

  it('drops stray confirmed_* on non-confirmed rows; duplicates are no-ops', async () => {
    const { client, rowsOf } = makeFakeDb();
    const first = await insertIdentityLink(client, {
      entity_type: 'project', entity_id: PROJ,
      external_system: 'gmail_thread', external_id: 'thread-1',
      confidence: 'candidate', signal: 'ai_candidate', proposed_by: 'llm',
      confirmed_by: 'llm', confirmed_at: NOW, evidence: [{ rank: 8 }],
    });
    expect(first.ok).toBe(true);
    expect(rowsOf(IDENTITY_TABLES.links)[0]).toMatchObject({
      confirmed_by: null, confirmed_at: null, evidence: [{ rank: 8 }],
    });
    const dup = await insertIdentityLink(client, {
      entity_type: 'project', entity_id: PROJ,
      external_system: 'gmail_thread', external_id: 'thread-1',
      confidence: 'candidate', signal: 'ai_candidate', proposed_by: 'llm',
    });
    expect(dup).toMatchObject({ ok: true, duplicate: true });
    expect(rowsOf(IDENTITY_TABLES.links)).toHaveLength(1);
  });

  it('propagates client errors as a failed outcome', async () => {
    const { client } = makeFakeDb({ failInsert: () => 'permission denied' });
    const out = await insertIdentityLink(client, {
      entity_type: 'project', entity_id: PROJ,
      external_system: 'iqplus', external_id: 'Q-1',
      confidence: 'linked_auto', signal: 'external_id', proposed_by: 'sys',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/identity_links record failed: permission denied/);
  });
});

describe('listIdentityLinks', () => {
  it('filters by entity and fails closed on bad ids', async () => {
    const { client } = makeFakeDb();
    await insertIdentityLink(client, {
      entity_type: 'project', entity_id: PROJ,
      external_system: 'iqplus', external_id: 'Q-1',
      confidence: 'linked_auto', signal: 'external_id', proposed_by: 'sys',
    });
    await insertIdentityLink(client, {
      entity_type: 'client', entity_id: PROJ,
      external_system: 'airtable', external_id: 'rec1',
      confidence: 'linked_auto', signal: 'external_id', proposed_by: 'sys',
    });
    const out = await listIdentityLinks(client, {
      entity_type: 'project', entity_id: PROJ,
    });
    expect(out.ok).toBe(true);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].external_system).toBe('iqplus');
    const bad = await listIdentityLinks(client, {
      entity_type: 'project', entity_id: 'x',
    });
    expect(bad).toEqual({ ok: false, rows: [], error: 'invalid entity_id' });
  });
});

describe('review queue adapters', () => {
  const item = {
    subject_type: 'gmail_message', subject_id: 'msg-1',
    candidate_entity_type: 'project' as const, candidate_entity_id: PROJ,
    reason: 'ambiguous order number', signals: [{ rank: 4 }],
  };

  it('inserts open items only and lists them oldest first', async () => {
    const { client, rowsOf } = makeFakeDb();
    const out = await insertReviewItem(client, item);
    expect(out.ok).toBe(true);
    expect(rowsOf(IDENTITY_TABLES.reviewQueue)[0]).toMatchObject({
      status: 'open', decided_by: null, decided_at: null,
    });
    expect((await insertReviewItem(client, { ...item, reason: '' })).ok).toBe(false);
    expect((await insertReviewItem(client, {
      ...item, candidate_entity_id: 'bad',
    })).ok).toBe(false);
    const open = await listOpenReviewItems(client);
    expect(open.ok).toBe(true);
    expect(open.rows).toHaveLength(1);
  });

  it('decides with CAS on status=open; a second decision is refused', async () => {
    const { client, rowsOf } = makeFakeDb();
    const ins = await insertReviewItem(client, item);
    const id = String(ins.id);
    const first = await decideReviewItem(client, id, 'confirmed', 'owner', NOW);
    expect(first).toEqual({ ok: true, id });
    expect(rowsOf(IDENTITY_TABLES.reviewQueue)[0]).toMatchObject({
      status: 'confirmed', decided_by: 'owner', decided_at: NOW,
    });
    const second = await decideReviewItem(client, id, 'rejected', 'owner', NOW);
    expect(second).toEqual({ ok: false, error: 'not_open' });
    expect(rowsOf(IDENTITY_TABLES.reviewQueue)[0].status).toBe('confirmed');
    expect((await listOpenReviewItems(client)).rows).toHaveLength(0);
  });

  it('requires decided_by, a valid decision and a valid id', async () => {
    const { client } = makeFakeDb();
    const ins = await insertReviewItem(client, item);
    const id = String(ins.id);
    expect((await decideReviewItem(client, id, 'confirmed', '', NOW)))
      .toEqual({ ok: false, error: 'decided_by required' });
    expect((await decideReviewItem(client, id, 'maybe' as 'confirmed', 'o', NOW)).ok)
      .toBe(false);
    expect((await decideReviewItem(client, 'nope', 'confirmed', 'o', NOW)).ok)
      .toBe(false);
    expect((await decideReviewItem(client, id, 'confirmed', 'o', '')).ok).toBe(false);
  });

  it('propagates update errors', async () => {
    const { client } = makeFakeDb({ failUpdate: () => 'row level security' });
    const ins = await insertReviewItem(client, item);
    const out = await decideReviewItem(client, String(ins.id), 'rejected', 'o', NOW);
    expect(out).toEqual({ ok: false, error: 'row level security' });
  });
});

describe('insertAlias', () => {
  it('requires a kind, a normalized value and at least one target', async () => {
    const { client, rowsOf } = makeFakeDb();
    expect((await insertAlias(client, {
      alias_kind: 'email', normalized_value: 'ops@vendor.example',
    })).error).toBe('alias needs a target entity');
    expect((await insertAlias(client, {
      alias_kind: 'email', normalized_value: '', project_id: PROJ,
    })).ok).toBe(false);
    expect((await insertAlias(client, {
      alias_kind: 'fax' as 'email', normalized_value: 'x', project_id: PROJ,
    })).ok).toBe(false);
    expect((await insertAlias(client, {
      alias_kind: 'email', normalized_value: 'x@y.z', client_id: 'bad',
    })).error).toBe('invalid client_id');
    const ok = await insertAlias(client, {
      alias_kind: 'email', normalized_value: 'ops@vendor.example', project_id: PROJ,
    });
    expect(ok.ok).toBe(true);
    expect(rowsOf(IDENTITY_TABLES.aliases)[0]).toMatchObject({
      approved: false, active: true, source: 'manual',
      display_value: 'ops@vendor.example',
    });
  });
});

describe('no row-removal path', () => {
  it('the store never calls the removal builder on any table', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'business', 'identity', 'store.ts'),
      'utf8',
    );
    // Fragment idiom: the RED scanner flags the literal builder name.
    expect(src).not.toMatch(new RegExp('\\.dele' + 'te\\('));
    expect(src).not.toMatch(/\.rpc\(/);
  });
});
