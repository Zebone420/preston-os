// Owner data-entry form parsing/validation + owner-readable error
// text (Phase 6 staging-operational remediation). Pure functions so
// the validation and wording are unit-testable; server actions call
// these and the store, never the DB directly.

import { LEAD_STAGES, type LeadStage } from './types';

export const MAX_NAME_CHARS = 200;
export const MAX_NOTE_CHARS = 500;

export interface ClientFormInput {
  display_name: string;
  client_type: string;
  primary_email: string;
  primary_phone: string;
  notes: string;
}

export interface LeadFormInput {
  display_name: string;
  stage: string;
  client_id: string;
  lead_source: string;
  owner_next_action: string;
}

export interface PaymentFormInput {
  project_id: string;
  quote_id: string;
  kind: string;
  amount_cents: number | undefined;
  method: string;
  note: string;
}

export type FormValidation =
  | { ok: true }
  | { ok: false; message: string };

const CLIENT_TYPES = new Set([
  'residential',
  'commercial',
  'institution',
  'other',
]);

const PAYMENT_KINDS = new Set([
  'deposit_recorded',
  'payment_recorded',
  'adjustment_recorded',
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateClientForm(
  input: ClientFormInput,
): FormValidation {
  if (!input.display_name.trim()) {
    return { ok: false, message: 'Client name is required.' };
  }
  if (input.display_name.length > MAX_NAME_CHARS) {
    return { ok: false, message: 'Client name is too long.' };
  }
  if (!CLIENT_TYPES.has(input.client_type)) {
    return { ok: false, message: 'Pick a valid client type.' };
  }
  return { ok: true };
}

export function validateLeadForm(input: LeadFormInput): FormValidation {
  if (!input.display_name.trim()) {
    return { ok: false, message: 'Lead name is required.' };
  }
  if (input.display_name.length > MAX_NAME_CHARS) {
    return { ok: false, message: 'Lead name is too long.' };
  }
  if (!LEAD_STAGES.includes(input.stage as LeadStage)) {
    return { ok: false, message: 'Pick a valid pipeline stage.' };
  }
  if (input.client_id && !UUID.test(input.client_id)) {
    return { ok: false, message: 'Client selection is invalid.' };
  }
  return { ok: true };
}

export function validateStageChange(stage: string): FormValidation {
  if (!LEAD_STAGES.includes(stage as LeadStage)) {
    return { ok: false, message: 'Pick a valid pipeline stage.' };
  }
  return { ok: true };
}

export function validatePaymentForm(
  input: PaymentFormInput,
): FormValidation {
  if (!input.project_id && !input.quote_id) {
    return { ok: false, message: 'Pick a project (or quote).' };
  }
  if (input.project_id && !UUID.test(input.project_id)) {
    return { ok: false, message: 'Project selection is invalid.' };
  }
  if (input.quote_id && !UUID.test(input.quote_id)) {
    return { ok: false, message: 'Quote selection is invalid.' };
  }
  if (!PAYMENT_KINDS.has(input.kind)) {
    return { ok: false, message: 'Pick a valid payment kind.' };
  }
  const amt = input.amount_cents;
  if (
    amt === undefined ||
    !Number.isSafeInteger(amt) ||
    Number.isNaN(amt)
  ) {
    return {
      ok: false,
      message: 'Enter the amount in dollars, e.g. 1250 or 1250.50.',
    };
  }
  if (amt === 0) {
    return { ok: false, message: 'Amount cannot be zero.' };
  }
  if (Math.abs(amt) > 50_000_000_000) {
    return { ok: false, message: 'Amount is implausibly large.' };
  }
  if (amt < 0 && input.kind !== 'adjustment_recorded') {
    return {
      ok: false,
      message: 'Negative amounts are adjustments - pick adjustment.',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------
// Owner-readable wording for quote-agent validation codes.
// Machine codes stay in the run record; the form shows these.
// ---------------------------------------------------------------

const CODE_TEXT: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^missing:title$|^title$/, () => 'Add a quote title.'],
  [/^missing:client_id$|^client_id$/, () => 'Pick a client.'],
  [/^client_id_invalid$/, () => 'Client selection is invalid.'],
  [/^missing:scope_type$|^scope_type$/, () => 'Pick a scope.'],
  [
    /^missing:jurisdiction$|^jurisdiction$/,
    () => 'Pick a jurisdiction.',
  ],
  [
    /^jurisdiction_unsupported$/,
    () => 'Only NYC and NJ are supported.',
  ],
  [/^missing:items$|^items$/, () => 'Add at least one line item.'],
  [
    /^(?:missing:)?items\[(\d+)\]\.quantity(?:_invalid)?$/,
    (m) => `Line ${Number(m[1]) + 1}: enter a whole-number quantity.`,
  ],
  [
    /^(?:missing:)?items\[(\d+)\]\.unit_material_cents(?:_invalid)?$/,
    (m) =>
      `Line ${Number(m[1]) + 1}: enter the material price in dollars.`,
  ],
  [
    /^(?:missing:)?items\[(\d+)\]\.unit_labor_cents(?:_invalid)?$/,
    (m) =>
      `Line ${Number(m[1]) + 1}: enter the labor price in dollars ` +
      `(installation scope).`,
  ],
  [
    /^items\[(\d+)\]\.labor_not_allowed_product_only$/,
    (m) =>
      `Line ${Number(m[1]) + 1}: product-only quotes cannot have ` +
      `labor.`,
  ],
  [
    /^items\[(\d+)\]\.line_fees_cents_invalid$/,
    (m) => `Line ${Number(m[1]) + 1}: the fees value is invalid.`,
  ],
  [/^quote_fees_cents_invalid$/, () => 'Quote-level fees are invalid.'],
  [/^markup_mode_invalid$/, () => 'Pick a valid markup mode.'],
  [
    /^missing:markup_value$|^markup_value$|^markup_value_invalid$/,
    () => 'Enter a markup value for the selected markup mode.',
  ],
  [
    /^markup_value_without_mode$/,
    () => 'A markup value needs a markup mode - or clear it.',
  ],
  [
    /^markup_input_mismatch$/,
    () =>
      'Markup value must go in the box matching the selected mode ' +
      '(percent vs fixed $).',
  ],
  [/^too_many_items$/, () => 'Too many line items (max 200).'],
  [
    /^totals_exceed_supported_bounds$/,
    () => 'These numbers exceed the supported quote size.',
  ],
  [/^idempotency_key_required$/, () => 'Resubmit the form.'],
  [/^quote_id_invalid$/, () => 'Existing-quote selection is invalid.'],
  [/^quote_not_found$/, () => 'The selected existing quote was not found.'],
  [
    /^version_conflict$/,
    () =>
      'Another draft claimed this version - reload and try again.',
  ],
  [/^lead_id_invalid$/, () => 'Lead selection is invalid.'],
  [/^property_id_invalid$/, () => 'Property selection is invalid.'],
];

export function humanizeQuoteCode(code: string): string {
  for (const [re, fn] of CODE_TEXT) {
    const m = code.match(re);
    if (m) return fn(m);
  }
  return code; // unknown codes pass through (still shown)
}

export function humanizeQuoteCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    const text = humanizeQuoteCode(code);
    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

// Owner-readable text for recommendation decision outcomes.
export function humanizeRecommendationOutcome(code: string): string {
  const map: Record<string, string> = {
    acknowledged: 'Recommendation acknowledged.',
    dismissed: 'Recommendation dismissed (it will not re-fire).',
    not_in_expected_status:
      'That recommendation was already decided - list refreshed.',
    'invalid recommendation id': 'Invalid recommendation.',
    invalid_status: 'Invalid decision.',
    denied: 'Owner login required.',
    invalid: 'Invalid request.',
  };
  return map[code] ?? `Action failed: ${code}`;
}
