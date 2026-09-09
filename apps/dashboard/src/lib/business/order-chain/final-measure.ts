// Order chain - final measurement model (Phase 5 SAFE unit).
//
// Pure, deterministic. Mirrors public.final_measurements and
// public.change_orders (migration 0032). Owner rules encoded (plan
// section 19):
//   - final measurement no sooner than 3 BUSINESS days after signing
//     (weekends excluded; public holidays are OUT OF SCOPE here and
//     must be handled by an owner ruling before they are encoded);
//   - no PO before final measure: only an APPROVED, source =
//     'final_measure' measurement may feed a PO. Estimate and intake
//     dimensions are refused regardless of status;
//   - PO uses final measured sizes only; any size difference between
//     versions (EXACT comparison, zero tolerance - a 1/16 inch drift is
//     a change) or any configuration change requires a change order.
//
// Approval requires a HUMAN actor (isHumanActor); the runtime cannot
// approve a measurement.

import { isHumanActor, isIsoTimestamp, type Actor } from './actor';
import { hashCanonical } from './hash';

export type MeasurementStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'superseded';

export type MeasurementSource = 'final_measure' | 'estimate' | 'intake';

export interface OpeningMeasurement {
  opening_id: string;
  width_in: number;
  height_in: number;
  unit_type: string;
  notes?: string;
}

export interface FinalMeasurement {
  id: string | null;
  project_id: string;
  contract_id: string;
  version: number;
  source: MeasurementSource;
  measured_at: string;
  measured_by: string;
  openings: OpeningMeasurement[];
  sha256: string;
  approved_by: string | null;
  approved_at: string | null;
  status: MeasurementStatus;
  supersedes_id: string | null;
}

export const BUSINESS_DAYS_AFTER_SIGNING = 3;
const DAY_MS = 86_400_000;

// Sizes are validated as finite positive numbers with at most 1/16
// inch resolution so comparisons stay exact.
export function isValidInches(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1000 &&
    Number.isInteger(value * 16)
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export type OpeningsValidation =
  | { ok: true; openings: OpeningMeasurement[] }
  | { ok: false; errors: string[] };

export function validateOpenings(input: unknown): OpeningsValidation {
  const errors: string[] = [];
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, errors: ['openings_required'] };
  }
  const seen = new Set<string>();
  const out: OpeningMeasurement[] = [];
  input.forEach((raw, i) => {
    const o = (raw ?? {}) as Partial<OpeningMeasurement>;
    const at = `openings[${i}]`;
    if (!nonEmpty(o.opening_id)) errors.push(`${at}.opening_id`);
    else if (seen.has(o.opening_id)) {
      errors.push(`${at}.opening_id_duplicate`);
    } else seen.add(o.opening_id);
    if (!isValidInches(o.width_in)) errors.push(`${at}.width_in`);
    if (!isValidInches(o.height_in)) errors.push(`${at}.height_in`);
    if (!nonEmpty(o.unit_type)) errors.push(`${at}.unit_type`);
    if (o.notes !== undefined && typeof o.notes !== 'string') {
      errors.push(`${at}.notes`);
    }
    if (errors.length === 0) {
      out.push({
        opening_id: o.opening_id as string,
        width_in: o.width_in as number,
        height_in: o.height_in as number,
        unit_type: o.unit_type as string,
        ...(o.notes !== undefined ? { notes: o.notes } : {}),
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  // Canonical order: by opening_id, so the hash is order-independent.
  out.sort((a, b) => (a.opening_id < b.opening_id ? -1 : 1));
  return { ok: true, openings: out };
}

// The measurement digest binds identity, version, and the measured
// values. Notes are excluded: they are human context, not geometry.
export function measurementSha256(
  m: Pick<
    FinalMeasurement,
    'project_id' | 'contract_id' | 'version' | 'source' | 'openings'
  >,
): string {
  return hashCanonical({
    project_id: m.project_id,
    contract_id: m.contract_id,
    version: m.version,
    source: m.source,
    openings: [...m.openings]
      .sort((a, b) => (a.opening_id < b.opening_id ? -1 : 1))
      .map((o) => ({
        opening_id: o.opening_id,
        width_in: o.width_in,
        height_in: o.height_in,
        unit_type: o.unit_type,
      })),
  });
}

export interface NewMeasurementInput {
  project_id: string;
  contract_id: string;
  measured_at: string;
  measured_by: string;
  signed_at?: string | null;
  openings: unknown;
  source?: MeasurementSource;
  previous?: FinalMeasurement | null;
}

export type NewMeasurementOutcome =
  | { ok: true; measurement: FinalMeasurement }
  | { ok: false; reason: string; errors?: string[] };

export function newMeasurementVersion(
  input: NewMeasurementInput,
): NewMeasurementOutcome {
  if (!nonEmpty(input.project_id) || !nonEmpty(input.contract_id)) {
    return { ok: false, reason: 'binding_required' };
  }
  if (!isIsoTimestamp(input.measured_at)) {
    return { ok: false, reason: 'measured_at_invalid' };
  }
  if (!nonEmpty(input.measured_by)) {
    return { ok: false, reason: 'measured_by_required' };
  }
  const source = input.source ?? 'final_measure';
  if (
    source !== 'final_measure' &&
    source !== 'estimate' &&
    source !== 'intake'
  ) {
    return { ok: false, reason: 'source_invalid' };
  }
  if (source === 'final_measure') {
    const timing = canScheduleFinalMeasure(input.measured_at, input.signed_at ?? '');
    if (!timing.ok) return { ok: false, reason: `measurement_timing_${timing.reason}` };
  }
  const validated = validateOpenings(input.openings);
  if (!validated.ok) {
    return { ok: false, reason: 'openings_invalid', errors: validated.errors };
  }
  const prev = input.previous ?? null;
  if (prev) {
    if (
      prev.project_id !== input.project_id ||
      prev.contract_id !== input.contract_id
    ) {
      return { ok: false, reason: 'previous_binding_mismatch' };
    }
  }
  const version = prev ? prev.version + 1 : 1;
  const base = {
    project_id: input.project_id,
    contract_id: input.contract_id,
    version,
    source,
    openings: validated.openings,
  };
  return {
    ok: true,
    measurement: {
      id: null,
      ...base,
      measured_at: input.measured_at,
      measured_by: input.measured_by,
      sha256: measurementSha256(base),
      approved_by: null,
      approved_at: null,
      status: 'draft',
      supersedes_id: prev ? prev.id : null,
    },
  };
}

export type MeasurementTransition =
  | { ok: true; measurement: FinalMeasurement }
  | { ok: false; reason: string };

export function submitMeasurement(
  m: FinalMeasurement,
): MeasurementTransition {
  if (m.status !== 'draft') return { ok: false, reason: 'not_draft' };
  if (m.sha256 !== measurementSha256(m)) {
    return { ok: false, reason: 'sha256_mismatch' };
  }
  return { ok: true, measurement: { ...m, status: 'submitted' } };
}

// Approval: human actor only; submitted only; final_measure source
// only (an estimate can never become an approved final measurement).
export function approveMeasurement(
  m: FinalMeasurement,
  actor: Actor,
  approvedAt: string,
  signedAt: string,
): MeasurementTransition {
  if (!isHumanActor(actor)) {
    return { ok: false, reason: 'human_actor_required' };
  }
  if (m.status !== 'submitted') {
    return { ok: false, reason: 'not_submitted' };
  }
  if (m.source !== 'final_measure') {
    return { ok: false, reason: 'estimate_source_refused' };
  }
  if (!isIsoTimestamp(approvedAt)) {
    return { ok: false, reason: 'approved_at_invalid' };
  }
  const timing = canScheduleFinalMeasure(m.measured_at, signedAt);
  if (!timing.ok) {
    return { ok: false, reason: `measurement_timing_${timing.reason}` };
  }
  if (m.sha256 !== measurementSha256(m)) {
    return { ok: false, reason: 'sha256_mismatch' };
  }
  return {
    ok: true,
    measurement: {
      ...m,
      status: 'approved',
      approved_by: actor.id,
      approved_at: approvedAt,
    },
  };
}

export function supersedeMeasurement(
  m: FinalMeasurement,
): MeasurementTransition {
  if (m.status === 'superseded') {
    return { ok: false, reason: 'already_superseded' };
  }
  return { ok: true, measurement: { ...m, status: 'superseded' } };
}

// --- 3-business-day rule ---------------------------------------------------

function isWeekendUtc(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

// signedAt + N business days, stepping one calendar day at a time and
// counting only Monday-Friday (UTC calendar). Time of day is preserved,
// so a Friday 10:00 signing yields Wednesday 10:00; a Saturday signing
// counts Mon, Tue, Wed and also yields Wednesday. Returns null for an
// unparseable timestamp (fail closed: callers must block).
export function earliestFinalMeasureDate(
  signedAt: string,
  businessDays: number = BUSINESS_DAYS_AFTER_SIGNING,
): string | null {
  if (!isIsoTimestamp(signedAt)) return null;
  if (!Number.isInteger(businessDays) || businessDays < 0) return null;
  let ms = Date.parse(signedAt);
  let counted = 0;
  while (counted < businessDays) {
    ms += DAY_MS;
    if (!isWeekendUtc(ms)) counted += 1;
  }
  return new Date(ms).toISOString();
}

export type ScheduleCheck =
  | { ok: true; earliest: string }
  | {
      ok: false;
      reason: 'signed_at_invalid' | 'proposed_at_invalid' | 'too_early';
      earliest: string | null;
    };

// proposedAt is the proposed measurement date/time; it must be no
// earlier than the computed earliest date.
export function canScheduleFinalMeasure(
  proposedAt: string,
  signedAt: string,
): ScheduleCheck {
  const earliest = earliestFinalMeasureDate(signedAt);
  if (earliest === null) {
    return { ok: false, reason: 'signed_at_invalid', earliest: null };
  }
  if (!isIsoTimestamp(proposedAt)) {
    return { ok: false, reason: 'proposed_at_invalid', earliest };
  }
  if (Date.parse(proposedAt) < Date.parse(earliest)) {
    return { ok: false, reason: 'too_early', earliest };
  }
  return { ok: true, earliest };
}

// --- PO feed guard ---------------------------------------------------------

export type PoFeedCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'measurement_missing'
        | 'estimate_source_refused'
        | 'measurement_not_approved'
        | 'approval_incomplete'
        | 'sha256_mismatch';
    };

// A PO may only be built from an APPROVED final_measure measurement.
// Estimate and intake dimensions are refused before status is even
// considered, so an approved-looking estimate row still fails.
export function estimateDimensionsCannotFeedPo(
  m: FinalMeasurement | null | undefined,
): PoFeedCheck {
  if (!m) return { ok: false, reason: 'measurement_missing' };
  if (m.source !== 'final_measure') {
    return { ok: false, reason: 'estimate_source_refused' };
  }
  if (m.status !== 'approved') {
    return { ok: false, reason: 'measurement_not_approved' };
  }
  if (!nonEmpty(m.approved_by) || !isIsoTimestamp(m.approved_at)) {
    return { ok: false, reason: 'approval_incomplete' };
  }
  if (m.sha256 !== measurementSha256(m)) {
    return { ok: false, reason: 'sha256_mismatch' };
  }
  return { ok: true };
}

// --- comparison / change orders -------------------------------------------

export type ChangeOrderReason =
  | 'configuration_change'
  | 'size_change'
  | 'material_change'
  | 'scope_change';

export interface OpeningDelta {
  opening_id: string;
  field: 'width_in' | 'height_in' | 'unit_type';
  from: number | string;
  to: number | string;
}

export interface MeasurementDelta {
  size_changes: OpeningDelta[];
  configuration_changes: OpeningDelta[];
  added_openings: string[];
  removed_openings: string[];
  change_order_required: boolean;
  reasons: ChangeOrderReason[];
}

// Exact comparison. Any numeric difference in width/height is a size
// change; a unit_type difference is a configuration change; an added
// or removed opening is a scope change. Notes never count.
export function compareMeasurements(
  prev: Pick<FinalMeasurement, 'openings'>,
  next: Pick<FinalMeasurement, 'openings'>,
): MeasurementDelta {
  const prevMap = new Map(prev.openings.map((o) => [o.opening_id, o]));
  const nextMap = new Map(next.openings.map((o) => [o.opening_id, o]));
  const size: OpeningDelta[] = [];
  const config: OpeningDelta[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const ids = [...new Set([...prevMap.keys(), ...nextMap.keys()])].sort();
  for (const id of ids) {
    const a = prevMap.get(id);
    const b = nextMap.get(id);
    if (!a) {
      added.push(id);
      continue;
    }
    if (!b) {
      removed.push(id);
      continue;
    }
    if (a.width_in !== b.width_in) {
      size.push({
        opening_id: id,
        field: 'width_in',
        from: a.width_in,
        to: b.width_in,
      });
    }
    if (a.height_in !== b.height_in) {
      size.push({
        opening_id: id,
        field: 'height_in',
        from: a.height_in,
        to: b.height_in,
      });
    }
    if (a.unit_type !== b.unit_type) {
      config.push({
        opening_id: id,
        field: 'unit_type',
        from: a.unit_type,
        to: b.unit_type,
      });
    }
  }
  const reasons: ChangeOrderReason[] = [];
  if (size.length > 0) reasons.push('size_change');
  if (config.length > 0) reasons.push('configuration_change');
  if (added.length > 0 || removed.length > 0) reasons.push('scope_change');
  return {
    size_changes: size,
    configuration_changes: config,
    added_openings: added,
    removed_openings: removed,
    change_order_required: reasons.length > 0,
    reasons,
  };
}

export type ChangeOrderState =
  | 'proposed'
  | 'owner_review'
  | 'approved'
  | 'rejected';

export interface ChangeOrderDraft {
  project_id: string;
  contract_id: string;
  reason: ChangeOrderReason;
  from_measurement_id: string | null;
  to_measurement_id: string | null;
  delta: MeasurementDelta;
  state: 'proposed';
}

// Build the change_orders row shape for a delta that requires one.
// The primary reason is the most consequential (scope > material >
// configuration > size). Returns null when no change order is needed.
export function buildChangeOrder(
  prev: FinalMeasurement,
  next: FinalMeasurement,
  delta: MeasurementDelta = compareMeasurements(prev, next),
): ChangeOrderDraft | null {
  if (!delta.change_order_required) return null;
  const order: ChangeOrderReason[] = [
    'scope_change',
    'material_change',
    'configuration_change',
    'size_change',
  ];
  const reason = order.find((r) => delta.reasons.includes(r)) ?? 'size_change';
  return {
    project_id: next.project_id,
    contract_id: next.contract_id,
    reason,
    from_measurement_id: prev.id,
    to_measurement_id: next.id,
    delta,
    state: 'proposed',
  };
}

export function isOpenChangeOrderState(state: unknown): boolean {
  return state === 'proposed' || state === 'owner_review';
}
