import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  applyContractEvent,
  approveMeasurement,
  insertContract,
  insertMeasurement,
  insertPoPackage,
  insertReadinessCheck,
  ORDER_CHAIN_TABLES,
  recordPaymentReceipt,
  transitionPoPackage,
  upsertExpectation,
} from '../src/lib/business/order-chain/store';
import { evaluateOrderEligibility }
  from '../src/lib/business/order-chain/order-eligibility';
import { preparePurchaseOrderPackage }
  from '../src/lib/business/order-chain/po-preparation';
import type { ProviderEvent }
  from '../src/lib/business/order-chain/contract-state';
import type { PaymentReceiptEvent }
  from '../src/lib/business/order-chain/payment-state';
import {
  AGENT,
  allPassFacts,
  approvedMeasurement,
  CLIENT_CONTACT,
  completedContract,
  currentTemplate,
  configuration,
  CONTRACT_ID,
  draftedContract,
  MEASUREMENT_ID,
  NOW,
  OWNER,
  paidDepositLedger,
  PRESTON_BLOCK,
  PROJECT_ID,
  RUNTIME,
  SIGNED_AT,
} from './order-chain-fixtures';

// ---------------------------------------------------------------------------
// In-memory fake Supabase client honoring the 0032 unique keys and the
// store's compare-and-set update chain (update().eq()...eq().select()).
// Records every operation so the suite can assert that NO delete and NO
// unguarded update ever happens.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const UNIQUE_KEYS: Record<string, string[][]> = {
  contracts: [['id'], ['provider_envelope_id']],
  contract_provider_events: [['provider_event_id']],
  payment_expectations: [['contract_id', 'milestone']],
  payment_receipt_events: [['idempotency_key']],
  final_measurements: [['project_id', 'version']],
  purchase_order_packages: [['po_hash']],
};

interface FakeDb {
  client: RuntimeClient;
  rows(table: string): Row[];
  ops: string[];
}

function makeFakeDb(): FakeDb {
  const tables = new Map<string, Row[]>();
  const ops: string[] = [];
  let next = 1;
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const dup = { data: null, error: { message: 'duplicate key value' } };
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Row) {
          return {
            select() {
              ops.push(`insert:${table}`);
              const rows = rowsOf(table);
              for (const keys of UNIQUE_KEYS[table] ?? []) {
                const clash = rows.find((r) =>
                  keys.every((k) => r[k] !== undefined && r[k] !== null
                    && r[k] === row[k]));
                if (clash) return Promise.resolve(dup);
              }
              const id = row.id ?? `00000000-0000-4000-9000-${String(next++)
                .padStart(12, '0')}`;
              const stored = { ...row, id };
              rows.push(stored);
              return Promise.resolve({ data: [{ id }], error: null });
            },
          };
        },
        select() {
          throw new Error('select not used by the order-chain store');
        },
        update(patch: Row) {
          const guards: Array<[string, string]> = [];
          const chain = {
            eq(col: string, val: string) {
              guards.push([col, val]);
              return chain;
            },
            lte() { return chain; },
            gt() { return chain; },
            select() {
              ops.push(`update:${table}:${guards.map((g) => g[0]).join('+')}`);
              if (guards.length === 0) throw new Error('unguarded update');
              const matched = rowsOf(table).filter((r) =>
                guards.every(([c, v]) => String(r[c]) === v));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({
                data: matched.map((r) => ({ id: r.id })),
                error: null,
              });
            },
          };
          return { eq: chain.eq };
        },
      };
    },
  };
  return { client, rows: rowsOf, ops };
}

function completedEvent(id = 'evt-1'): ProviderEvent {
  return {
    type: 'provider_event',
    provider_event_id: id,
    event_type: 'envelope-completed',
    provider_envelope_id: 'env-001',
    provider_event_verified: true,
    occurred_at: SIGNED_AT,
  };
}

describe('order-chain store - contracts', () => {
  it('inserts a drafted contract and refuses non-drafted or malformed rows', async () => {
    const db = makeFakeDb();
    const r = await insertContract(db.client, draftedContract(), NOW);
    expect(r.ok).toBe(true);
    expect(db.rows('contracts')[0]).toMatchObject({
      state: 'drafted', provider_event_verified: false, signed_at: null,
    });
    const again = await insertContract(db.client, draftedContract(), NOW);
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect((await insertContract(db.client, completedContract(), NOW)).ok).toBe(false);
    expect((await insertContract(db.client,
      { ...draftedContract(), id: 'nope' }, NOW)).ok).toBe(false);
    expect((await insertContract(db.client,
      { ...draftedContract(), template_sha256: 'x' }, NOW)).ok).toBe(false);
  });

  it('drives sent -> completed via a verified event with CAS and evidence', async () => {
    const db = makeFakeDb();
    await insertContract(db.client, draftedContract(), NOW);
    const sent = await applyContractEvent(db.client, draftedContract(),
      { type: 'mark_sent', provider_envelope_id: 'env-001', at: NOW }, NOW);
    expect(sent.ok).toBe(true);
    expect(sent.contract.state).toBe('sent');
    const done = await applyContractEvent(db.client, sent.contract,
      completedEvent(), NOW);
    expect(done.ok).toBe(true);
    expect(done.contract.state).toBe('completed');
    expect(db.rows('contracts')[0]).toMatchObject({
      state: 'completed', provider_event_verified: true, signed_at: SIGNED_AT,
    });
    expect(db.rows('contract_provider_events')).toHaveLength(1);
    expect(db.ops.filter((o) => o.startsWith('update:contracts')))
      .toEqual(['update:contracts:id+state', 'update:contracts:id+state']);
  });

  it('a replayed webhook is an idempotent no-op that never re-transitions', async () => {
    const db = makeFakeDb();
    await insertContract(db.client, draftedContract(), NOW);
    const sent = await applyContractEvent(db.client, draftedContract(),
      { type: 'mark_sent', provider_envelope_id: 'env-001', at: NOW }, NOW);
    const first = await applyContractEvent(db.client, sent.contract,
      completedEvent(), NOW);
    expect(first.ok).toBe(true);
    const updates = db.ops.length;
    const replay = await applyContractEvent(db.client, sent.contract,
      completedEvent(), NOW);
    expect(replay).toMatchObject({ ok: true, duplicate: true,
      refused: 'duplicate_provider_event' });
    expect(replay.contract).toEqual(sent.contract);
    expect(db.ops.slice(updates)).toEqual(['insert:contract_provider_events']);
    expect(db.rows('contract_provider_events')).toHaveLength(1);
  });

  it('an unverified event is kept as evidence but refused for state', async () => {
    const db = makeFakeDb();
    await insertContract(db.client, draftedContract(), NOW);
    const sent = await applyContractEvent(db.client, draftedContract(),
      { type: 'mark_sent', provider_envelope_id: 'env-001', at: NOW }, NOW);
    const r = await applyContractEvent(db.client, sent.contract,
      { ...completedEvent('evt-u'), provider_event_verified: false }, NOW);
    expect(r.ok).toBe(false);
    expect(r.refused).toBe('provider_event_unverified');
    expect(db.rows('contract_provider_events')[0]).toMatchObject({ verified: false });
    expect(db.rows('contracts')[0].state).toBe('sent');
  });

  it('CAS fails when the row moved elsewhere', async () => {
    const db = makeFakeDb();
    await insertContract(db.client, draftedContract(), NOW);
    db.rows('contracts')[0].state = 'voided';
    const r = await applyContractEvent(db.client, draftedContract(),
      { type: 'mark_sent', provider_envelope_id: 'env-001', at: NOW }, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('state_changed_elsewhere');
  });
});

describe('order-chain store - expectations, measurements, checks, packages', () => {
  it('upsertExpectation inserts then updates on the (contract, milestone) key', async () => {
    const db = makeFakeDb();
    const ledger = paidDepositLedger();
    for (const e of ledger.expectations) {
      expect((await upsertExpectation(db.client, e, NOW)).ok).toBe(true);
    }
    expect(db.rows('payment_expectations')).toHaveLength(3);
    const deposit = { ...ledger.expectations[0], received_cents: 462719 };
    const r = await upsertExpectation(db.client, deposit, NOW);
    expect(r.ok).toBe(true);
    expect(db.rows('payment_expectations')).toHaveLength(3);
    expect(db.rows('payment_expectations')[0]).toMatchObject({
      milestone: 'deposit', state: 'received', received_cents: 462719,
    });
    expect(db.ops.at(-1)).toBe(
      'update:payment_expectations:contract_id+milestone+quote_hash+expected_amount_cents',
    );
    // A drifted expected amount cannot update the stored row.
    const drift = { ...deposit, expected_amount_cents: 1 };
    expect((await upsertExpectation(db.client, drift, NOW)).ok).toBe(false);
    expect((await upsertExpectation(db.client,
      { ...deposit, received_cents: -1 }, NOW)).ok).toBe(false);
  });

  it('records fully bound receipt evidence once and replay is a no-op', async () => {
    const db = makeFakeDb();
    const ledger = paidDepositLedger();
    const base = { ...ledger, expectations: ledger.expectations.map((e) => ({
      ...e, state: 'expected' as const, received_cents: 0,
      reconciliation_state: 'unreconciled' as const,
    })), applied_event_keys: [] };
    const expected = base.expectations[0];
    const event: PaymentReceiptEvent = {
      project_id: base.project_id, contract_id: base.contract_id,
      quote_version_id: base.quote_version_id, milestone: 'deposit',
      quote_hash: base.quote_hash,
      expected_amount_cents: expected.expected_amount_cents,
      amount_cents: expected.expected_amount_cents,
      idempotency_key: 'durable-receipt-1', occurred_at: NOW,
      recorded_by: OWNER.id, source_ref: 'staging-receipt-1',
    };
    const first = await recordPaymentReceipt(db.client, base, event);
    expect(first.ok).toBe(true);
    expect(first.ledger.applied_event_keys).toEqual(['durable-receipt-1']);
    expect(db.rows('payment_receipt_events')[0]).toMatchObject(event);
    const replay = await recordPaymentReceipt(db.client, base, event);
    expect(replay).toMatchObject({ ok: true, duplicate: true, ledger: base });
    expect(db.rows('payment_receipt_events')).toHaveLength(1);
  });

  it('measurements are never inserted approved; approval is CAS on submitted', async () => {
    const db = makeFakeDb();
    const approved = approvedMeasurement();
    expect((await insertMeasurement(db.client, approved, NOW)).ok).toBe(false);
    const submitted = { ...approved, status: 'submitted' as const,
      approved_by: null, approved_at: null };
    expect((await insertMeasurement(db.client, submitted, NOW)).ok).toBe(true);
    expect(db.rows('final_measurements')[0]).toMatchObject({
      id: MEASUREMENT_ID, status: 'submitted', approved_by: null,
    });
    const byRuntime = await approveMeasurement(
      db.client, submitted, RUNTIME, NOW, SIGNED_AT);
    expect(byRuntime.ok).toBe(false);
    expect(byRuntime.error).toBe('human_actor_required');
    const byOwner = await approveMeasurement(
      db.client, submitted, OWNER, NOW, SIGNED_AT);
    expect(byOwner.ok).toBe(true);
    expect(byOwner.measurement.status).toBe('approved');
    expect(db.rows('final_measurements')[0]).toMatchObject({
      status: 'approved', approved_by: 'owner-1', approved_at: NOW,
    });
    expect(db.ops.at(-1)).toBe('update:final_measurements:id+status+sha256+source');
    // Second approval finds no submitted row: CAS refuses.
    const twice = await approveMeasurement(
      db.client, submitted, OWNER, NOW, SIGNED_AT);
    expect(twice.ok).toBe(false);
    expect(twice.error).toBe('state_changed_elsewhere');
  });

  it('readiness checks are appended with all_ok recomputed, never trusted', async () => {
    const db = makeFakeDb();
    const check = evaluateOrderEligibility(allPassFacts({ change_order_states:
      ['proposed'] }));
    const forged = { ...check, all_ok: true, blocked_by: [] };
    expect((await insertReadinessCheck(db.client, forged)).ok).toBe(true);
    expect(db.rows('order_readiness_checks')[0]).toMatchObject({
      all_ok: false, blocked_by: ['no_open_change_order'], po_hash: null,
    });
    const pass = evaluateOrderEligibility(allPassFacts());
    await insertReadinessCheck(db.client, pass);
    expect(db.rows('order_readiness_checks')[1]).toMatchObject({
      all_ok: true, blocked_by: [], po_hash: pass.po_hash,
    });
    expect(db.rows('order_readiness_checks')).toHaveLength(2);
    expect(db.ops.filter((o) => o.startsWith('update:order_readiness'))).toEqual([]);
    expect((await insertReadinessCheck(db.client,
      { ...pass, predicates: {} as never })).error).toBe('predicate_set_invalid');
    const malformed = { ...pass, predicates: { ...pass.predicates,
      signed_contract: { ok: true, reason: '' } } };
    expect((await insertReadinessCheck(db.client, malformed)).error)
      .toBe('predicate_invalid:signed_contract');
  });

  it('PO packages insert prepared only and transition by CAS with actor rules', async () => {
    const db = makeFakeDb();
    const prepared = preparePurchaseOrderPackage({
      project_id: PROJECT_ID, contract: completedContract(),
      current_template: currentTemplate(),
      measurement: approvedMeasurement(), configuration: configuration(),
      sold_to: PRESTON_BLOCK, ship_to: PRESTON_BLOCK, client_contact: CLIENT_CONTACT,
      prepared_at: NOW,
    });
    if (!prepared.ok) throw new Error('fixture');
    const pkg = prepared.package;
    expect((await insertPoPackage(db.client,
      { ...pkg, state: 'approved_for_placement' }, NOW)).ok).toBe(false);
    const ins = await insertPoPackage(db.client, pkg, NOW);
    expect(ins.ok).toBe(true);
    const id = String(ins.id);
    expect(db.rows('purchase_order_packages')[0]).toMatchObject({
      state: 'prepared', contract_id: CONTRACT_ID, placed_at: null, approved_by: null,
    });
    expect((await insertPoPackage(db.client, pkg, NOW)).duplicate).toBe(true);

    const base = { package_id: id, at: NOW };
    // Generic persistence cannot approve or record placement. Those states
    // require the separate evidence-bound governed path.
    expect((await transitionPoPackage(db.client, { ...base, from: 'prepared',
      to: 'approved_for_placement', actor: RUNTIME })).error).toBe('invalid_transition');
    expect((await transitionPoPackage(db.client, { ...base, from: 'prepared',
      to: 'placed_by_owner', actor: OWNER })).error).toBe('invalid_transition');
    expect((await transitionPoPackage(db.client, { ...base, from: 'prepared',
      to: 'owner_review', actor: AGENT })).ok).toBe(true);
    expect((await transitionPoPackage(db.client, { ...base, from: 'owner_review',
      to: 'approved_for_placement', actor: OWNER })).error).toBe('invalid_transition');
    expect((await transitionPoPackage(db.client, { ...base, from: 'owner_review',
      to: 'cancelled', actor: OWNER })).ok).toBe(true);
    // Stale CAS: the row is no longer in 'prepared'.
    expect((await transitionPoPackage(db.client, { ...base, from: 'prepared',
      to: 'cancelled', actor: OWNER })).error).toBe('state_changed_elsewhere');
    for (const op of db.ops.filter((o) => o.startsWith('update:'))) {
      expect(op).toBe('update:purchase_order_packages:id+state');
    }
  });

  it('never issues a delete and every update is guarded', () => {
    const db = makeFakeDb();
    const client = db.client.from(ORDER_CHAIN_TABLES.contracts) as unknown as Row;
    expect(Object.keys(client).sort()).toEqual(['insert', 'select', 'update']);
    expect('delete' in client).toBe(false);
    expect(Object.values(ORDER_CHAIN_TABLES)).toHaveLength(9);
  });
});
