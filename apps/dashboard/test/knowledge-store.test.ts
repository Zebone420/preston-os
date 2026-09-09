// Knowledge store adapter pins against a fake RuntimeClient: validation
// before any write, bounded batches, CAS refusal, human-only promotion,
// no delete path.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import { chunkText } from '../src/lib/business/knowledge/chunker';
import type { KnowledgeFact } from '../src/lib/business/knowledge/facts';
import {
  CHUNK_BATCH_MAX,
  insertChunks,
  insertFact,
  insertSource,
  KNOWLEDGE_TABLES,
  listChunks,
  listCurrentSources,
  transitionFact,
  validateSourceInput,
  type SourceInput,
} from '../src/lib/business/knowledge/store';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const SHA = 'b'.repeat(64);
const NOW = '2026-09-08T00:00:00.000Z';

interface Call {
  table: string;
  op: 'insert' | 'select' | 'update';
  row?: Record<string, unknown>;
  filters: [string, string][];
}

// Minimal fake: records calls, answers from a per-table script.
function fakeClient(script: {
  insert?: (table: string, row: Record<string, unknown>) => QueryResult;
  update?: (table: string, row: Record<string, unknown>, f: [string, string][]) => QueryResult;
  select?: (table: string, f: [string, string][]) => QueryResult;
} = {}) {
  const calls: Call[] = [];
  const ok: QueryResult = { data: [{ id: U3 }], error: null };
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          const call: Call = { table, op: 'insert', row, filters: [] };
          calls.push(call);
          return {
            select: async () => (script.insert ? script.insert(table, row) : ok),
          };
        },
        select() {
          const call: Call = { table, op: 'select', filters: [] };
          calls.push(call);
          const chain = {
            eq(col: string, val: string) {
              call.filters.push([col, val]);
              return chain;
            },
            order() {
              return { limit: async () => (script.select ? script.select(table, call.filters)
                : { data: [], error: null }) };
            },
            limit: async () => (script.select ? script.select(table, call.filters)
              : { data: [], error: null }),
          };
          return chain;
        },
        update(row: Record<string, unknown>) {
          const call: Call = { table, op: 'update', row, filters: [] };
          calls.push(call);
          const chain = {
            eq(col: string, val: string) {
              call.filters.push([col, val]);
              return chain;
            },
            lte() { return chain; },
            gt() { return chain; },
            select: async () => (script.update
              ? script.update(table, row, call.filters) : ok),
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

function source(over: Partial<SourceInput> = {}): SourceInput {
  return {
    document_id: U1,
    project_id: null,
    domain: 'PRESTON_SOP',
    title: 'Fixture SOP',
    authority_class: 'INTERNAL_APPROVED',
    source_version: '1',
    sha256: SHA,
    effective_from: null,
    superseded_by: null,
    is_current: true,
    registered_by: 'owner',
    metadata: {},
    ...over,
  };
}

function fact(over: Partial<KnowledgeFact> = {}): KnowledgeFact {
  return {
    domain: 'PRESTON_SOP',
    subject: 's', predicate: 'p', object: 'o',
    criticality: 'informational',
    state: 'EXTRACTED_CANDIDATE',
    citations: [{ source_id: U1, chunk_id: U2, quote: 'q' }],
    extracted_by: 'ai',
    ...over,
  };
}

describe('insertSource', () => {
  it('validates before writing and maps the row', async () => {
    const { client, calls } = fakeClient();
    const res = await insertSource(client, source());
    expect(res).toEqual({ ok: true, id: U3 });
    expect(calls[0].table).toBe(KNOWLEDGE_TABLES.sources);
    expect(calls[0].row).toMatchObject({
      document_id: U1, domain: 'PRESTON_SOP', sha256: SHA, is_current: true,
      registered_by: 'owner', project_id: null,
    });
  });

  it('refuses bad input without touching the client', async () => {
    const { client, calls } = fakeClient();
    const cases: [Partial<SourceInput>, string][] = [
      [{ sha256: 'abc' }, 'invalid_sha256'],
      [{ document_id: 'not-a-uuid' }, 'invalid_document_id'],
      [{ domain: 'GLOBAL' }, 'unknown_domain'],
      [{ domain: 'PROJECT_DOCUMENT' }, 'project_id_required_for_project_document'],
      [{ authority_class: 'GOSPEL' as never }, 'invalid_authority_class'],
      [{ title: ' ' }, 'title_required'],
      [{ effective_from: '01/02/2024' }, 'invalid_effective_from'],
      [{ superseded_by: U2, is_current: true }, 'superseded_source_cannot_be_current'],
      [{ registered_by: '' }, 'registered_by_required'],
    ];
    for (const [over, err] of cases) {
      expect(validateSourceInput(source(over)), err).toContain(err);
      const res = await insertSource(client, source(over));
      expect(res.ok).toBe(false);
      expect(res.error).toContain(err);
    }
    expect(calls.length).toBe(0);
  });

  it('treats a (sha256, domain) duplicate as an idempotent no-op', async () => {
    const { client } = fakeClient({
      insert: () => ({ data: null, error: { message: 'duplicate key value' } }),
    });
    expect(await insertSource(client, source())).toMatchObject({ ok: true, duplicate: true });
  });
});

describe('insertChunks', () => {
  const chunks = chunkText('Fixture paragraph one.\n\nFixture paragraph two.');

  it('writes every chunk with the source id and reports counts', async () => {
    const { client, calls } = fakeClient();
    const res = await insertChunks(client, U1, chunks);
    expect(res).toEqual({ ok: true, inserted: chunks.length, duplicates: 0 });
    for (const c of calls) {
      expect(c.table).toBe(KNOWLEDGE_TABLES.chunks);
      expect(c.row?.source_id).toBe(U1);
      expect(String(c.row?.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is bounded at 500 and validates the whole batch first', async () => {
    const { client, calls } = fakeClient();
    const big = Array.from({ length: CHUNK_BATCH_MAX + 1 }, (_, i) => ({
      ...chunks[0], chunk_index: i,
    }));
    expect(await insertChunks(client, U1, big)).toMatchObject({ ok: false, inserted: 0 });
    expect(await insertChunks(client, U1, [])).toMatchObject({ ok: false });
    expect(await insertChunks(client, 'bad', chunks)).toMatchObject({ ok: false });
    const dupIdx = [{ ...chunks[0] }, { ...chunks[0] }];
    expect((await insertChunks(client, U1, dupIdx)).error).toMatch(/duplicate_index/);
    const badSha = [{ ...chunks[0], sha256: 'zz' }];
    expect((await insertChunks(client, U1, badSha)).error).toMatch(/invalid_sha256/);
    expect(calls.length).toBe(0);
  });

  it('stops at the first failed row and reports progress', async () => {
    let n = 0;
    const { client } = fakeClient({
      insert: () => {
        n += 1;
        return n === 2
          ? { data: null, error: { message: 'boom' } }
          : { data: [{ id: U3 }], error: null };
      },
    });
    const three = [0, 1, 2].map((i) => ({ ...chunks[0], chunk_index: i }));
    const res = await insertChunks(client, U1, three);
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(1);
    expect(res.error).toMatch(/boom/);
  });
});

describe('insertFact', () => {
  it('inserts candidates only, with citations', async () => {
    const { client, calls } = fakeClient();
    expect(await insertFact(client, fact())).toEqual({ ok: true, id: U3 });
    expect(calls[0].row).toMatchObject({ state: 'EXTRACTED_CANDIDATE', extracted_by: 'ai' });
    expect(Array.isArray(calls[0].row?.citations)).toBe(true);
  });

  it('refuses pre-verified rows, uncited facts and bad ids', async () => {
    const { client, calls } = fakeClient();
    const pre = fact({ state: 'AUTHORIZED_FOR_USE', verified_by: 'o', authorized_by: 'o' });
    expect((await insertFact(client, pre)).error).toMatch(/EXTRACTED_CANDIDATE only/);
    expect((await insertFact(client, fact({ citations: [] }))).error).toMatch(/citations_empty/);
    expect((await insertFact(client, fact({ project_id: 'p' }))).error)
      .toMatch(/invalid project id/);
    expect((await insertFact(client, fact({ id: 'x' }))).error).toMatch(/invalid fact id/);
    expect(calls.length).toBe(0);
  });
});

describe('transitionFact', () => {
  it('is compare-and-set on state and stamps human columns', async () => {
    const { client, calls } = fakeClient();
    const res = await transitionFact(client, U1, 'EXTRACTED_CANDIDATE', 'VERIFIED',
      { id: 'owner', kind: 'human' }, NOW);
    expect(res).toEqual({ ok: true, id: U1 });
    expect(calls[0].op).toBe('update');
    expect(calls[0].filters).toEqual([['id', U1], ['state', 'EXTRACTED_CANDIDATE']]);
    expect(calls[0].row).toEqual({
      state: 'VERIFIED', updated_at: NOW, verified_by: 'owner', verified_at: NOW,
    });
  });

  it('refuses AI/system actors for promotion before any write', async () => {
    const { client, calls } = fakeClient();
    for (const kind of ['ai', 'system'] as const) {
      expect(await transitionFact(client, U1, 'EXTRACTED_CANDIDATE', 'VERIFIED',
        { id: 'w', kind }, NOW)).toEqual({ ok: false, error: 'human_actor_required' });
      expect(await transitionFact(client, U1, 'VERIFIED', 'AUTHORIZED_FOR_USE',
        { id: 'w', kind }, NOW)).toEqual({ ok: false, error: 'human_actor_required' });
    }
    expect(await transitionFact(client, U1, 'EXTRACTED_CANDIDATE', 'AUTHORIZED_FOR_USE',
      { id: 'owner', kind: 'human' }, NOW))
      .toEqual({ ok: false, error: 'transition_not_allowed' });
    expect((await transitionFact(client, 'nope', 'VERIFIED', 'AUTHORIZED_FOR_USE',
      { id: 'owner', kind: 'human' }, NOW)).error).toBe('invalid fact id');
    expect(calls.length).toBe(0);
  });

  it('reports state_conflict when the CAS matches zero rows', async () => {
    const { client } = fakeClient({ update: () => ({ data: [], error: null }) });
    expect(await transitionFact(client, U1, 'VERIFIED', 'AUTHORIZED_FOR_USE',
      { id: 'owner', kind: 'human' }, NOW)).toEqual({ ok: false, error: 'state_conflict' });
  });
});

describe('reads', () => {
  it('listCurrentSources filters by domain and is_current, fails closed', async () => {
    const { client, calls } = fakeClient({
      select: () => ({ data: [{ id: U1 }], error: null }),
    });
    const res = await listCurrentSources(client, 'PRESTON_SOP');
    expect(res).toEqual({ ok: true, rows: [{ id: U1 }] });
    expect(calls[0].filters).toEqual([['domain', 'PRESTON_SOP'], ['is_current', 'true']]);
    expect(await listCurrentSources(client, 'GLOBAL')).toMatchObject({ ok: false, rows: [] });
    const { client: bad } = fakeClient({
      select: () => ({ data: null, error: { message: 'rls' } }),
    });
    expect(await listCurrentSources(bad, 'PRESTON_SOP')).toEqual({
      ok: false, rows: [], error: 'rls',
    });
  });

  it('listChunks requires a uuid and filters by source', async () => {
    const { client, calls } = fakeClient();
    expect(await listChunks(client, 'x')).toMatchObject({ ok: false, rows: [] });
    await listChunks(client, U1);
    expect(calls[0].table).toBe(KNOWLEDGE_TABLES.chunks);
    expect(calls[0].filters).toEqual([['source_id', U1]]);
  });
});

describe('structural pins', () => {
  it('the knowledge modules expose no delete path and no execution surface', () => {
    const dir = join(__dirname, '..', 'src', 'lib', 'business', 'knowledge');
    for (const f of ['store.ts', 'retrieval.ts', 'facts.ts', 'domains.ts',
      'chunker.ts', 'precedence.ts', 'master-index.ts', 'untrusted.ts']) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/\.delete\(/);
      expect(text, f).not.toMatch(/child_process|execSync|spawn\(/);
      expect(text, f).not.toMatch(/fetch\(|https?:\/\//);
      expect(text, f).not.toMatch(/service_role|SUPABASE_SERVICE/i);
      expect(text, f).not.toMatch(/embedding|openai/i);
    }
  });
});
