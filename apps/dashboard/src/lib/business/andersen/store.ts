// Phase 4 - andersen_catalog adapters (migration 0033). Insert-only:
// state promotion is an owner update outside this module; nothing is
// ever deleted. Same injected-client idiom as business-store.ts.

import type { RuntimeClient, WriteOutcome } from '../../ai-os/store';
import { UUID_RE } from '../types';
import {
  isCatalogState,
  isConstraintKind,
  type CatalogRow,
} from './catalog';

export const ANDERSEN_TABLES = { catalog: 'andersen_catalog' } as const;

export const CATALOG_BATCH_MAX = 500;
const MAX_LIST = 1000;

export interface ListOutcome {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

export interface BatchOutcome {
  ok: boolean;
  inserted: number;
  duplicates: number;
  error?: string;
}

export function validateCatalogRow(row: CatalogRow): string[] {
  const errors: string[] = [];
  for (const f of ['series', 'unit_type', 'attribute', 'value'] as const) {
    if (typeof row[f] !== 'string' || !row[f].trim()) errors.push(`${f}_missing`);
  }
  if (!isConstraintKind(row.constraint_kind)) errors.push('constraint_kind_invalid');
  if (!isCatalogState(row.state)) errors.push('state_invalid');
  if (row.fact_id !== null && !UUID_RE.test(row.fact_id)) errors.push('fact_id_invalid');
  if (row.state !== 'candidate' && row.fact_id === null) {
    errors.push('trusted_row_requires_fact_id');
  }
  if (!row.source_citation || typeof row.source_citation !== 'object') {
    errors.push('source_citation_missing');
  }
  if (!row.constraint_value || typeof row.constraint_value !== 'object') {
    errors.push('constraint_value_invalid');
  }
  if (row.id !== undefined && !UUID_RE.test(row.id)) errors.push('id_invalid');
  return errors;
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

// Validates the whole batch first (all-or-nothing on validation), then
// inserts row by row; a unique-key duplicate is an idempotent no-op.
export async function insertCatalogRows(
  client: RuntimeClient,
  rows: CatalogRow[],
): Promise<BatchOutcome> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, inserted: 0, duplicates: 0, error: 'no rows' };
  }
  if (rows.length > CATALOG_BATCH_MAX) {
    return { ok: false, inserted: 0, duplicates: 0, error: 'batch too large' };
  }
  for (let i = 0; i < rows.length; i += 1) {
    const errors = validateCatalogRow(rows[i]);
    if (errors.length > 0) {
      return {
        ok: false, inserted: 0, duplicates: 0,
        error: `rows[${i}] invalid: ${errors.join(',')}`,
      };
    }
  }
  let inserted = 0;
  let duplicates = 0;
  for (const row of rows) {
    const payload: Record<string, unknown> = {
      series: row.series,
      unit_type: row.unit_type,
      attribute: row.attribute,
      value: row.value,
      constraint_kind: row.constraint_kind,
      constraint_value: row.constraint_value,
      fact_id: row.fact_id,
      source_citation: row.source_citation,
      state: row.state,
    };
    if (row.id) payload.id = row.id;
    const out = await insertOne(client, payload);
    if (!out.ok) return { ok: false, inserted, duplicates, error: out.error };
    if (out.duplicate) duplicates += 1;
    else inserted += 1;
  }
  return { ok: true, inserted, duplicates };
}

async function insertOne(
  client: RuntimeClient,
  row: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(ANDERSEN_TABLES.catalog).insert(row).select('id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) return { ok: true, duplicate: true };
      return { ok: false, error: 'andersen_catalog insert failed: ' + res.error.message };
    }
    const id = res.data?.[0]?.id;
    return { ok: true, id: id ? String(id) : undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'andersen_catalog insert failed',
    };
  }
}

export async function listCatalog(
  client: RuntimeClient,
  series: string,
  limit = MAX_LIST,
): Promise<ListOutcome> {
  if (typeof series !== 'string' || !series.trim()) {
    return { ok: false, rows: [], error: 'series required' };
  }
  const n = Math.max(1, Math.min(limit, MAX_LIST));
  try {
    const res = await client
      .from(ANDERSEN_TABLES.catalog)
      .select('*')
      .eq('series', series)
      .order('unit_type', { ascending: true })
      .limit(n);
    if (res.error) return { ok: false, rows: [], error: res.error.message };
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'catalog read failed',
    };
  }
}
