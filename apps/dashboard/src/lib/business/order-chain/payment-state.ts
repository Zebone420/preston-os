// Order chain - payment expectation state (Phase 5 SAFE unit).
//
// Pure, deterministic, integer cents. Mirrors public.payment_expectations
// (migration 0032). This module records what is EXPECTED and what has
// been RECORDED as received. It never moves money in any direction:
// there is no collection path and no money-return path. An over-payment
// is recorded as a reconciliation MISMATCH for the owner to resolve by
// hand; the code neither corrects nor returns anything.
//
// Percentages are NOT re-implemented here. buildPaymentSchedule from the
// quote engine is the single source of the 50/25/25 (installation) and
// 75/25 (product-only) stage math, including the remainder-to-final
// rounding rule (owner ruling V1; context/payment_schedule.md).
//
// Milestone naming (context/payment_schedule.md gives the fractions by
// job type; the milestone labels are the engineering encoding of those
// stages):
//   installation_50_25_25: deposit (50) -> pre_install (25) -> final (25)
//   product_only_75_25:    pre_order (75) -> final (25)
// The ORDER GATE requires: deposit received for installation jobs, and
// pre_order received for product-only jobs.
//
// Every payment event binds project_id, contract_id, milestone,
// quote_hash and the expected amount (plan section 11). Any binding
// that does not match is refused with NO state change.

import { buildPaymentSchedule } from '../quote-engine';
import { isMoneyCents, type PaymentScheduleType } from '../types';
import { isHumanActor, isIsoTimestamp, type Actor } from './actor';
import { isSha256 } from './hash';

export type PlanType = PaymentScheduleType;

export type PaymentMilestone =
  | 'deposit'
  | 'pre_install'
  | 'final'
  | 'pre_order';

export type ExpectationState =
  | 'expected'
  | 'partially_received'
  | 'received'
  | 'waived_by_owner'
  | 'overdue';

export type ReconciliationState =
  | 'unreconciled'
  | 'reconciled'
  | 'mismatch';

export interface PaymentExpectation {
  project_id: string;
  contract_id: string;
  quote_version_id: string;
  plan_type: PlanType;
  milestone: PaymentMilestone;
  sequence: number;
  expected_amount_cents: number;
  contract_amount_cents: number;
  quote_hash: string;
  state: ExpectationState;
  received_cents: number;
  reconciliation_state: ReconciliationState;
}

// The in-memory ledger: expectations plus the idempotency keys already
// applied, so a replayed event is a no-op. (In the DB the unique key on
// payment_events.idempotency_key plays the same role.)
export interface PaymentLedger {
  project_id: string;
  contract_id: string;
  quote_version_id: string;
  plan_type: PlanType;
  contract_amount_cents: number;
  quote_hash: string;
  expectations: PaymentExpectation[];
  applied_event_keys: string[];
}

export interface PaymentBinding {
  project_id: string;
  contract_id: string;
}

export interface AuthoritativeQuoteBinding {
  quote_version_id: string;
  quote_hash: string;
  total_cents: number;
}

const MILESTONES_BY_PLAN: Record<PlanType, PaymentMilestone[]> = {
  installation_50_25_25: ['deposit', 'pre_install', 'final'],
  product_only_75_25: ['pre_order', 'final'],
};

// The milestone whose receipt satisfies the order gate's payment
// condition for a plan type.
export function orderPaymentMilestone(plan: PlanType): PaymentMilestone {
  return plan === 'installation_50_25_25' ? 'deposit' : 'pre_order';
}

export function isPlanType(value: unknown): value is PlanType {
  return (
    value === 'installation_50_25_25' || value === 'product_only_75_25'
  );
}

export function buildExpectations(
  planType: PlanType,
  quote: AuthoritativeQuoteBinding,
  binding: PaymentBinding,
): PaymentLedger {
  if (!isPlanType(planType)) {
    throw new Error('payment-state: unknown plan type');
  }
  if (!quote || !isMoneyCents(quote.total_cents)) {
    throw new Error('payment-state: contract amount out of bounds');
  }
  if (!isSha256(quote.quote_hash)) {
    throw new Error('payment-state: quote hash required');
  }
  if (typeof quote.quote_version_id !== 'string' || !quote.quote_version_id.trim()) {
    throw new Error('payment-state: quote version required');
  }
  if (typeof binding?.project_id !== 'string' || !binding.project_id.trim() ||
      typeof binding.contract_id !== 'string' || !binding.contract_id.trim()) {
    throw new Error('payment-state: project and contract binding required');
  }
  const contractAmountCents = quote.total_cents;
  const quoteHash = quote.quote_hash;
  const scope =
    planType === 'installation_50_25_25' ? 'installation' : 'product_only';
  const plan = buildPaymentSchedule(scope, contractAmountCents);
  const milestones = MILESTONES_BY_PLAN[planType];
  if (plan.stages.length !== milestones.length) {
    throw new Error('payment-state: stage/milestone count drift');
  }
  const expectations = plan.stages.map((stage, i) => ({
    project_id: binding.project_id,
    contract_id: binding.contract_id,
    quote_version_id: quote.quote_version_id,
    plan_type: planType,
    milestone: milestones[i],
    sequence: i + 1,
    expected_amount_cents: stage.amount_cents,
    contract_amount_cents: contractAmountCents,
    quote_hash: quoteHash,
    state: 'expected' as ExpectationState,
    received_cents: 0,
    reconciliation_state: 'unreconciled' as ReconciliationState,
  }));
  return {
    project_id: binding.project_id,
    contract_id: binding.contract_id,
    quote_version_id: quote.quote_version_id,
    plan_type: planType,
    contract_amount_cents: contractAmountCents,
    quote_hash: quoteHash,
    expectations,
    applied_event_keys: [],
  };
}

export interface PaymentEventInput {
  amount_cents: number;
  project_id: string;
  contract_id: string;
  quote_version_id: string;
  milestone: PaymentMilestone;
  quote_hash: string;
  expected_amount_cents: number;
  idempotency_key: string;
}

export interface PaymentReceiptEvent extends PaymentEventInput {
  occurred_at: string;
  recorded_by: string;
  source_ref: string;
}

export type PaymentRefusal =
  | 'binding_mismatch'
  | 'duplicate_event'
  | 'invalid_amount'
  | 'invalid_event'
  | 'milestone_closed';

export type PaymentApplication =
  | { ok: true; ledger: PaymentLedger; expectation: PaymentExpectation }
  | { ok: false; reason: PaymentRefusal; ledger: PaymentLedger };

// Apply one recorded payment event to the ledger. Returns a NEW ledger;
// the input is never mutated. Refusals carry the unchanged ledger.
export function applyPaymentEvent(
  ledger: PaymentLedger,
  event: PaymentEventInput,
): PaymentApplication {
  if (
    typeof event.idempotency_key !== 'string' ||
    event.idempotency_key.length === 0
  ) {
    return { ok: false, reason: 'invalid_event', ledger };
  }
  if (ledger.applied_event_keys.includes(event.idempotency_key)) {
    return { ok: false, reason: 'duplicate_event', ledger };
  }
  if (!isMoneyCents(event.amount_cents) || event.amount_cents === 0) {
    return { ok: false, reason: 'invalid_amount', ledger };
  }
  const expectation = ledger.expectations.find(
    (e) => e.milestone === event.milestone,
  );
  if (
    !expectation ||
    event.project_id !== ledger.project_id ||
    event.contract_id !== ledger.contract_id ||
    event.quote_version_id !== ledger.quote_version_id ||
    event.quote_hash !== ledger.quote_hash ||
    event.expected_amount_cents !== expectation.expected_amount_cents
  ) {
    return { ok: false, reason: 'binding_mismatch', ledger };
  }
  if (
    expectation.state === 'waived_by_owner' ||
    expectation.reconciliation_state === 'mismatch'
  ) {
    // Owner-resolved or owner-pending milestones accept no further
    // automatic changes; the owner reconciles by hand.
    return { ok: false, reason: 'milestone_closed', ledger };
  }
  const received = expectation.received_cents + event.amount_cents;
  let state: ExpectationState;
  let reconciliation: ReconciliationState;
  if (received < expectation.expected_amount_cents) {
    state = 'partially_received';
    reconciliation = 'unreconciled';
  } else if (received === expectation.expected_amount_cents) {
    state = 'received';
    reconciliation = 'reconciled';
  } else {
    // Over-payment: recorded exactly as received, flagged mismatch.
    // Nothing is returned automatically; the owner decides.
    state = 'received';
    reconciliation = 'mismatch';
  }
  const next: PaymentExpectation = {
    ...expectation,
    received_cents: received,
    state,
    reconciliation_state: reconciliation,
  };
  return {
    ok: true,
    expectation: next,
    ledger: {
      ...ledger,
      expectations: ledger.expectations.map((e) =>
        e.milestone === next.milestone ? next : e,
      ),
      applied_event_keys: [
        ...ledger.applied_event_keys,
        event.idempotency_key,
      ],
    },
  };
}

export type PaymentReplay =
  | { ok: true; ledger: PaymentLedger }
  | { ok: false; reason: string; ledger: PaymentLedger };

// Rebuild the derived ledger from append-only durable receipt facts. Ordering
// is deterministic. Exact duplicate keys are one event; the same key with a
// different payload is a conflict and the replay fails closed.
export function rebuildPaymentLedger(
  base: PaymentLedger,
  events: PaymentReceiptEvent[],
): PaymentReplay {
  const unique = new Map<string, PaymentReceiptEvent>();
  for (const event of events) {
    if (!isIsoTimestamp(event.occurred_at) ||
        typeof event.recorded_by !== 'string' || !event.recorded_by.trim() ||
        typeof event.source_ref !== 'string' || !event.source_ref.trim()) {
      return { ok: false, reason: 'invalid_receipt_evidence', ledger: base };
    }
    const prior = unique.get(event.idempotency_key);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(event)) {
        return { ok: false, reason: 'event_replay_conflict', ledger: base };
      }
      continue;
    }
    unique.set(event.idempotency_key, event);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at) ||
    a.idempotency_key.localeCompare(b.idempotency_key));
  let ledger: PaymentLedger = {
    ...base, expectations: base.expectations.map((e) => ({ ...e })),
    applied_event_keys: [] };
  for (const event of ordered) {
    const applied = applyPaymentEvent(ledger, event);
    if (!applied.ok) return { ok: false, reason: applied.reason, ledger };
    ledger = applied.ledger;
  }
  return { ok: true, ledger };
}

// Owner waiver: an explicit human decision that a milestone is not
// required (for example a credit applied outside this system).
export type WaiveOutcome =
  | { ok: true; ledger: PaymentLedger }
  | { ok: false; reason: 'human_actor_required' | 'unknown_milestone' };

export function waiveExpectationByOwner(
  ledger: PaymentLedger,
  milestone: PaymentMilestone,
  actor: Actor,
): WaiveOutcome {
  if (!isHumanActor(actor)) {
    return { ok: false, reason: 'human_actor_required' };
  }
  const target = ledger.expectations.find((e) => e.milestone === milestone);
  if (!target) return { ok: false, reason: 'unknown_milestone' };
  const next: PaymentExpectation = {
    ...target,
    state: 'waived_by_owner',
    reconciliation_state: 'reconciled',
  };
  return {
    ok: true,
    ledger: {
      ...ledger,
      expectations: ledger.expectations.map((e) =>
        e.milestone === milestone ? next : e,
      ),
    },
  };
}

export type PaymentCondition =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'milestone_missing'
        | 'not_received'
        | 'reconciliation_mismatch'
        | 'unreconciled';
    };

// The payment condition for a milestone is met only when the
// milestone is received (or explicitly waived by the owner) AND
// reconciled. Partial receipt, over-payment mismatch, and unreconciled
// receipts all fail closed.
export function paymentConditionMet(
  ledger: PaymentLedger | null | undefined,
  milestone: PaymentMilestone,
): PaymentCondition {
  const e = ledger?.expectations.find((x) => x.milestone === milestone);
  if (!e) return { ok: false, reason: 'milestone_missing' };
  if (e.state !== 'received' && e.state !== 'waived_by_owner') {
    return { ok: false, reason: 'not_received' };
  }
  if (e.reconciliation_state === 'mismatch') {
    return { ok: false, reason: 'reconciliation_mismatch' };
  }
  if (e.reconciliation_state !== 'reconciled') {
    return { ok: false, reason: 'unreconciled' };
  }
  return { ok: true };
}
