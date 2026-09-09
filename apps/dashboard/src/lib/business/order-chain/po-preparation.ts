// Order chain - purchase order PACKAGE preparation (Phase 5 SAFE unit).
//
// Pure, deterministic. Builds the public.purchase_order_packages row
// shape (migration 0032) from an APPROVED final measurement only, with
// Preston's own contact block as sold-to / ship-to. THERE IS NO
// FUNCTION IN THIS MODULE (OR THIS DIRECTORY) THAT PLACES, SENDS, OR
// TRANSMITS A PURCHASE ORDER. The package is a document descriptor the
// owner reviews; approving it for placement requires a human actor and
// a freshly re-evaluated eligibility check.

import { isHumanActor, isIsoTimestamp, type Actor } from './actor';
import { findContactLeaks, isPrestonEmail, type ClientContactFacts }
  from './contact-guard';
import type { ContractRecord } from './contract-state';
import {
  estimateDimensionsCannotFeedPo,
  type FinalMeasurement,
} from './final-measure';
import { computePoHash, hashCanonical, isSha256 } from './hash';
import {
  evaluateOrderEligibility,
  type OrderEligibilityFacts,
  type OrderReadinessCheck,
} from './order-eligibility';

export type PoPackageState =
  | 'prepared'
  | 'owner_review'
  | 'approved_for_placement'
  | 'placed_by_owner'
  | 'cancelled';

export interface PrestonContactBlock {
  company: string;
  attention: string;
  email: string;
  phone: string;
  address_lines: string[];
}

export interface ConfigurationLine {
  opening_id: string;
  product_code: string;
  options: Record<string, string>;
}

export interface PoConfiguration {
  vendor: string;
  product_line: string;
  lines: ConfigurationLine[];
}

export interface PoLineItem {
  position: number;
  opening_id: string;
  width_in: number;
  height_in: number;
  unit_type: string;
  product_code: string;
  options: Record<string, string>;
  quantity: 1;
}

export interface PoDocumentDescriptor {
  document_type: 'purchase_order';
  canonical_filename: string;
  mime_type: 'application/json';
  sha256: string;
}

export interface PurchaseOrderPackage {
  project_id: string;
  contract_id: string;
  measurement_id: string;
  measurement_sha256: string;
  measurement_version: number;
  template_sha256: string;
  configuration_hash: string;
  po_hash: string;
  document_id: string | null;
  document: PoDocumentDescriptor;
  vendor: string;
  product_line: string;
  line_items: PoLineItem[];
  sold_to: PrestonContactBlock;
  ship_to: PrestonContactBlock;
  state: PoPackageState;
  prepared_at: string;
  approved_by: string | null;
  placed_at: string | null;
}

export interface PreparePoInput {
  project_id: string;
  contract: ContractRecord;
  current_template_sha256: string | null;
  measurement: FinalMeasurement;
  configuration: PoConfiguration;
  sold_to: PrestonContactBlock;
  ship_to: PrestonContactBlock;
  client_contact: ClientContactFacts;
  prepared_at: string;
}

export type PreparePoOutcome =
  | { ok: true; package: PurchaseOrderPackage }
  | { ok: false; reason: string; detail?: string[] };

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Configuration hash: vendor + product line + per-opening product
// choices, canonical order. Sizes are NOT part of the configuration
// hash; they are bound separately through the measurement sha256.
export function configurationHash(config: PoConfiguration): string {
  return hashCanonical({
    vendor: config.vendor,
    product_line: config.product_line,
    lines: [...config.lines]
      .sort((a, b) => (a.opening_id < b.opening_id ? -1 : 1))
      .map((l) => ({
        opening_id: l.opening_id,
        product_code: l.product_code,
        options: l.options,
      })),
  });
}

function validateContactBlock(
  block: PrestonContactBlock | null | undefined,
  label: string,
): string[] {
  const errors: string[] = [];
  if (!block) return [`${label}.missing`];
  if (!nonEmpty(block.company)) errors.push(`${label}.company`);
  if (!nonEmpty(block.email) || !isPrestonEmail(block.email)) {
    errors.push(`${label}.email_not_preston`);
  }
  if (!nonEmpty(block.phone)) errors.push(`${label}.phone`);
  if (!Array.isArray(block.address_lines) || block.address_lines.length === 0) {
    errors.push(`${label}.address_lines`);
  }
  return errors;
}

export function preparePurchaseOrderPackage(
  input: PreparePoInput,
): PreparePoOutcome {
  const { contract, measurement, configuration } = input;
  if (!nonEmpty(input.project_id)) return { ok: false, reason: 'project_required' };
  if (!isIsoTimestamp(input.prepared_at)) {
    return { ok: false, reason: 'prepared_at_invalid' };
  }
  if (!contract || contract.project_id !== input.project_id) {
    return { ok: false, reason: 'contract_binding_mismatch' };
  }
  if (contract.state !== 'completed' || !contract.provider_event_verified) {
    return { ok: false, reason: 'contract_not_signed' };
  }
  if (
    !nonEmpty(input.current_template_sha256) ||
    contract.template_sha256 !== input.current_template_sha256
  ) {
    return { ok: false, reason: 'stale_contract' };
  }
  const feed = estimateDimensionsCannotFeedPo(measurement);
  if (!feed.ok) return { ok: false, reason: feed.reason };
  if (
    measurement.project_id !== input.project_id ||
    measurement.contract_id !== contract.id
  ) {
    return { ok: false, reason: 'measurement_binding_mismatch' };
  }
  if (!nonEmpty(measurement.id)) {
    return { ok: false, reason: 'measurement_unpersisted' };
  }
  if (!configuration || !nonEmpty(configuration.vendor)) {
    return { ok: false, reason: 'vendor_required' };
  }
  if (!nonEmpty(configuration.product_line)) {
    return { ok: false, reason: 'product_line_required' };
  }
  const contactErrors = [
    ...validateContactBlock(input.sold_to, 'sold_to'),
    ...validateContactBlock(input.ship_to, 'ship_to'),
  ];
  if (contactErrors.length > 0) {
    return { ok: false, reason: 'contact_block_invalid', detail: contactErrors };
  }

  // Line items: one per approved opening, joined with its configured
  // product choice. Every opening needs a line and every line needs an
  // opening; anything else is a configuration/measurement mismatch.
  const lineByOpening = new Map<string, ConfigurationLine>();
  for (const line of configuration.lines ?? []) {
    if (!nonEmpty(line.opening_id) || !nonEmpty(line.product_code)) {
      return { ok: false, reason: 'configuration_line_invalid' };
    }
    if (lineByOpening.has(line.opening_id)) {
      return { ok: false, reason: 'configuration_line_duplicate' };
    }
    lineByOpening.set(line.opening_id, line);
  }
  const openings = [...measurement.openings].sort((a, b) =>
    a.opening_id < b.opening_id ? -1 : 1,
  );
  const missing = openings
    .filter((o) => !lineByOpening.has(o.opening_id))
    .map((o) => o.opening_id);
  const extra = [...lineByOpening.keys()].filter(
    (id) => !openings.some((o) => o.opening_id === id),
  );
  if (missing.length > 0 || extra.length > 0) {
    return {
      ok: false,
      reason: 'configuration_measurement_mismatch',
      detail: [...missing.map((m) => `missing:${m}`), ...extra.map((e) => `extra:${e}`)],
    };
  }
  const lineItems: PoLineItem[] = openings.map((o, i) => {
    const line = lineByOpening.get(o.opening_id) as ConfigurationLine;
    return {
      position: i + 1,
      opening_id: o.opening_id,
      width_in: o.width_in,
      height_in: o.height_in,
      unit_type: o.unit_type,
      product_code: line.product_code,
      options: { ...line.options },
      quantity: 1,
    };
  });

  const configHash = configurationHash(configuration);
  const poHash = computePoHash({
    measurement_sha256: measurement.sha256,
    configuration_hash: configHash,
    template_sha256: contract.template_sha256,
  });
  if (poHash === null) return { ok: false, reason: 'binding_unhashable' };

  const body = {
    project_id: input.project_id,
    contract_id: contract.id,
    measurement_id: measurement.id,
    measurement_sha256: measurement.sha256,
    configuration_hash: configHash,
    template_sha256: contract.template_sha256,
    po_hash: poHash,
    vendor: configuration.vendor,
    product_line: configuration.product_line,
    line_items: lineItems,
    sold_to: input.sold_to,
    ship_to: input.ship_to,
  };
  // Contact leak guard runs over the WHOLE vendor-facing body,
  // including notes and option strings.
  const leaks = findContactLeaks(body, input.client_contact);
  if (leaks.length > 0) {
    return { ok: false, reason: 'contact_leak', detail: leaks };
  }
  const vendorSlug = configuration.vendor.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const pkg: PurchaseOrderPackage = {
    ...body,
    measurement_id: measurement.id as string,
    measurement_version: measurement.version,
    document_id: null,
    document: {
      document_type: 'purchase_order',
      canonical_filename:
        `PO_${input.project_id}_${vendorSlug}_m${measurement.version}` +
        `_${poHash.slice(0, 12)}.json`,
      mime_type: 'application/json',
      sha256: hashCanonical(body),
    },
    state: 'prepared',
    prepared_at: input.prepared_at,
    approved_by: null,
    placed_at: null,
  };
  return { ok: true, package: pkg };
}

export type ApproveForPlacementOutcome =
  | { ok: true; package: PurchaseOrderPackage; check: OrderReadinessCheck }
  | {
      ok: false;
      reason: 'human_actor_required' | 'invalid_state' | 'eligibility_blocked'
        | 'approved_at_invalid';
      blocked_by?: string[];
      check?: OrderReadinessCheck;
    };

// Approving for placement: HUMAN actor only, from prepared/owner_review,
// and the eligibility gate is RE-EVALUATED here from the supplied facts
// with the package's own po_hash substituted in - a caller cannot pass a
// pre-approved check. The result is still only a state; the owner places
// the order outside this system.
export function approveForPlacement(
  pkg: PurchaseOrderPackage,
  facts: OrderEligibilityFacts,
  actor: Actor,
  approvedAt: string,
): ApproveForPlacementOutcome {
  if (!isHumanActor(actor)) return { ok: false, reason: 'human_actor_required' };
  if (!isIsoTimestamp(approvedAt)) {
    return { ok: false, reason: 'approved_at_invalid' };
  }
  if (pkg.state !== 'prepared' && pkg.state !== 'owner_review') {
    return { ok: false, reason: 'invalid_state' };
  }
  const check = evaluateOrderEligibility({
    ...facts,
    project_id: pkg.project_id,
    po_hash: isSha256(pkg.po_hash) ? pkg.po_hash : null,
    configuration_hash: pkg.configuration_hash,
    vendor_material: pkg,
  });
  if (!check.all_ok) {
    return {
      ok: false,
      reason: 'eligibility_blocked',
      blocked_by: check.blocked_by,
      check,
    };
  }
  return {
    ok: true,
    check,
    package: { ...pkg, state: 'approved_for_placement', approved_by: actor.id },
  };
}
