// Phase 4 - Andersen Knowledge Core v1 STRUCTURE (plan section 6.3 and
// PHASE 4 "Andersen Knowledge Core v1"; migration 0033 andersen_catalog).
//
// This module holds NO product data. It defines the typed catalog model
// and deterministic checks over catalog rows that arrive from cited,
// human-verified knowledge facts (import.ts). Rules:
//   - only 'verified' / 'authorized' rows may produce a VIOLATION;
//   - 'candidate' rows only produce a candidate_hint;
//   - when no verified row covers a check the answer is 'unknown' -
//     never guessed, never defaulted.
// PURE: no I/O.

import { UNIT_TYPES, type OpeningRow } from '../sales/openings';

export const ANDERSEN_SERIES = ['100', '400', 'E', 'A'] as const;
export type AndersenSeries = (typeof ANDERSEN_SERIES)[number];

export const CATALOG_UNIT_TYPES = UNIT_TYPES;

export const CONSTRAINT_KINDS = [
  'availability',
  'size_min',
  'size_max',
  'compatibility',
  'hardware',
  'glass',
  'grille',
  'color',
] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export const OPTION_KINDS = ['glass', 'grille', 'hardware', 'color'] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

export const CATALOG_STATES = ['candidate', 'verified', 'authorized'] as const;
export type CatalogState = (typeof CATALOG_STATES)[number];

export interface CatalogCitation {
  source_id?: string;
  chunk_id?: string;
  quote?: string;
  fixture?: boolean;
  note?: string;
  [k: string]: unknown;
}

export interface CatalogRow {
  id?: string;
  series: string;
  unit_type: string;
  attribute: string; // 'width_in' | 'height_in' | 'unit_type' | option kind
  value: string; // option value, or '*' for a dimension bound
  constraint_kind: ConstraintKind;
  constraint_value: Record<string, unknown>;
  fact_id: string | null;
  source_citation: CatalogCitation;
  state: CatalogState;
}

export function isAndersenSeries(v: unknown): v is AndersenSeries {
  return typeof v === 'string' && (ANDERSEN_SERIES as readonly string[]).includes(v);
}

export function isConstraintKind(v: unknown): v is ConstraintKind {
  return typeof v === 'string' && (CONSTRAINT_KINDS as readonly string[]).includes(v);
}

export function isCatalogState(v: unknown): v is CatalogState {
  return typeof v === 'string' && (CATALOG_STATES as readonly string[]).includes(v);
}

export function isTrusted(row: CatalogRow): boolean {
  return row.state === 'verified' || row.state === 'authorized';
}

export function lookupConstraints(
  catalog: CatalogRow[],
  q: { series: string; unitType: string },
): CatalogRow[] {
  return catalog
    .filter((r) => r.series === q.series && r.unit_type === q.unitType)
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function keyOf(r: CatalogRow): string {
  return [r.constraint_kind, r.attribute, r.value].join('|');
}

export interface Violation {
  kind: 'size_out_of_range' | 'option_unavailable' | 'incompatible_option'
    | 'unit_type_unavailable';
  attribute: string;
  value: string;
  detail: Record<string, unknown>;
  fact_id: string | null;
}

export interface CandidateHint {
  attribute: string;
  value: string;
  constraint_kind: ConstraintKind;
  detail: Record<string, unknown>;
}

export interface ConfigurationCheck {
  ok: boolean; // no violations from trusted rows
  complete: boolean; // no unknowns
  violations: Violation[];
  candidate_hints: CandidateHint[];
  unknown: string[]; // checks with no trusted fact ('attribute:value')
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

// Deterministic configuration check for one opening against the catalog.
export function checkConfiguration(
  catalog: CatalogRow[],
  opening: OpeningRow,
): ConfigurationCheck {
  const series = typeof opening.configuration.series === 'string'
    ? opening.configuration.series
    : null;
  const violations: Violation[] = [];
  const hints: CandidateHint[] = [];
  const unknown: string[] = [];
  if (!series) {
    unknown.push('series:missing');
    return { ok: true, complete: false, violations, candidate_hints: hints, unknown };
  }
  const rows = lookupConstraints(catalog, { series, unitType: opening.unit_type });
  const trusted = rows.filter(isTrusted);
  const candidates = rows.filter((r) => r.state === 'candidate');

  // Unit type availability within the series.
  const avail = trusted.find(
    (r) => r.constraint_kind === 'availability' && r.attribute === 'unit_type',
  );
  if (!avail) {
    const c = candidates.find(
      (r) => r.constraint_kind === 'availability' && r.attribute === 'unit_type',
    );
    if (c) hints.push(hint(c));
    unknown.push(`unit_type:${opening.unit_type}`);
  } else if (avail.constraint_value.available === false) {
    violations.push({
      kind: 'unit_type_unavailable',
      attribute: 'unit_type',
      value: opening.unit_type,
      detail: { series },
      fact_id: avail.fact_id,
    });
  }

  // Size bounds.
  for (const dim of ['width_in', 'height_in'] as const) {
    const actual = opening[dim];
    const minRow = trusted.find(
      (r) => r.constraint_kind === 'size_min' && r.attribute === dim,
    );
    const maxRow = trusted.find(
      (r) => r.constraint_kind === 'size_max' && r.attribute === dim,
    );
    if (!minRow && !maxRow) {
      for (const c of candidates) {
        if (
          (c.constraint_kind === 'size_min' || c.constraint_kind === 'size_max') &&
          c.attribute === dim
        ) {
          hints.push(hint(c));
        }
      }
      unknown.push(`${dim}:range`);
      continue;
    }
    const min = minRow ? num(minRow.constraint_value.min) : null;
    const max = maxRow ? num(maxRow.constraint_value.max) : null;
    if (!minRow) unknown.push(`${dim}:min`);
    if (!maxRow) unknown.push(`${dim}:max`);
    if (min !== null && actual < min) {
      violations.push({
        kind: 'size_out_of_range',
        attribute: dim,
        value: String(actual),
        detail: { bound: 'min', min },
        fact_id: minRow ? minRow.fact_id : null,
      });
    }
    if (max !== null && actual > max) {
      violations.push({
        kind: 'size_out_of_range',
        attribute: dim,
        value: String(actual),
        detail: { bound: 'max', max },
        fact_id: maxRow ? maxRow.fact_id : null,
      });
    }
  }

  // Option availability + compatibility for each configured option.
  for (const kind of OPTION_KINDS) {
    const value = opening.configuration[kind];
    if (typeof value !== 'string' || !value) continue;
    const row = trusted.find(
      (r) => r.constraint_kind === kind && r.attribute === kind && r.value === value,
    );
    if (!row) {
      const c = candidates.find(
        (r) => r.constraint_kind === kind && r.attribute === kind && r.value === value,
      );
      if (c) hints.push(hint(c));
      unknown.push(`${kind}:${value}`);
    } else if (row.constraint_value.available === false) {
      violations.push({
        kind: 'option_unavailable',
        attribute: kind,
        value,
        detail: { series },
        fact_id: row.fact_id,
      });
    }
    // Compatibility rows: attribute = the option kind, value = the option,
    // constraint_value.excludes = { <other kind>: [values] }.
    const compat = trusted.filter(
      (r) => r.constraint_kind === 'compatibility' && r.attribute === kind && r.value === value,
    );
    for (const cr of compat) {
      const excludes = cr.constraint_value.excludes;
      if (!excludes || typeof excludes !== 'object') continue;
      for (const [otherKind, vals] of Object.entries(excludes as Record<string, unknown>)) {
        const other = opening.configuration[otherKind];
        if (typeof other === 'string' && strList(vals).includes(other)) {
          violations.push({
            kind: 'incompatible_option',
            attribute: kind,
            value,
            detail: { conflicts_with: { [otherKind]: other } },
            fact_id: cr.fact_id,
          });
        }
      }
    }
    for (const c of candidates) {
      if (c.constraint_kind === 'compatibility' && c.attribute === kind && c.value === value) {
        hints.push(hint(c));
      }
    }
  }

  return {
    ok: violations.length === 0,
    complete: unknown.length === 0,
    violations,
    candidate_hints: hints,
    unknown,
  };
}

function hint(c: CatalogRow): CandidateHint {
  return {
    attribute: c.attribute,
    value: c.value,
    constraint_kind: c.constraint_kind,
    detail: { ...c.constraint_value, state: 'candidate' },
  };
}
