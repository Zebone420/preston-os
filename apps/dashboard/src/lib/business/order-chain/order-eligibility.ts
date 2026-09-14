// Order chain - order eligibility gate (Phase 5 SAFE unit).
//
// Pure, deterministic. Evaluates the fixed predicate set from
// FINAL_MASTER_BUILD_PLAN v1 PHASE 5 "Compliance/order gate" plus the
// section 19 owner rules (no open change order; client contact absent
// from vendor material). ANY false predicate blocks. Missing facts are
// false (fail closed), never assumed.
//
// Output is exactly the public.order_readiness_checks row shape
// (migration 0032) so every evaluation can be appended as evidence.
// Nothing here places an order; a passing result is a PRECONDITION the
// owner may act on, not an action.

import {
  isSignedContract,
  type ContractRecord,
  type ContractTemplateRecord,
} from './contract-state';
import {
  estimateDimensionsCannotFeedPo,
  canScheduleFinalMeasure,
  isOpenChangeOrderState,
  type FinalMeasurement,
} from './final-measure';
import { computePoHash, isSha256 } from './hash';
import {
  orderPaymentMilestone,
  paymentConditionMet,
  type PaymentLedger,
  type PlanType,
  type AuthoritativeQuoteBinding,
} from './payment-state';
import { findContactLeaks, type ClientContactFacts } from './contact-guard';

export const ORDER_PREDICATES = [
  'signed_contract',
  'payment_condition',
  'final_measure_approved',
  'building_approval_condition',
  'lpc_condition',
  'dob_condition',
  'po_hash_matches_approved_configuration',
  'no_open_change_order',
  'client_contact_absent_from_vendor_material',
] as const;

export type OrderPredicateName = (typeof ORDER_PREDICATES)[number];

export interface PredicateResult {
  ok: boolean;
  reason: string;
}

// External approval conditions (building management, LPC, DOB). Each
// must be stated explicitly: required or not, and if required, approved
// with an evidence reference (document id or similar). Anything else
// fails closed.
export interface ApprovalCondition {
  required: boolean;
  approved: boolean;
  evidence_ref: string | null;
}

export interface OrderEligibilityFacts {
  project_id: string;
  evaluated_at: string;
  contract: ContractRecord | null;
  current_template: ContractTemplateRecord | null;
  authoritative_quote: AuthoritativeQuoteBinding | null;
  plan_type: PlanType | null;
  payment_ledger: PaymentLedger | null;
  measurement: FinalMeasurement | null;
  building_approval: ApprovalCondition | null;
  lpc: ApprovalCondition | null;
  dob: ApprovalCondition | null;
  configuration_hash: string | null;
  po_hash: string | null;
  change_order_states: string[];
  vendor_material: unknown;
  client_contact: ClientContactFacts | null;
}

export interface OrderReadinessCheck {
  project_id: string;
  evaluated_at: string;
  predicates: Record<OrderPredicateName, PredicateResult>;
  all_ok: boolean;
  po_hash: string | null;
  blocked_by: OrderPredicateName[];
}

function pass(): PredicateResult {
  return { ok: true, reason: 'ok' };
}

function fail(reason: string): PredicateResult {
  return { ok: false, reason };
}

function approvalCondition(
  c: ApprovalCondition | null | undefined,
): PredicateResult {
  if (!c || typeof c.required !== 'boolean') return fail('condition_unknown');
  if (c.required === false) return pass();
  if (c.approved !== true) return fail('not_approved');
  if (typeof c.evidence_ref !== 'string' || c.evidence_ref.length === 0) {
    return fail('evidence_missing');
  }
  return pass();
}

function signedContract(f: OrderEligibilityFacts): PredicateResult {
  if (!f.contract) return fail('contract_missing');
  if (f.contract.project_id !== f.project_id) {
    return fail('contract_project_mismatch');
  }
  const check = isSignedContract(f.contract, f.current_template);
  return check.ok ? pass() : fail(check.reason);
}

function paymentCondition(f: OrderEligibilityFacts): PredicateResult {
  if (!f.plan_type) return fail('plan_type_unknown');
  const ledger = f.payment_ledger;
  if (!ledger) return fail('ledger_missing');
  if (
    ledger.project_id !== f.project_id ||
    (f.contract !== null && ledger.contract_id !== f.contract.id) ||
    ledger.plan_type !== f.plan_type
  ) {
    return fail('ledger_binding_mismatch');
  }
  const quote = f.authoritative_quote;
  if (!quote) return fail('authoritative_quote_missing');
  if (!f.contract || f.contract.quote_version_id !== quote.quote_version_id ||
      ledger.quote_version_id !== quote.quote_version_id ||
      ledger.quote_hash !== quote.quote_hash ||
      ledger.contract_amount_cents !== quote.total_cents) {
    return fail('authoritative_quote_mismatch');
  }
  const milestone = orderPaymentMilestone(f.plan_type);
  const check = paymentConditionMet(ledger, milestone);
  return check.ok ? pass() : fail(`${milestone}_${check.reason}`);
}

function finalMeasureApproved(f: OrderEligibilityFacts): PredicateResult {
  const check = estimateDimensionsCannotFeedPo(f.measurement);
  if (!check.ok) return fail(check.reason);
  const m = f.measurement as FinalMeasurement;
  if (m.project_id !== f.project_id) return fail('measurement_project_mismatch');
  if (f.contract && m.contract_id !== f.contract.id) {
    return fail('measurement_contract_mismatch');
  }
  if (!f.contract?.signed_at) return fail('contract_signed_at_missing');
  const timing = canScheduleFinalMeasure(m.measured_at, f.contract.signed_at);
  if (!timing.ok) return fail(`measurement_timing_${timing.reason}`);
  return pass();
}

function poHashMatches(f: OrderEligibilityFacts): PredicateResult {
  if (!isSha256(f.po_hash)) return fail('po_hash_missing');
  if (!f.measurement || f.measurement.status !== 'approved') {
    return fail('measurement_not_approved');
  }
  if (!f.contract) return fail('contract_missing');
  if (!isSha256(f.configuration_hash)) return fail('configuration_hash_missing');
  const expected = computePoHash({
    measurement_sha256: f.measurement.sha256,
    configuration_hash: f.configuration_hash,
    template_sha256: f.contract.template_sha256,
  });
  if (expected === null) return fail('binding_unhashable');
  return expected === f.po_hash ? pass() : fail('po_hash_mismatch');
}

function noOpenChangeOrder(f: OrderEligibilityFacts): PredicateResult {
  if (!Array.isArray(f.change_order_states)) return fail('states_unknown');
  const open = f.change_order_states.filter(isOpenChangeOrderState);
  return open.length === 0 ? pass() : fail(`open_change_orders:${open.length}`);
}

function contactAbsent(f: OrderEligibilityFacts): PredicateResult {
  if (f.vendor_material === null || f.vendor_material === undefined) {
    return fail('vendor_material_missing');
  }
  if (!f.client_contact) return fail('client_contact_facts_missing');
  const leaks = findContactLeaks(f.vendor_material, f.client_contact);
  return leaks.length === 0 ? pass() : fail(`contact_leak:${leaks.join(',')}`);
}

export function evaluateOrderEligibility(
  facts: OrderEligibilityFacts,
): OrderReadinessCheck {
  const predicates: Record<OrderPredicateName, PredicateResult> = {
    signed_contract: signedContract(facts),
    payment_condition: paymentCondition(facts),
    final_measure_approved: finalMeasureApproved(facts),
    building_approval_condition: approvalCondition(facts.building_approval),
    lpc_condition: approvalCondition(facts.lpc),
    dob_condition: approvalCondition(facts.dob),
    po_hash_matches_approved_configuration: poHashMatches(facts),
    no_open_change_order: noOpenChangeOrder(facts),
    client_contact_absent_from_vendor_material: contactAbsent(facts),
  };
  const blocked = ORDER_PREDICATES.filter((n) => !predicates[n].ok);
  return {
    project_id: facts.project_id,
    evaluated_at: facts.evaluated_at,
    predicates,
    all_ok: blocked.length === 0,
    po_hash: isSha256(facts.po_hash) ? facts.po_hash : null,
    blocked_by: blocked,
  };
}
