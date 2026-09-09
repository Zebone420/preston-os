// Preston AI OS - Phase 3 vendor.quote.parse. PURE, deterministic parse of
// a Home Depot-style special-order quote TEXT fixture (master build plan
// section 7.2) into a provider-neutral vendor_quote model (7.3): header
// fields, Sold-To / Ship-To blocks, line items with spec key=value fields,
// totals, and WARNINGS. Nothing is recomputed: arithmetic checks only
// compare what the vendor printed. Client contact leakage in Sold-To /
// Ship-To is FLAGGED (owner rule: customer contact must not appear in
// vendor-facing material).
//
// Fixture grammar (one field per line; blocks separated by blank lines):
//   THE HOME DEPOT - SPECIAL ORDER QUOTE
//   Quote #: H1256-471919
//   Case #: 04512345
//   Quote Date: 06/12/2026
//   Revision: V2
//   Sold To:            (block lines until blank)
//   Ship To:            (block lines until blank)
//   Line Items:
//   1 | Qty 2 | <description> | Unit $1,234.56 | Ext $2,469.12
//     Unit: TW3046 | Size: 36 x 54 | Color: White      (spec line)
//   Subtotal: $... / Tax: $... / Total: $...

import type { ParamsValidation } from '../registry';
import { sha256Canonical } from '../contract';
import { VendorQuoteParseParamsSchema, parseWith, type VendorQuoteParseParams } from './schemas';
import { findClientContactLeak, type ClientContact } from './recipient-allowlist';
import { neutralizeUntrusted } from './untrusted';

export interface VendorQuoteLine {
  line_no: number;
  qty: number;
  description: string;
  unit_price_cents: number | null;
  ext_price_cents: number | null;
  spec: Record<string, string>; // lowercase keys, e.g. unit, size, color
}

export interface VendorQuoteTotals {
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
}

export interface ParsedVendorQuote {
  vendor: 'home_depot' | 'unknown';
  quote_number: string | null;
  case_number: string | null;
  quote_date: string | null;
  revision: string | null;
  sold_to: string[];
  ship_to: string[];
  line_items: VendorQuoteLine[];
  totals: VendorQuoteTotals;
  warnings: string[];
  contact_leakage: boolean;
}

const MONEY = '\\$?\\s*(-?[\\d,]+\\.\\d{2})';
const LINE_RE = new RegExp(
  '^(\\d+)\\s*\\|\\s*Qty\\s+(\\d+)\\s*\\|\\s*(.+?)\\s*\\|\\s*Unit\\s+' +
  MONEY + '\\s*\\|\\s*Ext\\s+' + MONEY + '\\s*$', 'i');
const TOTAL_RE = new RegExp('^(Subtotal|Tax|Total)\\s*:\\s*' + MONEY + '\\s*$', 'i');

export function moneyToCents(s: string): number | null {
  const m = /^(-?)([\d,]+)\.(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const dollars = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(dollars)) return null;
  const cents = dollars * 100 + Number(m[3]);
  return m[1] === '-' ? -cents : cents;
}

function headerField(line: string, label: string): string | null {
  const re = new RegExp('^' + label + '\\s*:\\s*(.+)$', 'i');
  const m = re.exec(line);
  return m ? m[1].trim() : null;
}

function parseSpecLine(line: string): Record<string, string> {
  const spec: Record<string, string> = {};
  for (const part of line.split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '_');
    const val = part.slice(idx + 1).trim();
    if (key && val) spec[key] = val;
  }
  return spec;
}

type Section = 'header' | 'sold_to' | 'ship_to' | 'items' | 'totals';

export function parseVendorQuoteText(
  rawText: string,
  clientContacts: ClientContact[] = [],
): ParsedVendorQuote {
  const text = neutralizeUntrusted(rawText, 6000);
  const out: ParsedVendorQuote = {
    vendor: /home\s+depot/i.test(text) ? 'home_depot' : 'unknown',
    quote_number: null, case_number: null, quote_date: null, revision: null,
    sold_to: [], ship_to: [], line_items: [],
    totals: { subtotal_cents: null, tax_cents: null, total_cents: null },
    warnings: [], contact_leakage: false,
  };
  let section: Section = 'header';
  let current: VendorQuoteLine | null = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (section === 'sold_to' || section === 'ship_to') section = 'header';
      continue;
    }
    if (/^sold\s+to\s*:?$/i.test(line)) { section = 'sold_to'; continue; }
    if (/^ship\s+to\s*:?$/i.test(line)) { section = 'ship_to'; continue; }
    if (/^line\s+items\s*:?$/i.test(line)) { section = 'items'; current = null; continue; }
    const total = TOTAL_RE.exec(line);
    if (total) {
      section = 'totals';
      const cents = moneyToCents(total[2]);
      const key = total[1].toLowerCase();
      if (key === 'subtotal') out.totals.subtotal_cents = cents;
      else if (key === 'tax') out.totals.tax_cents = cents;
      else out.totals.total_cents = cents;
      continue;
    }
    if (section === 'sold_to') { out.sold_to.push(line); continue; }
    if (section === 'ship_to') { out.ship_to.push(line); continue; }
    if (section === 'items') {
      const m = LINE_RE.exec(line);
      if (m) {
        current = {
          line_no: Number(m[1]), qty: Number(m[2]), description: m[3],
          unit_price_cents: moneyToCents(m[4]), ext_price_cents: moneyToCents(m[5]),
          spec: {},
        };
        out.line_items.push(current);
        continue;
      }
      if (current && line.includes(':')) {
        Object.assign(current.spec, parseSpecLine(line));
        continue;
      }
      out.warnings.push(`unparsed_line:${i + 1}`);
      continue;
    }
    // header
    out.quote_number = out.quote_number ?? headerField(line, 'Quote\\s*#');
    out.case_number = out.case_number ?? headerField(line, 'Case\\s*#');
    out.quote_date = out.quote_date ?? headerField(line, 'Quote\\s+Date');
    out.revision = out.revision ?? headerField(line, 'Revision');
  }

  if (!out.quote_number) out.warnings.push('quote_number_missing');
  if (out.line_items.length === 0) out.warnings.push('no_line_items');
  const t = out.totals;
  if (t.subtotal_cents === null || t.total_cents === null) out.warnings.push('totals_missing');
  let sum = 0;
  for (const li of out.line_items) {
    if (li.unit_price_cents !== null && li.ext_price_cents !== null
      && li.qty * li.unit_price_cents !== li.ext_price_cents) {
      out.warnings.push(`line_ext_mismatch:${li.line_no}`);
    }
    sum += li.ext_price_cents ?? 0;
  }
  if (t.subtotal_cents !== null && sum !== t.subtotal_cents) {
    out.warnings.push('subtotal_mismatch');
  }
  if (t.subtotal_cents !== null && t.total_cents !== null
    && t.subtotal_cents + (t.tax_cents ?? 0) !== t.total_cents) {
    out.warnings.push('total_mismatch');
  }
  if (out.ship_to.length > 0 && out.ship_to.join('\n') !== out.sold_to.join('\n')) {
    out.warnings.push('ship_to_differs_from_sold_to');
  }
  if (clientContacts.length > 0) {
    if (findClientContactLeak([out.sold_to.join('\n')], clientContacts)) {
      out.warnings.push('client_contact_leakage:sold_to');
      out.contact_leakage = true;
    }
    if (findClientContactLeak([out.ship_to.join('\n')], clientContacts)) {
      out.warnings.push('client_contact_leakage:ship_to');
      out.contact_leakage = true;
    }
  }
  return out;
}

export function validateVendorQuoteParse(params: Record<string, unknown>): ParamsValidation {
  const parsed = parseWith(VendorQuoteParseParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p: VendorQuoteParseParams = parsed.data;
  return {
    ok: true,
    canonical: {
      kind: 'vendor.quote.parse',
      project_id: p.project_id,
      source: p.source,
      text_sha256: sha256Canonical(p.quote_text),
    },
    binding: {
      project_id: p.project_id, document_hash: p.source.sha256,
      amount: null, recipient: null,
    },
  };
}
