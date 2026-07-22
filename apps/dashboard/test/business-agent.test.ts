import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  runQuoteDraftAgent,
  type QuoteAgentDeps,
  type QuoteDraftRequest,
} from '../src/lib/business/quote-agent';
import { calculateQuote } from '../src/lib/business/quote-engine';

// ---------------------------------------------------------------------------
// In-memory fake Supabase client (same chain shape the store uses).
// Enforces unique keys like the real schema so idempotency is honest.
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

const UNIQUE_KEYS: Record<string, string[][]> = {
  quote_draft_runs: [['idempotency_key']],
  business_activity_events: [['idempotency_key']],
  agent_recommendations: [['idempotency_key']],
  payment_events: [['idempotency_key']],
  quote_versions: [['quote_id', 'version']],
  approval_links: [['approval_id', 'entity_type', 'entity_id']],
};

export function makeFakeDb(failTables: Set<string> = new Set()) {
  const tables = new Map<string, FakeRow[]>();
  let nextId = 1000;
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: FakeRow) {
          return {
            select() {
              if (failTables.has(table)) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'injected failure' },
                });
              }
              const rows = rowsOf(table);
              for (const keys of UNIQUE_KEYS[table] ?? []) {
                const clash = rows.find((r) =>
                  keys.every((k) => r[k] === row[k] && row[k] !== undefined),
                );
                if (clash) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        'duplicate key value violates unique constraint',
                    },
                  });
                }
              }
              if (row.id !== undefined) {
                const clash = rows.find((r) => r.id === row.id);
                if (clash) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        'duplicate key value violates unique constraint',
                    },
                  });
                }
              }
              const stored = {
                ...row,
                id: row.id ?? `00000000-0000-4000-9000-${String(nextId++).padStart(12, '0')}`,
              };
              rows.push(stored);
              return Promise.resolve({
                data: [{ id: stored.id }],
                error: null,
              });
            },
          };
        },
        select() {
          const makeChain = (filters: Array<(r: FakeRow) => boolean>) => ({
            eq(col: string, val: string) {
              return makeChain([
                ...filters,
                (r: FakeRow) => String(r[col]) === val,
              ]);
            },
            order(col: string, opts: { ascending: boolean }) {
              return {
                limit(n: number) {
                  const rows = rowsOf(table)
                    .filter((r) => filters.every((f) => f(r)))
                    .sort((a, b) => {
                      const av = String(a[col] ?? '');
                      const bv = String(b[col] ?? '');
                      return opts.ascending
                        ? av.localeCompare(bv)
                        : bv.localeCompare(av);
                    })
                    .slice(0, n);
                  return Promise.resolve({ data: rows, error: null });
                },
              };
            },
            limit(n: number) {
              const rows = rowsOf(table)
                .filter((r) => filters.every((f) => f(r)))
                .slice(0, n);
              return Promise.resolve({ data: rows, error: null });
            },
          });
          return makeChain([]);
        },
        update(patch: FakeRow) {
          const makeChain = (filters: Array<(r: FakeRow) => boolean>) => ({
            eq(col: string, val: string) {
              return makeChain([
                ...filters,
                (r: FakeRow) => String(r[col]) === val,
              ]);
            },
            lte() {
              return makeChain(filters);
            },
            gt() {
              return makeChain(filters);
            },
            select() {
              const matched = rowsOf(table).filter((r) =>
                filters.every((f) => f(r)),
              );
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({
                data: matched.map((r) => ({ id: r.id })),
                error: null,
              });
            },
          });
          return makeChain([]);
        },
      };
    },
  };
  return { client, tables, rowsOf };
}

function makeDeps(db: ReturnType<typeof makeFakeDb>): QuoteAgentDeps & {
  auditLog: Array<{ action: string; detail: Record<string, unknown> }>;
} {
  let n = 0;
  const auditLog: Array<{
    action: string;
    detail: Record<string, unknown>;
  }> = [];
  return {
    client: db.client,
    ids: () =>
      `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`,
    now: () => '2026-07-21T12:00:00.000Z',
    audit: async (action, detail) => {
      auditLog.push({ action, detail });
    },
    auditLog,
  };
}

const CLIENT_ID = '00000000-0000-4000-8000-000000000101';

const GOOD_REQUEST: QuoteDraftRequest = {
  title: 'Test brownstone quote',
  client_id: CLIENT_ID,
  scope_type: 'installation',
  jurisdiction: 'NYC',
  quote_fees_cents: 20000,
  items: [
    {
      opening_label: 'W1',
      description: 'window',
      quantity: 3,
      unit_material_cents: 120000,
      unit_labor_cents: 45000,
    },
    {
      opening_label: 'D1',
      description: 'door',
      quantity: 1,
      unit_material_cents: 250000,
      unit_labor_cents: 80000,
      line_fees_cents: 5000,
    },
  ],
  idempotency_key: 'test-key-0001',
  created_by: 'owner',
};

describe('quote-draft agent - happy path', () => {
  it('creates quote, version, items, schedule, approval, run, activity', async () => {
    const db = makeFakeDb();
    const deps = makeDeps(db);
    const result = await runQuoteDraftAgent(deps, GOOD_REQUEST);

    expect(result.status).toBe('completed');
    expect(result.version).toBe(1);
    const calc = calculateQuote(GOOD_REQUEST);
    expect(result.total_cents).toBe(calc.total_cents);

    const quotes = db.rowsOf('quotes');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].status).toBe('pending_approval');
    expect(quotes[0].current_version).toBe(1);
    expect(quotes[0].source).toBe('agent_simulation');

    const versions = db.rowsOf('quote_versions');
    expect(versions).toHaveLength(1);
    expect(versions[0].simulation_state).toBe('simulation');
    expect(versions[0].owner_confirmation_required).toBe(true);
    expect(versions[0].total_cents).toBe(calc.total_cents);
    expect(versions[0].tax_cents).toBe(calc.tax_cents);

    expect(db.rowsOf('quote_items')).toHaveLength(2);
    expect(db.rowsOf('payment_schedules')).toHaveLength(1);

    const approvals = db.rowsOf('approvals');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].decision).toBe('pending');
    expect(approvals[0].action_class).toBe('YELLOW');
    expect(approvals[0].explicit_confirmation).toBe(false);

    const links = db.rowsOf('approval_links');
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.entity_type))).toEqual(
      new Set(['quote', 'quote_version']),
    );
    for (const l of links) {
      expect(l.link_kind).toBe('quote_draft_approval');
    }

    const runs = db.rowsOf('quote_draft_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].simulation_only).toBe(true);
    expect(runs[0].execution_eligible).toBe(false);

    const activity = db.rowsOf('business_activity_events');
    expect(activity).toHaveLength(1);
    expect(activity[0].action).toBe('quote_draft_created');
    expect(activity[0].simulation_state).toBe('simulation');

    expect(deps.auditLog.map((a) => a.action)).toContain(
      'quote_draft_created',
    );
  });

  it('is idempotent: replay returns the stored run without new rows', async () => {
    const db = makeFakeDb();
    const deps = makeDeps(db);
    const first = await runQuoteDraftAgent(deps, GOOD_REQUEST);
    const again = await runQuoteDraftAgent(makeDeps(db), GOOD_REQUEST);
    expect(again.status).toBe('duplicate');
    expect(again.run_id).toBe(first.run_id);
    expect(again.quote_id).toBe(first.quote_id);
    expect(db.rowsOf('quotes')).toHaveLength(1);
    expect(db.rowsOf('quote_versions')).toHaveLength(1);
    expect(db.rowsOf('quote_draft_runs')).toHaveLength(1);
  });

  it('drafts version 2 of an existing quote via CAS bump', async () => {
    const db = makeFakeDb();
    const first = await runQuoteDraftAgent(makeDeps(db), GOOD_REQUEST);
    const second = await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      quote_id: first.quote_id,
      idempotency_key: 'test-key-0002',
      quote_fees_cents: 30000,
    });
    expect(second.status).toBe('completed');
    expect(second.version).toBe(2);
    const quotes = db.rowsOf('quotes');
    expect(quotes[0].current_version).toBe(2);
    expect(db.rowsOf('quote_versions')).toHaveLength(2);
    // Two distinct approval requests exist (one per draft).
    expect(db.rowsOf('approvals')).toHaveLength(2);
  });
});

describe('quote-draft agent - fail-closed behavior', () => {
  it('records failed_validation with missing fields, no quote rows', async () => {
    const db = makeFakeDb();
    const result = await runQuoteDraftAgent(makeDeps(db), {
      title: 'Missing stuff',
      client_id: CLIENT_ID,
      scope_type: 'installation',
      jurisdiction: 'NYC',
      items: [{ quantity: 2 }],
      idempotency_key: 'test-key-0003',
    });
    expect(result.status).toBe('failed_validation');
    expect(result.missing_fields).toContain(
      'items[0].unit_material_cents',
    );
    expect(db.rowsOf('quotes')).toHaveLength(0);
    expect(db.rowsOf('quote_versions')).toHaveLength(0);
    expect(db.rowsOf('approvals')).toHaveLength(0);
    const runs = db.rowsOf('quote_draft_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed_validation');
    expect(runs[0].simulation_only).toBe(true);
    expect(runs[0].execution_eligible).toBe(false);
  });

  it('rejects unsupported jurisdiction without pricing anything', async () => {
    const db = makeFakeDb();
    const result = await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      jurisdiction: 'CT',
      idempotency_key: 'test-key-0004',
    });
    expect(result.status).toBe('failed_validation');
    expect(result.errors).toContain('jurisdiction_unsupported');
    expect(db.rowsOf('quote_versions')).toHaveLength(0);
  });

  it('requires an idempotency key', async () => {
    const db = makeFakeDb();
    const result = await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      idempotency_key: undefined,
    });
    expect(result.status).toBe('failed_validation');
    expect(result.errors).toContain('idempotency_key_required');
  });

  it('fails closed when the target quote does not exist', async () => {
    const db = makeFakeDb();
    const result = await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      quote_id: '00000000-0000-4000-8000-000000009999',
      idempotency_key: 'test-key-0005',
    });
    expect(result.status).toBe('failed_error');
    expect(result.errors).toContain('quote_not_found');
    expect(db.rowsOf('quote_versions')).toHaveLength(0);
  });

  it('duplicate replay reports the stored run status', async () => {
    const db = makeFakeDb();
    await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      items: [{ quantity: 1 }],
      idempotency_key: 'test-key-fail-1',
    });
    const replay = await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      items: [{ quantity: 1 }],
      idempotency_key: 'test-key-fail-1',
    });
    expect(replay.status).toBe('duplicate');
    expect(replay.stored_run_status).toBe('failed_validation');
    expect(replay.quote_id).toBeUndefined();
  });

  it('creates no approval when the draft entities fail to persist', async () => {
    // Audit H2/F2: approval is requested only AFTER the draft fully
    // exists, so a persistence failure can never leave a pending
    // approval pointing at nothing.
    const db = makeFakeDb(new Set(['quote_items']));
    const result = await runQuoteDraftAgent(makeDeps(db), GOOD_REQUEST);
    expect(result.status).toBe('failed_error');
    expect(result.errors).toContain('items_persist_failed');
    expect(db.rowsOf('approvals')).toHaveLength(0);
    expect(db.rowsOf('approval_links')).toHaveLength(0);
    // The quote master stays an unpublished draft at version 0.
    const quotes = db.rowsOf('quotes');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].status).toBe('draft');
    expect(quotes[0].current_version).toBe(0);
    const runs = db.rowsOf('quote_draft_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed_error');
  });

  it('records failed runs even without a valid idempotency key', async () => {
    const db = makeFakeDb();
    const deps = makeDeps(db); // shared: ids() stays unique per call
    await runQuoteDraftAgent(deps, {
      ...GOOD_REQUEST,
      items: [{ quantity: 1 }],
      idempotency_key: undefined,
    });
    await runQuoteDraftAgent(deps, {
      ...GOOD_REQUEST,
      items: [{ quantity: 1 }],
      idempotency_key: undefined,
    });
    // Both failures are individually recorded (fallback keys).
    expect(db.rowsOf('quote_draft_runs')).toHaveLength(2);
  });

  it('propagates the correlation id onto every artifact', async () => {
    const db = makeFakeDb();
    const result = await runQuoteDraftAgent(makeDeps(db), GOOD_REQUEST);
    expect(result.status).toBe('completed');
    const correlation = `qd:${GOOD_REQUEST.idempotency_key}`;
    expect(db.rowsOf('quote_versions')[0].correlation_id).toBe(
      correlation,
    );
    expect(db.rowsOf('quote_draft_runs')[0].correlation_id).toBe(
      correlation,
    );
    expect(
      db.rowsOf('business_activity_events')[0].correlation_id,
    ).toBe(correlation);
  });

  it('never persists an execution-eligible or non-simulation run', async () => {
    const db = makeFakeDb();
    await runQuoteDraftAgent(makeDeps(db), GOOD_REQUEST);
    await runQuoteDraftAgent(makeDeps(db), {
      ...GOOD_REQUEST,
      idempotency_key: 'test-key-0006',
      items: [{ quantity: 1 }],
    });
    for (const run of db.rowsOf('quote_draft_runs')) {
      expect(run.simulation_only).toBe(true);
      expect(run.execution_eligible).toBe(false);
    }
    for (const v of db.rowsOf('quote_versions')) {
      expect(v.simulation_state).toBe('simulation');
    }
  });
});
