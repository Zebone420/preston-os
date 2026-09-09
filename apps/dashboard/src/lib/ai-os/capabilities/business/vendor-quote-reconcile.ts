// Preston AI OS - Phase 3 vendor.quote.reconcile. PURE, deterministic.
// Compares a parsed vendor quote (Home Depot etc.) against the REQUESTED
// spec (IQ+ / NQR / manual) line by line: SKU, quantity, size and every
// requested option key=value. ANY mismatch => 'reconciliation_failed' with
// itemized diffs (owner rule: Home Depot / IQ+ outputs require
// reconciliation; no PO on an unreconciled quote).

import type { ParamsValidation } from '../registry';
import { sha256Canonical } from '../contract';
import {
  VendorQuoteReconcileParamsSchema,
  parseWith,
  type VendorQuoteReconcileParams,
} from './schemas';

export type ReconcileDiffKind =
  | 'missing_line'
  | 'extra_line'
  | 'sku_mismatch'
  | 'qty_mismatch'
  | 'size_mismatch'
  | 'option_mismatch'
  | 'option_missing';

export interface ReconcileDiff {
  line_no: number;
  kind: ReconcileDiffKind;
  key: string | null;
  expected: string | null;
  actual: string | null;
}

export interface ReconcileReport {
  result: 'reconciled' | 'reconciliation_failed';
  compared_lines: number;
  diffs: ReconcileDiff[];
}

const SKU_KEYS = ['sku', 'unit', 'item', 'model'];
const SIZE_KEYS = ['size', 'dimensions'];

export function normalizeValue(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseSize(v: string): { width: number; height: number } | null {
  const m = /^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

function specSku(spec: Record<string, string>): string | null {
  for (const k of SKU_KEYS) if (spec[k]) return spec[k];
  return null;
}

function specSize(spec: Record<string, string>): string | null {
  for (const k of SIZE_KEYS) if (spec[k]) return spec[k];
  return null;
}

export function reconcileVendorQuote(
  vendor: VendorQuoteReconcileParams['vendor_quote'],
  spec: VendorQuoteReconcileParams['requested_spec'],
): ReconcileReport {
  const diffs: ReconcileDiff[] = [];
  const vendorByLine = new Map(vendor.line_items.map((l) => [l.line_no, l]));
  const requestedLines = new Set(spec.lines.map((l) => l.line_no));
  const sortedSpec = [...spec.lines].sort((a, b) => a.line_no - b.line_no);
  let compared = 0;
  for (const req of sortedSpec) {
    const v = vendorByLine.get(req.line_no);
    if (!v) {
      diffs.push({ line_no: req.line_no, kind: 'missing_line', key: null,
        expected: req.sku, actual: null });
      continue;
    }
    compared++;
    const vSku = specSku(v.spec);
    if (normalizeValue(vSku) !== normalizeValue(req.sku)) {
      diffs.push({ line_no: req.line_no, kind: 'sku_mismatch', key: null,
        expected: req.sku, actual: vSku });
    }
    if (v.qty !== req.qty) {
      diffs.push({ line_no: req.line_no, kind: 'qty_mismatch', key: null,
        expected: String(req.qty), actual: String(v.qty) });
    }
    if (req.size) {
      const vs = specSize(v.spec);
      const parsed = vs ? parseSize(vs) : null;
      const same = parsed !== null
        && parsed.width === req.size.width && parsed.height === req.size.height;
      if (!same) {
        diffs.push({ line_no: req.line_no, kind: 'size_mismatch', key: null,
          expected: `${req.size.width} x ${req.size.height}`, actual: vs });
      }
    }
    for (const key of Object.keys(req.options).sort()) {
      const k = key.toLowerCase();
      if (!(k in v.spec)) {
        diffs.push({ line_no: req.line_no, kind: 'option_missing', key: k,
          expected: req.options[key], actual: null });
      } else if (normalizeValue(v.spec[k]) !== normalizeValue(req.options[key])) {
        diffs.push({ line_no: req.line_no, kind: 'option_mismatch', key: k,
          expected: req.options[key], actual: v.spec[k] });
      }
    }
  }
  for (const v of [...vendor.line_items].sort((a, b) => a.line_no - b.line_no)) {
    if (!requestedLines.has(v.line_no)) {
      diffs.push({ line_no: v.line_no, kind: 'extra_line', key: null,
        expected: null, actual: specSku(v.spec) });
    }
  }
  return {
    result: diffs.length === 0 ? 'reconciled' : 'reconciliation_failed',
    compared_lines: compared,
    diffs,
  };
}

export function validateVendorQuoteReconcile(
  params: Record<string, unknown>,
): ParamsValidation {
  const parsed = parseWith(VendorQuoteReconcileParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p = parsed.data;
  const specHash = sha256Canonical(p.requested_spec);
  return {
    ok: true,
    canonical: {
      kind: 'vendor.quote.reconcile',
      project_id: p.project_id,
      quote_number: p.vendor_quote.quote_number,
      spec_id: p.requested_spec.spec_id,
      spec_version: p.requested_spec.version,
      spec_sha256: specHash,
    },
    binding: {
      project_id: p.project_id, document_hash: specHash, amount: null, recipient: null,
    },
  };
}
