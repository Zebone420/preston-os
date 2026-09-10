// Andersen master-index import (master build plan 6.3: "use the existing
// Drive Andersen database; do not rebuild it"). Parses an index of
// (title, series, doc_type, version, drive_file_id, sha256?, effective_from?)
// rows - CSV or JSON - into knowledge_sources CANDIDATES for domain
// ANDERSEN_OFFICIAL. Malformed rows are reported, never dropped silently.
// The index describes documents; it carries no product facts.

import { neutralizeUntrusted } from '../../guards';
import type { AuthorityClass } from './types';
import { ISO_DATE_RE, SHA256_RE } from './types';

export const MASTER_INDEX_DOMAIN = 'ANDERSEN_OFFICIAL';
export const MASTER_INDEX_MAX_ROWS = 5000;
const FIELD_MAX = 500;

export interface MasterIndexCandidate {
  domain: typeof MASTER_INDEX_DOMAIN;
  title: string;
  authority_class: AuthorityClass;
  source_version: string;
  sha256: string | null;
  needs_hash: boolean;
  effective_from: string | null;
  is_current: true;
  metadata: {
    series: string;
    doc_type: string;
    drive_file_id: string;
    index_row: number;
  };
}

export interface MalformedRow {
  row: number;
  reason: string;
  raw: Record<string, string>;
}

export interface MasterIndexParse {
  ok: boolean;
  format: 'csv' | 'json' | 'unknown';
  total_rows: number;
  candidates: MasterIndexCandidate[];
  malformed: MalformedRow[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, string> = {
  title: 'title',
  name: 'title',
  document_title: 'title',
  series: 'series',
  product_series: 'series',
  doc_type: 'doc_type',
  type: 'doc_type',
  document_type: 'doc_type',
  version: 'version',
  source_version: 'version',
  drive_file_id: 'drive_file_id',
  file_id: 'drive_file_id',
  drive_id: 'drive_file_id',
  sha256: 'sha256',
  hash: 'sha256',
  effective_from: 'effective_from',
  effective: 'effective_from',
  effective_date: 'effective_from',
};

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return HEADER_ALIASES[key] ?? key;
}

// RFC4180-ish line parser: quoted fields, doubled quotes, commas inside.
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvRows(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: ['empty_index'] };
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (cells[j] ?? '').trim();
    });
    if (cells.length !== headers.length) {
      row.__column_count_mismatch = String(cells.length);
    }
    rows.push(row);
  }
  return { rows, errors: [] };
}

function jsonRows(text: string): { rows: Record<string, string>[]; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], errors: ['invalid_json'] };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
      ? ((parsed as { rows: unknown[] }).rows)
      : null;
  if (!list) return { rows: [], errors: ['json_not_a_row_list'] };
  const rows = list.map((item) => {
    const row: Record<string, string> = {};
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      row.__not_an_object = 'true';
      return row;
    }
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      row[normalizeHeader(k)] =
        v === null || v === undefined ? '' : String(v).trim();
    }
    return row;
  });
  return { rows, errors: [] };
}

function field(row: Record<string, string>, key: string): string {
  return neutralizeUntrusted(row[key] ?? '', FIELD_MAX);
}

export function parseAndersenMasterIndex(input: string): MasterIndexParse {
  const raw = typeof input === 'string' ? input : '';
  // Strip a leading byte-order mark (code point 0xFEFF) if present.
  const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim();
  const result: MasterIndexParse = {
    ok: false,
    format: 'unknown',
    total_rows: 0,
    candidates: [],
    malformed: [],
    errors: [],
  };
  if (text === '') {
    result.errors.push('empty_index');
    return result;
  }
  const isJson = text.startsWith('[') || text.startsWith('{');
  result.format = isJson ? 'json' : 'csv';
  const { rows, errors } = isJson ? jsonRows(text) : csvRows(text);
  result.errors.push(...errors);
  if (rows.length > MASTER_INDEX_MAX_ROWS) {
    result.errors.push('too_many_rows');
    return result;
  }
  result.total_rows = rows.length;
  if (rows.length === 0 && errors.length === 0) result.errors.push('no_rows');

  rows.forEach((row, i) => {
    const rowNo = i + 1;
    const reject = (reason: string) =>
      result.malformed.push({ row: rowNo, reason, raw: row });
    if (row.__not_an_object) return reject('row_not_an_object');
    if (row.__column_count_mismatch) return reject('column_count_mismatch');
    const title = field(row, 'title');
    const driveId = field(row, 'drive_file_id');
    const sha = field(row, 'sha256').toLowerCase();
    const eff = field(row, 'effective_from');
    if (title === '') return reject('missing_title');
    if (driveId === '' || !/^[A-Za-z0-9_-]{5,}$/.test(driveId)) {
      return reject('invalid_drive_file_id');
    }
    if (sha !== '' && !SHA256_RE.test(sha)) return reject('invalid_sha256');
    if (eff !== '' && !ISO_DATE_RE.test(eff)) return reject('invalid_effective_from');
    result.candidates.push({
      domain: MASTER_INDEX_DOMAIN,
      title,
      authority_class: 'OFFICIAL_CURRENT',
      source_version: field(row, 'version'),
      sha256: sha === '' ? null : sha,
      needs_hash: sha === '',
      effective_from: eff === '' ? null : eff,
      is_current: true,
      metadata: {
        series: field(row, 'series'),
        doc_type: field(row, 'doc_type'),
        drive_file_id: driveId,
        index_row: rowNo,
      },
    });
  });

  // Duplicate drive ids inside one index are reported, not merged.
  const seen = new Map<string, number>();
  result.candidates = result.candidates.filter((c) => {
    const prev = seen.get(c.metadata.drive_file_id);
    if (prev !== undefined) {
      result.malformed.push({
        row: c.metadata.index_row,
        reason: `duplicate_drive_file_id_of_row_${prev}`,
        raw: { drive_file_id: c.metadata.drive_file_id, title: c.title },
      });
      return false;
    }
    seen.set(c.metadata.drive_file_id, c.metadata.index_row);
    return true;
  });
  result.malformed.sort((a, b) => a.row - b.row);
  result.ok = result.errors.length === 0 && result.candidates.length > 0;
  return result;
}
