// Preston AI OS - Phase 3 iqplus.report.ingest. PURE, deterministic parse
// of an Andersen IQ+ ABBREVIATED quote report TEXT fixture into openings /
// units with NO prices. Client contact fields (Customer, Homeowner, Contact,
// Phone, Email, Cell, Mobile, Client) are STRIPPED and reported; price
// lines are DROPPED and reported; and when a known client contact still
// appears in the remaining text the ingest is REFUSED (owner rule).
//
// Fixture grammar:
//   ANDERSEN IQ+ ABBREVIATED QUOTE REPORT
//   Quote Number: IQ-2026-000123
//   Version: 2
//   Project: P26-0041
//   Customer: ...            (stripped)
//   Opening 1: Kitchen
//     Unit 1: 400 Series Woodwright Double-Hung TW3046
//       Size: 36 x 54 | Color: White | Glass: Low-E4
//       Qty: 2
//       Price: $1,234.56      (dropped)

import type { ParamsValidation } from '../registry';
import { sha256Canonical } from '../contract';
import { IqplusIngestParamsSchema, parseWith, type IqplusIngestParams } from './schemas';
import { findClientContactLeak, type ClientContact } from './recipient-allowlist';
import { neutralizeUntrusted } from './untrusted';

export const CONTACT_FIELD_KEYS: readonly string[] = [
  'customer', 'homeowner', 'contact', 'phone', 'email', 'cell', 'mobile', 'client',
];

export interface IqplusUnit {
  unit_no: number;
  description: string;
  sku: string | null;
  qty: number | null;
  spec: Record<string, string>;
}

export interface IqplusOpening {
  opening_no: number;
  label: string;
  units: IqplusUnit[];
}

export interface IqplusReport {
  quote_number: string | null;
  version: number | null;
  project_ref: string | null;
  openings: IqplusOpening[];
  stripped_fields: string[]; // sorted unique field names removed
  warnings: string[];
}

export type IqplusIngest =
  | { ok: true; report: IqplusReport }
  | { ok: false; reason: 'client_contact_leakage' | 'report_unrecognized' };

const SKU_RE = /\b([A-Z]{1,4}\d{2,5}[A-Z]?)\b/;
const OPENING_RE = /^Opening\s+(\d+)\s*:\s*(.*)$/i;
const UNIT_RE = /^Unit\s+(\d+)\s*:\s*(.+)$/i;
const PRICE_RE = /^(price|unit\s+price|ext(ended)?\s+price|total|subtotal)\s*:/i;

function fieldOf(line: string): { key: string; value: string } | null {
  const idx = line.indexOf(':');
  if (idx <= 0) return null;
  return { key: line.slice(0, idx).trim().toLowerCase(), value: line.slice(idx + 1).trim() };
}

export function ingestIqplusReport(
  rawText: string,
  clientContacts: ClientContact[] = [],
): IqplusIngest {
  const text = neutralizeUntrusted(rawText, 6000);
  if (!/IQ\+|IQPLUS|IQ PLUS/i.test(text)) return { ok: false, reason: 'report_unrecognized' };
  const report: IqplusReport = {
    quote_number: null, version: null, project_ref: null,
    openings: [], stripped_fields: [], warnings: [],
  };
  const stripped = new Set<string>();
  const kept: string[] = [];
  let opening: IqplusOpening | null = null;
  let unit: IqplusUnit | null = null;
  let priceDrops = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = fieldOf(line);
    if (f && CONTACT_FIELD_KEYS.includes(f.key)) { stripped.add(f.key); continue; }
    if (PRICE_RE.test(line) || /\$\s*\d/.test(line)) { priceDrops++; continue; }
    const op = OPENING_RE.exec(line);
    if (op) {
      opening = { opening_no: Number(op[1]), label: op[2].trim(), units: [] };
      report.openings.push(opening);
      unit = null;
      kept.push(opening.label);
      continue;
    }
    const un = UNIT_RE.exec(line);
    if (un && opening) {
      const desc = un[2].trim();
      const sku = SKU_RE.exec(desc);
      unit = { unit_no: Number(un[1]), description: desc,
        sku: sku ? sku[1] : null, qty: null, spec: {} };
      opening.units.push(unit);
      kept.push(desc);
      continue;
    }
    if (unit && f && f.key === 'qty') {
      const q = Number(f.value);
      unit.qty = Number.isInteger(q) && q >= 0 ? q : null;
      if (unit.qty === null) report.warnings.push(`qty_invalid:${i + 1}`);
      continue;
    }
    if (unit && line.includes(':')) {
      for (const part of line.split('|')) {
        const pf = fieldOf(part);
        if (pf && pf.value) unit.spec[pf.key.replace(/\s+/g, '_')] = pf.value;
      }
      kept.push(line);
      continue;
    }
    if (f && !opening) {
      if (f.key === 'quote number' || f.key === 'quote') report.quote_number = f.value;
      else if (f.key === 'version') {
        const v = Number(f.value.replace(/^v/i, ''));
        report.version = Number.isInteger(v) ? v : null;
      } else if (f.key === 'project') report.project_ref = f.value;
      else kept.push(f.value);
      continue;
    }
    if (!/abbreviated quote report/i.test(line)) report.warnings.push(`unparsed_line:${i + 1}`);
  }
  report.stripped_fields = [...stripped].sort();
  if (priceDrops > 0) report.warnings.push(`price_fields_dropped:${priceDrops}`);
  if (report.openings.length === 0) report.warnings.push('no_openings');
  if (clientContacts.length > 0 && findClientContactLeak(kept, clientContacts)) {
    return { ok: false, reason: 'client_contact_leakage' };
  }
  return { ok: true, report };
}

export function validateIqplusIngest(params: Record<string, unknown>): ParamsValidation {
  const parsed = parseWith(IqplusIngestParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p: IqplusIngestParams = parsed.data;
  const ingest = ingestIqplusReport(p.report_text, p.client_contacts ?? []);
  if (!ingest.ok) return { ok: false, reason: ingest.reason };
  return {
    ok: true,
    canonical: {
      kind: 'iqplus.report.ingest',
      project_id: p.project_id,
      source: p.source,
      text_sha256: sha256Canonical(p.report_text),
      stripped_fields: ingest.report.stripped_fields,
    },
    binding: {
      project_id: p.project_id, document_hash: p.source.sha256,
      amount: null, recipient: null,
    },
  };
}
