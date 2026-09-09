// Order chain - Supabase adapters (Phase 5 SAFE unit).
//
// Same idiom as lib/business/business-store.ts: RLS-bound injected
// client, every write validates first, unique-key collisions are
// idempotent no-ops, state transitions are compare-and-set on the
// prior state, reads fail closed. This module persists STATE only. It
// never calls a provider, never sends anything, never deletes a row,
// and contains no path that moves money or places an order. The
// 'placed_by_owner' transition records an action the owner took
// outside this system and is accepted only from a human actor.

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import { UUID_RE } from '../types';
import { isHumanActor, isIsoTimestamp, type Actor } from './actor';
import {
  applyContractEvent as transitionContract,
  type ContractEvent,
  type ContractRecord,
} from './contract-state';
import {
  approveMeasurement as approveMeasurementPure,
  type FinalMeasurement,
} from './final-measure';
import { isSha256 } from './hash';
import {
  ORDER_PREDICATES,
  type OrderReadinessCheck,
} from './order-eligibility';
import {
  applyPaymentEvent as applyPaymentPure,
  type PaymentExpectation,
  type PaymentLedger,
  type PaymentReceiptEvent,
} from './payment-state';
import type {
  PoPackageState,
  PurchaseOrderPackage,
} from './po-preparation';
import { validatePurchaseOrderPackage } from './po-preparation';

export const ORDER_CHAIN_TABLES = {
  templates: 'contract_templates',
  contracts: 'contracts',
  providerEvents: 'contract_provider_events',
  expectations: 'payment_expectations',
  receiptEvents: 'payment_receipt_events',
  measurements: 'final_measurements',
  changeOrders: 'change_orders',
  readinessChecks: 'order_readiness_checks',
  poPackages: 'purchase_order_packages',
} as const;

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

function failed(e: unknown, fallback: string): WriteOutcome {
  return { ok: false, error: e instanceof Error ? e.message : fallback };
}

async function insertRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(table).insert(row).select('id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: String(row.id ?? '') };
      }
      return { ok: false, error: `${table} insert failed: ${res.error.message}` };
    }
    const id = res.data?.[0]?.['id'];
    return { ok: true, id: id ? String(id) : String(row.id ?? '') };
  } catch (e) {
    return failed(e, `${table} insert failed`);
  }
}

// Compare-and-set update: every guard in `where` must still hold.
// Zero matched rows = the prior state changed elsewhere (or the row
// does not exist); the caller never retries blindly.
async function casUpdate(
  client: RuntimeClient,
  table: string,
  patch: Record<string, unknown>,
  where: Array<[string, string]>,
): Promise<WriteOutcome> {
  try {
    const [first, ...rest] = where;
    let chain = client.from(table).update(patch).eq(first[0], first[1]);
    for (const [col, val] of rest) chain = chain.eq(col, val);
    const res: QueryResult = await chain.select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'state_changed_elsewhere' };
    }
    return { ok: true, id: String(res.data[0]['id'] ?? '') };
  } catch (e) {
    return failed(e, `${table} update failed`);
  }
}

// --- contracts -------------------------------------------------------------

export async function insertContract(
  client: RuntimeClient,
  contract: ContractRecord,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(contract.id)) return { ok: false, error: 'invalid contract id' };
  if (!UUID_RE.test(contract.project_id)) {
    return { ok: false, error: 'invalid project id' };
  }
  if (!UUID_RE.test(contract.template_id)) {
    return { ok: false, error: 'invalid template id' };
  }
  if (!UUID_RE.test(contract.quote_version_id)) {
    return { ok: false, error: 'invalid quote version id' };
  }
  if (!isSha256(contract.template_sha256)) {
    return { ok: false, error: 'invalid template sha256' };
  }
  if (contract.provider !== 'docusign') {
    return { ok: false, error: 'unsupported provider' };
  }
  if (contract.state !== 'drafted') {
    return { ok: false, error: 'new contracts start drafted' };
  }
  if (contract.payload_hash !== '' && !isSha256(contract.payload_hash)) {
    return { ok: false, error: 'invalid payload hash' };
  }
  if (!Array.isArray(contract.included_forms) ||
      contract.included_forms.some((form) => typeof form !== 'string' || !form.trim())) {
    return { ok: false, error: 'invalid included forms' };
  }
  return insertRow(client, ORDER_CHAIN_TABLES.contracts, {
    id: contract.id,
    project_id: contract.project_id,
    quote_version_id: contract.quote_version_id,
    template_id: contract.template_id,
    template_sha256: contract.template_sha256,
    provider: contract.provider,
    provider_envelope_id: contract.provider_envelope_id,
    state: 'drafted',
    signed_at: null,
    provider_event_verified: false,
    payload_hash: contract.payload_hash ?? '',
    included_forms: contract.included_forms,
    created_at: nowIso,
    updated_at: nowIso,
  });
}

export interface ContractEventOutcome extends WriteOutcome {
  contract: ContractRecord;
  refused?: string;
}

// Records the provider event (unique on provider_event_id: a replayed
// webhook is a duplicate no-op and NEVER re-drives a transition), then
// applies the pure state machine and CAS-updates the contract row on
// its prior state. Evidence is kept even when the transition is refused.
export async function applyContractEvent(
  client: RuntimeClient,
  contract: ContractRecord,
  event: ContractEvent,
  nowIso: string,
): Promise<ContractEventOutcome> {
  if (!UUID_RE.test(contract.id)) {
    return { ok: false, error: 'invalid contract id', contract };
  }
  if (event.type === 'provider_event') {
    const evidence = await insertRow(client, ORDER_CHAIN_TABLES.providerEvents, {
      contract_id: contract.id,
      provider_event_id: event.provider_event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      payload: { provider_envelope_id: event.provider_envelope_id },
      verified: event.provider_event_verified === true,
      received_at: nowIso,
    });
    if (!evidence.ok) return { ...evidence, contract };
    if (evidence.duplicate) {
      return {
        ok: true,
        duplicate: true,
        id: contract.id,
        contract,
        refused: 'duplicate_provider_event',
      };
    }
  }
  const t = transitionContract(contract, event);
  if (!t.ok) return { ok: false, error: t.reason, refused: t.reason, contract };
  const next = t.contract;
  const cas = await casUpdate(
    client,
    ORDER_CHAIN_TABLES.contracts,
    {
      state: next.state,
      provider_envelope_id: next.provider_envelope_id,
      signed_at: next.signed_at,
      provider_event_verified: next.provider_event_verified,
      updated_at: nowIso,
    },
    [
      ['id', contract.id],
      ['state', contract.state],
    ],
  );
  if (!cas.ok) return { ...cas, contract };
  return { ok: true, id: contract.id, contract: next };
}

// --- payment expectations --------------------------------------------------

function validExpectation(e: PaymentExpectation): string | null {
  if (!UUID_RE.test(e.project_id)) return 'invalid project id';
  if (!UUID_RE.test(e.contract_id)) return 'invalid contract id';
  if (!UUID_RE.test(e.quote_version_id)) return 'invalid quote version id';
  if (!Number.isSafeInteger(e.expected_amount_cents) || e.expected_amount_cents < 0) {
    return 'invalid expected amount';
  }
  if (!Number.isSafeInteger(e.received_cents) || e.received_cents < 0) {
    return 'invalid received amount';
  }
  if (!isSha256(e.quote_hash)) {
    return 'quote hash required';
  }
  return null;
}

// Insert-or-update keyed on (contract_id, milestone). The update path
// is guarded on the same key, so a row for another contract can never
// be touched. Expected amounts and bindings are immutable after insert:
// only state, received_cents, and reconciliation_state change.
export async function upsertExpectation(
  client: RuntimeClient,
  e: PaymentExpectation,
  nowIso: string,
): Promise<WriteOutcome> {
  const invalid = validExpectation(e);
  if (invalid) return { ok: false, error: invalid };
  const inserted = await insertRow(client, ORDER_CHAIN_TABLES.expectations, {
    project_id: e.project_id,
    contract_id: e.contract_id,
    quote_version_id: e.quote_version_id,
    plan_type: e.plan_type,
    milestone: e.milestone,
    sequence: e.sequence,
    expected_amount_cents: e.expected_amount_cents,
    contract_amount_cents: e.contract_amount_cents,
    quote_hash: e.quote_hash,
    state: e.state,
    received_cents: e.received_cents,
    reconciliation_state: e.reconciliation_state,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (!inserted.ok || !inserted.duplicate) return inserted;
  return casUpdate(
    client,
    ORDER_CHAIN_TABLES.expectations,
    {
      state: e.state,
      received_cents: e.received_cents,
      reconciliation_state: e.reconciliation_state,
      updated_at: nowIso,
    },
    [
      ['contract_id', e.contract_id],
      ['milestone', e.milestone],
      ['quote_hash', e.quote_hash],
      ['expected_amount_cents', String(e.expected_amount_cents)],
    ],
  );
}

export interface RecordPaymentReceiptOutcome extends WriteOutcome {
  ledger: PaymentLedger;
}

const RECEIPT_BINDING_FIELDS = [
  'project_id', 'contract_id', 'quote_version_id', 'milestone', 'quote_hash',
  'expected_amount_cents', 'amount_cents', 'idempotency_key', 'occurred_at',
  'recorded_by', 'source_ref',
] as const;

async function readMatchingReceipt(
  client: RuntimeClient,
  event: PaymentReceiptEvent,
): Promise<boolean> {
  try {
    const res = await client.from(ORDER_CHAIN_TABLES.receiptEvents)
      .select('*').eq('idempotency_key', event.idempotency_key).limit(1);
    if (res.error || !res.data || res.data.length !== 1) return false;
    const stored = res.data[0];
    return RECEIPT_BINDING_FIELDS.every((field) => {
      const expected = event[field];
      const actual = stored[field];
      return typeof expected === 'number'
        ? String(actual) === String(expected)
        : actual === expected;
    });
  } catch {
    return false;
  }
}

// Append the fully bound receipt fact. No money moves and no existing event is
// updated. A duplicate key is a durable replay no-op; callers reconstruct the
// materialized ledger with rebuildPaymentLedger after restart.
export async function recordPaymentReceipt(
  client: RuntimeClient,
  ledger: PaymentLedger,
  event: PaymentReceiptEvent,
): Promise<RecordPaymentReceiptOutcome> {
  const applied = applyPaymentPure(ledger, event);
  if (!applied.ok && applied.reason !== 'duplicate_event') {
    return { ok: false, error: applied.reason, ledger };
  }
  if (!isIsoTimestamp(event.occurred_at) ||
      typeof event.recorded_by !== 'string' || !event.recorded_by.trim() ||
      typeof event.source_ref !== 'string' || !event.source_ref.trim()) {
    return { ok: false, error: 'invalid receipt evidence', ledger };
  }
  const stored = await insertRow(client, ORDER_CHAIN_TABLES.receiptEvents, {
    project_id: event.project_id,
    contract_id: event.contract_id,
    quote_version_id: event.quote_version_id,
    milestone: event.milestone,
    quote_hash: event.quote_hash,
    expected_amount_cents: event.expected_amount_cents,
    amount_cents: event.amount_cents,
    idempotency_key: event.idempotency_key,
    occurred_at: event.occurred_at,
    recorded_by: event.recorded_by,
    source_ref: event.source_ref,
  });
  if (!stored.ok) return { ...stored, ledger };
  if (stored.duplicate) {
    if (!(await readMatchingReceipt(client, event))) {
      return { ok: false, error: 'duplicate_receipt_binding_mismatch', ledger };
    }
    return { ...stored, ok: true, duplicate: true, ledger };
  }
  if (!applied.ok) {
    return { ...stored, ok: true, duplicate: true, ledger };
  }
  return { ...stored, ledger: applied.ledger };
}

// --- final measurements ----------------------------------------------------

export async function insertMeasurement(
  client: RuntimeClient,
  m: FinalMeasurement,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(m.project_id)) return { ok: false, error: 'invalid project id' };
  if (!UUID_RE.test(m.contract_id)) return { ok: false, error: 'invalid contract id' };
  if (!isSha256(m.sha256)) return { ok: false, error: 'invalid sha256' };
  if (m.status === 'approved') {
    return { ok: false, error: 'measurements are never inserted approved' };
  }
  if (!Array.isArray(m.openings) || m.openings.length === 0) {
    return { ok: false, error: 'openings required' };
  }
  return insertRow(client, ORDER_CHAIN_TABLES.measurements, {
    ...(m.id && UUID_RE.test(m.id) ? { id: m.id } : {}),
    project_id: m.project_id,
    contract_id: m.contract_id,
    version: m.version,
    source: m.source,
    measured_at: m.measured_at,
    measured_by: m.measured_by,
    openings: m.openings,
    sha256: m.sha256,
    approved_by: null,
    approved_at: null,
    status: m.status,
    supersedes_id: m.supersedes_id,
    created_at: nowIso,
  });
}

export interface MeasurementApprovalOutcome extends WriteOutcome {
  measurement: FinalMeasurement;
}

// Human actor only (enforced by the pure approve); CAS on
// status = 'submitted' AND the exact sha256 so a re-measured row can
// never be approved under a stale approval.
export async function approveMeasurement(
  client: RuntimeClient,
  m: FinalMeasurement,
  actor: Actor,
  approvedAt: string,
  signedAt: string,
): Promise<MeasurementApprovalOutcome> {
  if (!m.id || !UUID_RE.test(m.id)) {
    return { ok: false, error: 'invalid measurement id', measurement: m };
  }
  const approved = approveMeasurementPure(m, actor, approvedAt, signedAt);
  if (!approved.ok) return { ok: false, error: approved.reason, measurement: m };
  const next = approved.measurement;
  const cas = await casUpdate(
    client,
    ORDER_CHAIN_TABLES.measurements,
    {
      status: 'approved',
      approved_by: next.approved_by,
      approved_at: next.approved_at,
    },
    [
      ['id', m.id],
      ['status', 'submitted'],
      ['sha256', m.sha256],
      ['source', 'final_measure'],
    ],
  );
  if (!cas.ok) return { ...cas, measurement: m };
  return { ok: true, id: m.id, measurement: next };
}

// --- readiness checks (append-only) ----------------------------------------

export async function insertReadinessCheck(
  client: RuntimeClient,
  check: OrderReadinessCheck,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(check.project_id)) {
    return { ok: false, error: 'invalid project id' };
  }
  if (!isIsoTimestamp(check.evaluated_at)) {
    return { ok: false, error: 'invalid evaluated_at' };
  }
  const keys = Object.keys(check.predicates ?? {}).sort();
  const expected = [...ORDER_PREDICATES].sort();
  if (keys.length !== expected.length ||
      keys.some((key, index) => key !== expected[index])) {
    return { ok: false, error: 'predicate_set_invalid' };
  }
  for (const name of ORDER_PREDICATES) {
    const result = check.predicates[name];
    if (!result || typeof result.ok !== 'boolean' ||
        typeof result.reason !== 'string' || !result.reason.trim()) {
      return { ok: false, error: `predicate_invalid:${name}` };
    }
  }
  const blocked = Object.entries(check.predicates)
    .filter(([, r]) => !r.ok)
    .map(([name]) => name);
  // Never trust the caller's all_ok: recompute from the predicates.
  const allOk = blocked.length === 0;
  return insertRow(client, ORDER_CHAIN_TABLES.readinessChecks, {
    project_id: check.project_id,
    evaluated_at: check.evaluated_at,
    predicates: check.predicates,
    all_ok: allOk,
    po_hash: allOk && isSha256(check.po_hash) ? check.po_hash : null,
    blocked_by: blocked,
  });
}

// --- purchase order packages -----------------------------------------------

export async function insertPoPackage(
  client: RuntimeClient,
  pkg: PurchaseOrderPackage,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(pkg.project_id)) return { ok: false, error: 'invalid project id' };
  if (!UUID_RE.test(pkg.contract_id)) return { ok: false, error: 'invalid contract id' };
  if (!UUID_RE.test(pkg.measurement_id)) {
    return { ok: false, error: 'invalid measurement id' };
  }
  if (!isSha256(pkg.po_hash) || !isSha256(pkg.configuration_hash)) {
    return { ok: false, error: 'invalid hash' };
  }
  const integrity = validatePurchaseOrderPackage(pkg);
  if (!integrity.ok) return { ok: false, error: integrity.reason };
  if (pkg.state !== 'prepared') {
    return { ok: false, error: 'packages are inserted prepared only' };
  }
  return insertRow(client, ORDER_CHAIN_TABLES.poPackages, {
    project_id: pkg.project_id,
    contract_id: pkg.contract_id,
    measurement_id: pkg.measurement_id,
    measurement_sha256: pkg.measurement_sha256,
    measurement_version: pkg.measurement_version,
    template_sha256: pkg.template_sha256,
    configuration_hash: pkg.configuration_hash,
    po_hash: pkg.po_hash,
    document_id: pkg.document_id,
    vendor: pkg.vendor,
    product_line: pkg.product_line,
    line_items: pkg.line_items,
    sold_to: pkg.sold_to,
    ship_to: pkg.ship_to,
    state: 'prepared',
    prepared_at: pkg.prepared_at,
    approved_by: null,
    approved_at: null,
    approval_evidence_hash: null,
    document_sha256: pkg.document.sha256,
    placed_at: null,
    updated_at: nowIso,
  });
}

const PO_TRANSITIONS: Record<PoPackageState, PoPackageState[]> = {
  prepared: ['owner_review', 'cancelled'],
  owner_review: ['cancelled'],
  approved_for_placement: ['cancelled'],
  placed_by_owner: [],
  cancelled: [],
};

export interface PoTransitionInput {
  package_id: string;
  from: PoPackageState;
  to: PoPackageState;
  actor: Actor;
  at: string;
}

// CAS state transition. approved_for_placement and placed_by_owner
// require a HUMAN actor; placed_by_owner additionally stamps placed_at
// (the DB CHECK refuses the row otherwise). This records an owner
// action; it does not perform one.
export async function transitionPoPackage(
  client: RuntimeClient,
  input: PoTransitionInput,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(input.package_id)) return { ok: false, error: 'invalid package id' };
  if (!isIsoTimestamp(input.at)) return { ok: false, error: 'invalid timestamp' };
  const allowed = PO_TRANSITIONS[input.from];
  if (!allowed || !allowed.includes(input.to)) {
    return { ok: false, error: 'invalid_transition' };
  }
  const patch: Record<string, unknown> = { state: input.to, updated_at: input.at };
  if (input.to === 'approved_for_placement' || input.to === 'placed_by_owner') {
    if (!isHumanActor(input.actor)) {
      return { ok: false, error: 'human_actor_required' };
    }
    if (input.to === 'approved_for_placement') patch.approved_by = input.actor.id;
    if (input.to === 'placed_by_owner') patch.placed_at = input.at;
  }
  return casUpdate(client, ORDER_CHAIN_TABLES.poPackages, patch, [
    ['id', input.package_id],
    ['state', input.from],
  ]);
}
