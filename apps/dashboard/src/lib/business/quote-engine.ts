// Deterministic quote calculation engine (Phase 6C).
//
// Pure functions only: no clock, no randomness, no I/O, no network.
// Identical input always produces identical output. All money is
// integer cents; all rates are integer milli-percent over the fixed
// RATE_DENOMINATOR (100000). Rounding is round-half-up at exactly
// two points: markup and tax. Payment stages assign the remainder
// to the final stage so stage amounts always sum to the total.
//
// Business-rule ground truth used here:
// - V1 (owner-ruled): installation schedule 50/25/25; product-only
//   75/25.
// - V2 (owner-ruled): NYC tax 8.875 pct (multiplier 1.08875).
// - NJ 6.625 pct: canonical per the Phase 6 master goal; register
//   ruling V5 pending, so every NJ result carries an assumption
//   flag requiring owner confirmation.
// - V4 (markup) is DEFERRED: no default markup is ever applied.
//   Any nonzero markup must be an explicit input and is flagged.
// - V7 (ST-124): tracking fields pass through untouched; the
//   engine never makes a tax-treatment determination.
//
// This engine never sends anything, never touches a database, and
// produces draft numbers only.

import {
  isJurisdiction,
  isMarkupMode,
  isMoneyCents,
  isScopeType,
  MAX_MONEY_CENTS,
  RATE_DENOMINATOR,
  TAX_RATE_MILLI_PCT,
  type Jurisdiction,
  type MarkupMode,
  type PaymentSchedulePlan,
  type PaymentScheduleType,
  type PaymentStage,
  type ScopeType,
} from './types';

export interface QuoteItemInput {
  opening_label?: string;
  product_line?: string;
  description?: string;
  quantity?: number;
  unit_material_cents?: number;
  unit_labor_cents?: number;
  line_fees_cents?: number;
}

export interface QuoteEngineInput {
  scope_type?: string;
  jurisdiction?: string;
  items?: QuoteItemInput[];
  quote_fees_cents?: number;
  markup_mode?: string;
  markup_value?: number;
  st124_tracking?: Record<string, unknown>;
  exclusions?: string[];
}

export interface ComputedQuoteItem {
  position: number;
  opening_label: string;
  product_line: string;
  description: string;
  quantity: number;
  unit_material_cents: number;
  unit_labor_cents: number;
  line_fees_cents: number;
  line_total_cents: number;
  item_flags: string[];
}

export interface QuoteCalculation {
  scope_type: ScopeType;
  jurisdiction: Jurisdiction;
  tax_rate_milli_pct: number;
  items: ComputedQuoteItem[];
  material_cents: number;
  labor_cents: number;
  fees_cents: number;
  markup_mode: MarkupMode;
  markup_value: number;
  markup_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  margin_cents: number;
  payment_schedule: PaymentSchedulePlan;
  assumptions: string[];
  exclusions: string[];
  owner_confirmation_required: true;
  st124_tracking: Record<string, unknown>;
}

export type QuoteValidation =
  | { ok: true; missing_fields: string[] }
  | { ok: false; errors: string[]; missing_fields: string[] };

const MAX_ITEMS = 200;
const MAX_QUANTITY = 10000;
const MAX_MARKUP_MILLI = RATE_DENOMINATOR; // 100 percent ceiling

// Assumption flags (stable identifiers; rendered by the UI).
export const FLAG_MARKUP_UNVERIFIED = 'markup_rule_unverified_v4';
export const FLAG_NJ_TAX_PENDING =
  'nj_tax_rate_pending_register_ruling_v5';
export const FLAG_ST124_TRACKING_ONLY =
  'st124_tracking_only_no_tax_determination';
export const FLAG_MARGIN_EQUALS_MARKUP =
  'margin_equals_markup_no_cost_model';
export const FLAG_SIMULATION_DRAFT = 'simulation_draft_not_a_price';

// Round-half-up integer division of (a * b) / d for non-negative
// safe integers. Validation caps the aggregate quote total at
// MAX_MONEY_CENTS (5e10), so every call site sees a * b at most
// 5e10 * 1e5 = 5e15 < 9.007e15; the in-function guard is a second
// fail-closed layer, not the primary bound.
export function mulDivRoundHalfUp(
  a: number,
  b: number,
  d: number,
): number {
  const product = a * b;
  if (!Number.isSafeInteger(product)) {
    throw new Error('quote-engine: arithmetic bounds exceeded');
  }
  return Math.floor((product + Math.floor(d / 2)) / d);
}

function isCount(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

// Validate the engine-relevant portion of a draft input. Fails
// closed: any missing or malformed material input is an error, and
// the caller must not produce priced output when ok is false.
export function validateQuoteEngineInput(
  input: QuoteEngineInput,
): QuoteValidation {
  const errors: string[] = [];
  const missing: string[] = [];

  if (!isScopeType(input.scope_type)) {
    if (input.scope_type === undefined) missing.push('scope_type');
    else errors.push('scope_type_invalid');
  }
  if (!isJurisdiction(input.jurisdiction)) {
    if (input.jurisdiction === undefined) {
      missing.push('jurisdiction');
    } else {
      // Unknown jurisdictions are rejected outright (fail closed);
      // there is no rate to guess.
      errors.push('jurisdiction_unsupported');
    }
  }

  const items = input.items;
  if (!Array.isArray(items) || items.length === 0) {
    missing.push('items');
  } else if (items.length > MAX_ITEMS) {
    errors.push('too_many_items');
  } else {
    items.forEach((item, i) => {
      const at = `items[${i}]`;
      if (!isCount(item.quantity, MAX_QUANTITY)) {
        if (item.quantity === undefined) {
          missing.push(`${at}.quantity`);
        } else {
          errors.push(`${at}.quantity_invalid`);
        }
      }
      if (!isMoneyCents(item.unit_material_cents)) {
        if (item.unit_material_cents === undefined) {
          missing.push(`${at}.unit_material_cents`);
        } else {
          errors.push(`${at}.unit_material_cents_invalid`);
        }
      }
      if (input.scope_type === 'installation') {
        if (!isMoneyCents(item.unit_labor_cents)) {
          if (item.unit_labor_cents === undefined) {
            missing.push(`${at}.unit_labor_cents`);
          } else {
            errors.push(`${at}.unit_labor_cents_invalid`);
          }
        }
      } else if (input.scope_type === 'product_only') {
        if (
          item.unit_labor_cents !== undefined &&
          item.unit_labor_cents !== 0
        ) {
          errors.push(`${at}.labor_not_allowed_product_only`);
        }
      }
      if (
        item.line_fees_cents !== undefined &&
        !isMoneyCents(item.line_fees_cents)
      ) {
        errors.push(`${at}.line_fees_cents_invalid`);
      }
    });
  }

  if (
    input.quote_fees_cents !== undefined &&
    !isMoneyCents(input.quote_fees_cents)
  ) {
    errors.push('quote_fees_cents_invalid');
  }

  const mode = input.markup_mode ?? 'none';
  if (!isMarkupMode(mode)) {
    errors.push('markup_mode_invalid');
  } else if (mode !== 'none') {
    const v = input.markup_value;
    if (v === undefined) {
      missing.push('markup_value');
    } else if (mode === 'percent_milli') {
      if (!isCount(v, MAX_MARKUP_MILLI)) {
        errors.push('markup_value_invalid');
      }
    } else if (!isMoneyCents(v)) {
      errors.push('markup_value_invalid');
    }
  } else if (
    input.markup_value !== undefined &&
    input.markup_value !== 0
  ) {
    errors.push('markup_value_without_mode');
  }

  // Aggregate bound: per-field checks alone would allow 200 items
  // of 10000 x max-money each, overflowing safe-integer sums. The
  // whole pre-tax base must fit the money bound, checked here so
  // oversized quotes fail as validation (named error), not as an
  // internal engine error.
  if (errors.length === 0 && missing.length === 0) {
    let aggregate = input.quote_fees_cents ?? 0;
    for (const item of input.items ?? []) {
      const qty = item.quantity ?? 0;
      aggregate +=
        qty *
          ((item.unit_material_cents ?? 0) +
            (item.unit_labor_cents ?? 0)) +
        (item.line_fees_cents ?? 0);
      if (
        !Number.isSafeInteger(aggregate) ||
        aggregate > MAX_MONEY_CENTS
      ) {
        errors.push('totals_exceed_supported_bounds');
        break;
      }
    }
    if (
      input.markup_mode === 'fixed_cents' &&
      Number.isSafeInteger(aggregate) &&
      aggregate + (input.markup_value ?? 0) > MAX_MONEY_CENTS
    ) {
      errors.push('totals_exceed_supported_bounds');
    }
  }

  if (errors.length > 0 || missing.length > 0) {
    return { ok: false, errors, missing_fields: missing };
  }
  return { ok: true, missing_fields: [] };
}

export function buildPaymentSchedule(
  scope: ScopeType,
  totalCents: number,
): PaymentSchedulePlan {
  const type: PaymentScheduleType =
    scope === 'installation'
      ? 'installation_50_25_25'
      : 'product_only_75_25';
  const splits: Array<{ label: string; fraction_milli: number }> =
    scope === 'installation'
      ? [
          { label: 'deposit', fraction_milli: 50000 },
          { label: 'before_installation', fraction_milli: 25000 },
          { label: 'at_completion', fraction_milli: 25000 },
        ]
      : [
          { label: 'deposit', fraction_milli: 75000 },
          { label: 'before_delivery_or_release', fraction_milli: 25000 },
        ];
  const stages: PaymentStage[] = [];
  let allocated = 0;
  splits.forEach((s, i) => {
    const last = i === splits.length - 1;
    const amount = last
      ? totalCents - allocated
      : mulDivRoundHalfUp(totalCents, s.fraction_milli, RATE_DENOMINATOR);
    allocated += amount;
    stages.push({ ...s, amount_cents: amount });
  });
  return { schedule_type: type, stages, total_cents: totalCents };
}

// Compute a full quote calculation. Throws only on internal bound
// violations (which validation prevents); callers should validate
// first and treat a throw as failed_error.
export function calculateQuote(
  input: QuoteEngineInput,
): QuoteCalculation {
  const validation = validateQuoteEngineInput(input);
  if (!validation.ok) {
    throw new Error(
      'quote-engine: calculate called with invalid input',
    );
  }
  const scope = input.scope_type as ScopeType;
  const jurisdiction = input.jurisdiction as Jurisdiction;
  const rate = TAX_RATE_MILLI_PCT[jurisdiction];

  const items: ComputedQuoteItem[] = (input.items ?? []).map(
    (item, i) => {
      const quantity = item.quantity ?? 0;
      const unitMaterial = item.unit_material_cents ?? 0;
      const unitLabor =
        scope === 'installation' ? (item.unit_labor_cents ?? 0) : 0;
      const lineFees = item.line_fees_cents ?? 0;
      const lineTotal =
        quantity * unitMaterial + quantity * unitLabor + lineFees;
      return {
        position: i,
        opening_label: item.opening_label ?? '',
        product_line: item.product_line ?? '',
        description: item.description ?? '',
        quantity,
        unit_material_cents: unitMaterial,
        unit_labor_cents: unitLabor,
        line_fees_cents: lineFees,
        line_total_cents: lineTotal,
        item_flags: [],
      };
    },
  );

  const material = items.reduce(
    (sum, it) => sum + it.quantity * it.unit_material_cents,
    0,
  );
  const labor = items.reduce(
    (sum, it) => sum + it.quantity * it.unit_labor_cents,
    0,
  );
  const itemFees = items.reduce(
    (sum, it) => sum + it.line_fees_cents,
    0,
  );
  const fees = (input.quote_fees_cents ?? 0) + itemFees;

  // Internal invariant: per-line totals must reconcile with the
  // aggregates they are shown next to. A mismatch means an engine
  // bug and must never persist.
  const lineTotalSum = items.reduce(
    (sum, it) => sum + it.line_total_cents,
    0,
  );
  if (lineTotalSum !== material + labor + itemFees) {
    throw new Error('quote-engine: line totals do not reconcile');
  }

  const base = material + labor + fees;
  const markupMode = (input.markup_mode ?? 'none') as MarkupMode;
  const markupValue = input.markup_value ?? 0;
  const markup =
    markupMode === 'none'
      ? 0
      : markupMode === 'fixed_cents'
        ? markupValue
        : mulDivRoundHalfUp(base, markupValue, RATE_DENOMINATOR);

  const subtotal = base + markup;
  const tax = mulDivRoundHalfUp(subtotal, rate, RATE_DENOMINATOR);
  const total = subtotal + tax;

  if (!isMoneyCents(total)) {
    throw new Error('quote-engine: total exceeds supported bounds');
  }

  const assumptions: string[] = [FLAG_SIMULATION_DRAFT];
  if (markup > 0) assumptions.push(FLAG_MARKUP_UNVERIFIED);
  if (jurisdiction === 'NJ') assumptions.push(FLAG_NJ_TAX_PENDING);
  const st124 = input.st124_tracking ?? {};
  if (Object.keys(st124).length > 0) {
    assumptions.push(FLAG_ST124_TRACKING_ONLY);
  }
  // Without an owner-ruled cost/markup model (V4 deferred), the
  // projected margin V1 can honestly report is the explicit markup.
  assumptions.push(FLAG_MARGIN_EQUALS_MARKUP);

  return {
    scope_type: scope,
    jurisdiction,
    tax_rate_milli_pct: rate,
    items,
    material_cents: material,
    labor_cents: labor,
    fees_cents: fees,
    markup_mode: markupMode,
    markup_value: markupValue,
    markup_cents: markup,
    subtotal_cents: subtotal,
    tax_cents: tax,
    total_cents: total,
    margin_cents: markup,
    payment_schedule: buildPaymentSchedule(scope, total),
    assumptions,
    exclusions: [...(input.exclusions ?? [])],
    owner_confirmation_required: true,
    st124_tracking: { ...st124 },
  };
}
