// andersen_catalog adapters against a fake client with the unique key.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import type { CatalogRow } from '../src/lib/business/andersen/catalog';
import { FIXTURE_ANDERSEN_CATALOG } from '../src/lib/business/andersen/fixture';
import {
  insertCatalogRows,
  listCatalog,
  validateCatalogRow,
} from '../src/lib/business/andersen/store';

type Row = Record<string, unknown>;
const KEY = ['series', 'unit_type', 'attribute', 'value', 'constraint_kind'];

function makeFakeDb() {
  const rows: Row[] = [];
  let seq = 0;
  const client: RuntimeClient = {
    from() {
      return {
        insert(row: Row) {
          return {
            select() {
              if (rows.some((r) => KEY.every((c) => r[c] === row[c]))) {
                return Promise.resolve({ data: null, error: { message: 'duplicate key' } });
              }
              seq += 1;
              const stored = { id: `id-${seq}`, ...row };
              rows.push(stored);
              return Promise.resolve({ data: [{ id: stored.id }], error: null });
            },
          };
        },
        select() {
          const chain = (f: Array<(r: Row) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order(col: string) {
              return {
                limit(n: number) {
                  const out = rows.filter((r) => f.every((fn) => fn(r)))
                    .sort((a, b) => String(a[col]).localeCompare(String(b[col])));
                  return Promise.resolve({ data: out.slice(0, n), error: null });
                },
              };
            },
            limit(n: number) {
              return Promise.resolve({
                data: rows.filter((r) => f.every((fn) => fn(r))).slice(0, n), error: null,
              });
            },
          });
          return chain([]);
        },
        update() {
          throw new Error('andersen store must never update');
        },
      };
    },
  };
  return { client, rows };
}

describe('insertCatalogRows - insert only, idempotent on the unique key', () => {
  it('inserts the fixture, then reports every row as a duplicate on replay', async () => {
    const db = makeFakeDb();
    const first = await insertCatalogRows(db.client, [...FIXTURE_ANDERSEN_CATALOG]);
    expect(first).toEqual({ ok: true, inserted: FIXTURE_ANDERSEN_CATALOG.length, duplicates: 0 });
    const replay = await insertCatalogRows(db.client, [...FIXTURE_ANDERSEN_CATALOG]);
    expect(replay).toEqual({ ok: true, inserted: 0, duplicates: FIXTURE_ANDERSEN_CATALOG.length });
    expect(db.rows).toHaveLength(FIXTURE_ANDERSEN_CATALOG.length);
  });
  it('validates the whole batch before writing anything', async () => {
    const db = makeFakeDb();
    const bad: CatalogRow = {
      ...FIXTURE_ANDERSEN_CATALOG[0], state: 'verified', fact_id: null,
    };
    const r = await insertCatalogRows(db.client, [FIXTURE_ANDERSEN_CATALOG[1], bad]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rows\[1\] invalid: trusted_row_requires_fact_id/);
    expect(db.rows).toHaveLength(0);
    expect((await insertCatalogRows(db.client, [])).ok).toBe(false);
    expect(validateCatalogRow({
      ...FIXTURE_ANDERSEN_CATALOG[0], constraint_kind: 'price' as never,
    })).toContain('constraint_kind_invalid');
  });
  it('listCatalog filters by series, fails closed on empty series', async () => {
    const db = makeFakeDb();
    await insertCatalogRows(db.client, [...FIXTURE_ANDERSEN_CATALOG]);
    const fx = await listCatalog(db.client, 'FX');
    expect(fx.ok).toBe(true);
    expect(fx.rows).toHaveLength(FIXTURE_ANDERSEN_CATALOG.length);
    expect(fx.rows[0].unit_type).toBe('casement');
    expect((await listCatalog(db.client, '400')).rows).toEqual([]);
    expect((await listCatalog(db.client, '')).ok).toBe(false);
  });
  it('the store has no update or delete path', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'business', 'andersen', 'store.ts'), 'utf8',
    );
    expect(src).not.toMatch(/\.update\(|\.delete\(/);
  });
});
