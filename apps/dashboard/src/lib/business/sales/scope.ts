// Phase 4 - scope builder: normalized openings + explicit selections ->
// the EXISTING quote-engine input (quote-engine.ts). PURE.
//
// This module assembles line items; it never prices anything. Unit
// prices arrive as explicit integer-cent inputs (from vendor quote
// reconciliation or the owner) and every total is computed by
// calculateQuote - arithmetic is never authored here or by an LLM.

import { isMoneyCents, isJurisdiction, isScopeType } from '../types';
import type { QuoteEngineInput, QuoteItemInput } from '../quote-engine';
import { unitCount, type OpeningRow } from './openings';

export interface LinePricing {
  unit_material_cents: number;
  unit_labor_cents?: number;
  line_fees_cents?: number;
}

export interface ScopeSelections {
  scope_type: string; // 'installation' | 'product_only' (validated)
  jurisdiction: string; // 'NYC' | 'NJ' (validated)
  product_line: string; // e.g. 'andersen_400' (label only)
  pricing: Record<string, LinePricing>; // by opening_code
  quote_fees_cents?: number;
  markup_mode?: string;
  markup_value?: number;
  exclusions?: string[];
  st124_tracking?: Record<string, unknown>;
}

export interface ScopeLine {
  opening_code: string;
  description: string;
  quantity: number; // joined units count
  unit_type: string;
  width_in: number;
  height_in: number;
  configuration: Record<string, unknown>;
  not_for_po: boolean;
}

export interface ScopeResult {
  ok: boolean;
  lines: ScopeLine[];
  input: QuoteEngineInput | null;
  assumptions: string[];
  exclusions: string[];
  errors: string[];
}

export const ASSUMPTION_ESTIMATE_ONLY = 'openings_estimate_only_not_for_po';
export const ASSUMPTION_CONFIG_INCOMPLETE = 'configuration_incomplete';
export const DEFAULT_EXCLUSIONS: readonly string[] = [
  'permits_and_expediting_unless_listed',
  'structural_repair_discovered_at_install',
  'interior_finish_paint_and_trim_unless_listed',
];

function describe(o: OpeningRow): string {
  const cfg = o.configuration;
  const parts = [
    o.unit_type,
    `${o.width_in}x${o.height_in}in`,
    o.joined_units === 'single' ? null : `${o.joined_units}-joined`,
    cfg.series ? `series ${cfg.series}` : null,
    cfg.glass ? `glass ${cfg.glass}` : null,
    cfg.grille ? `grille ${cfg.grille}` : null,
    cfg.color ? `color ${cfg.color}` : null,
  ].filter((p): p is string => p !== null);
  return `${o.opening_code} ${o.room ?? ''} ${parts.join(', ')}`.replace(/\s+/g, ' ').trim();
}

// Build scope lines and the quote-engine input. Fails closed: any
// opening without explicit pricing, or any malformed cents value, yields
// ok=false and input=null - never a partially priced scope.
export function buildScope(
  openings: OpeningRow[],
  selections: ScopeSelections,
): ScopeResult {
  const errors: string[] = [];
  const assumptions: string[] = [];
  if (!isScopeType(selections.scope_type)) errors.push('scope_type_invalid');
  if (!isJurisdiction(selections.jurisdiction)) errors.push('jurisdiction_invalid');
  if (!Array.isArray(openings) || openings.length === 0) errors.push('openings_missing');
  const lines: ScopeLine[] = [];
  const items: QuoteItemInput[] = [];
  const sorted = [...openings].sort((a, b) =>
    a.opening_code.localeCompare(b.opening_code),
  );
  for (const o of sorted) {
    const p = selections.pricing[o.opening_code];
    if (!p) {
      errors.push(`pricing_missing:${o.opening_code}`);
      continue;
    }
    if (!isMoneyCents(p.unit_material_cents)) {
      errors.push(`unit_material_invalid:${o.opening_code}`);
    }
    if (p.unit_labor_cents !== undefined && !isMoneyCents(p.unit_labor_cents)) {
      errors.push(`unit_labor_invalid:${o.opening_code}`);
    }
    if (p.line_fees_cents !== undefined && !isMoneyCents(p.line_fees_cents)) {
      errors.push(`line_fees_invalid:${o.opening_code}`);
    }
    if (o.not_for_po && !assumptions.includes(ASSUMPTION_ESTIMATE_ONLY)) {
      assumptions.push(ASSUMPTION_ESTIMATE_ONLY);
    }
    if (!o.configuration.series || !o.configuration.glass) {
      assumptions.push(`${ASSUMPTION_CONFIG_INCOMPLETE}:${o.opening_code}`);
    }
    const quantity = unitCount(o.joined_units);
    lines.push({
      opening_code: o.opening_code,
      description: describe(o),
      quantity,
      unit_type: o.unit_type,
      width_in: o.width_in,
      height_in: o.height_in,
      configuration: { ...o.configuration },
      not_for_po: o.not_for_po,
    });
    const item: QuoteItemInput = {
      opening_label: o.opening_code,
      product_line: selections.product_line,
      description: describe(o),
      quantity,
      unit_material_cents: p.unit_material_cents,
    };
    if (selections.scope_type === 'installation') {
      item.unit_labor_cents = p.unit_labor_cents;
    }
    if (p.line_fees_cents !== undefined) item.line_fees_cents = p.line_fees_cents;
    items.push(item);
  }
  const exclusions = [
    ...DEFAULT_EXCLUSIONS,
    ...(selections.exclusions ?? []),
  ].filter((e, i, arr) => arr.indexOf(e) === i);
  if (errors.length > 0) {
    return { ok: false, lines, input: null, assumptions, exclusions, errors };
  }
  const input: QuoteEngineInput = {
    scope_type: selections.scope_type,
    jurisdiction: selections.jurisdiction,
    items,
    exclusions,
  };
  if (selections.quote_fees_cents !== undefined) {
    input.quote_fees_cents = selections.quote_fees_cents;
  }
  if (selections.markup_mode !== undefined) input.markup_mode = selections.markup_mode;
  if (selections.markup_value !== undefined) input.markup_value = selections.markup_value;
  if (selections.st124_tracking !== undefined) {
    input.st124_tracking = selections.st124_tracking;
  }
  return { ok: true, lines, input, assumptions, exclusions, errors: [] };
}
