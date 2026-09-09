import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPaymentSchedule } from '../src/lib/business/quote-engine';
import {
  applyPaymentEvent,
  buildExpectations,
  orderPaymentMilestone,
  paymentConditionMet,
  waiveExpectationByOwner,
  type PaymentEventInput,
  type PaymentLedger,
} from '../src/lib/business/order-chain/payment-state';
import {
  AGENT,
  CONTRACT_ID,
  CONTRACT_TOTAL,
  OTHER_CONTRACT_ID,
  OTHER_PROJECT_ID,
  OWNER,
  PROJECT_ID,
  QUOTE_HASH,
  QUOTE_VERSION_ID,
} from './order-chain-fixtures';

const BINDING = { project_id: PROJECT_ID, contract_id: CONTRACT_ID };

function installLedger(total = CONTRACT_TOTAL): PaymentLedger {
  return buildExpectations('installation_50_25_25', {
    quote_version_id: QUOTE_VERSION_ID, quote_hash: QUOTE_HASH, total_cents: total,
  }, BINDING);
}

function depositEvent(over: Partial<PaymentEventInput> = {}): PaymentEventInput {
  return {
    amount_cents: 462719,
    project_id: PROJECT_ID,
    contract_id: CONTRACT_ID,
    quote_version_id: QUOTE_VERSION_ID,
    milestone: 'deposit',
    quote_hash: QUOTE_HASH,
    expected_amount_cents: 462719,
    idempotency_key: 'evt-1',
    ...over,
  };
}

describe('payment expectations - schedule math comes from the quote engine', () => {
  it('installation 50/25/25 with the remainder on final (925438)', () => {
    const l = installLedger();
    expect(l.expectations.map((e) => [e.milestone, e.expected_amount_cents]))
      .toEqual([['deposit', 462719], ['pre_install', 231360], ['final', 231359]]);
    expect(l.expectations.map((e) => e.sequence)).toEqual([1, 2, 3]);
    const sum = l.expectations.reduce((a, e) => a + e.expected_amount_cents, 0);
    expect(sum).toBe(CONTRACT_TOTAL);
    // Identical to the engine's own stage amounts, cent for cent.
    const engine = buildPaymentSchedule('installation', CONTRACT_TOTAL);
    expect(l.expectations.map((e) => e.expected_amount_cents))
      .toEqual(engine.stages.map((s) => s.amount_cents));
  });

  it('product-only 75/25 with half-up rounding and remainder to final', () => {
    const l = buildExpectations('product_only_75_25', {
      quote_version_id: QUOTE_VERSION_ID, quote_hash: QUOTE_HASH, total_cents: 100001,
    }, BINDING);
    expect(l.expectations.map((e) => [e.milestone, e.expected_amount_cents]))
      .toEqual([['pre_order', 75001], ['final', 25000]]);
    const engine = buildPaymentSchedule('product_only', 100001);
    expect(l.expectations.map((e) => e.expected_amount_cents))
      .toEqual(engine.stages.map((s) => s.amount_cents));
  });

  it('installation odd-cent rounding: 100001 -> 50001 / 25000 / 25000', () => {
    const l = installLedger(100001);
    expect(l.expectations.map((e) => e.expected_amount_cents))
      .toEqual([50001, 25000, 25000]);
  });

  it('every expectation carries the full binding', () => {
    for (const e of installLedger().expectations) {
      expect(e.project_id).toBe(PROJECT_ID);
      expect(e.contract_id).toBe(CONTRACT_ID);
      expect(e.quote_version_id).toBe(QUOTE_VERSION_ID);
      expect(e.quote_hash).toBe(QUOTE_HASH);
      expect(e.contract_amount_cents).toBe(CONTRACT_TOTAL);
      expect(e.state).toBe('expected');
      expect(e.received_cents).toBe(0);
      expect(e.reconciliation_state).toBe('unreconciled');
    }
  });

  it('the order gate milestone is deposit (install) / pre_order (product-only)', () => {
    expect(orderPaymentMilestone('installation_50_25_25')).toBe('deposit');
    expect(orderPaymentMilestone('product_only_75_25')).toBe('pre_order');
  });

  it('fails closed on bad inputs', () => {
    const quote = { quote_version_id: QUOTE_VERSION_ID, quote_hash: QUOTE_HASH,
      total_cents: 100 };
    expect(() => buildExpectations('x' as never, quote, BINDING)).toThrow();
    expect(() => buildExpectations('installation_50_25_25',
      { ...quote, total_cents: -1 }, BINDING)).toThrow();
    expect(() => buildExpectations('installation_50_25_25',
      { ...quote, total_cents: 1.5 }, BINDING)).toThrow();
    expect(() => buildExpectations('installation_50_25_25',
      { ...quote, quote_hash: '' }, BINDING)).toThrow();
    expect(() => buildExpectations('installation_50_25_25',
      { ...quote, quote_version_id: '' }, BINDING)).toThrow();
  });
});

describe('payment events - binding, idempotency, over-payment', () => {
  it('an exact deposit is received and reconciled', () => {
    const r = applyPaymentEvent(installLedger(), depositEvent());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expectation.state).toBe('received');
    expect(r.expectation.received_cents).toBe(462719);
    expect(r.expectation.reconciliation_state).toBe('reconciled');
    expect(r.ledger.applied_event_keys).toEqual(['evt-1']);
    expect(paymentConditionMet(r.ledger, 'deposit')).toEqual({ ok: true });
  });

  it.each([
    ['project', { project_id: OTHER_PROJECT_ID }],
    ['contract', { contract_id: OTHER_CONTRACT_ID }],
    ['quote version', { quote_version_id: 'other-version' }],
    ['milestone', { milestone: 'pre_order' as const }],
    ['quote hash', { quote_hash: 'other-hash' }],
    ['expected amount', { expected_amount_cents: 462718 }],
  ])('wrong %s => binding_mismatch with no state change', (_label, over) => {
    const ledger = installLedger();
    const before = JSON.stringify(ledger);
    const r = applyPaymentEvent(ledger, depositEvent(over));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('binding_mismatch');
    expect(JSON.stringify(r.ledger)).toBe(before);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it('a duplicate idempotency key is a refused no-op', () => {
    const first = applyPaymentEvent(installLedger(), depositEvent());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = applyPaymentEvent(first.ledger, depositEvent());
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('duplicate_event');
    expect(again.ledger).toBe(first.ledger);
  });

  it('partial receipt stays partially_received and does not meet the condition', () => {
    const r = applyPaymentEvent(installLedger(), depositEvent({ amount_cents: 100 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expectation.state).toBe('partially_received');
    expect(paymentConditionMet(r.ledger, 'deposit')).toEqual({
      ok: false,
      reason: 'not_received',
    });
    const rest = applyPaymentEvent(
      r.ledger,
      depositEvent({ amount_cents: 462619, idempotency_key: 'evt-2' }),
    );
    expect(rest.ok && rest.expectation.state).toBe('received');
    expect(rest.ok && rest.expectation.reconciliation_state).toBe('reconciled');
  });

  it('over-payment => received + mismatch, blocks the condition, nothing returned', () => {
    const r = applyPaymentEvent(
      installLedger(),
      depositEvent({ amount_cents: 462720 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expectation.state).toBe('received');
    expect(r.expectation.received_cents).toBe(462720);
    expect(r.expectation.reconciliation_state).toBe('mismatch');
    expect(paymentConditionMet(r.ledger, 'deposit')).toEqual({
      ok: false,
      reason: 'reconciliation_mismatch',
    });
    // A mismatched milestone accepts no further automatic changes.
    const more = applyPaymentEvent(
      r.ledger,
      depositEvent({ amount_cents: 1, idempotency_key: 'evt-3' }),
    );
    expect(more.ok).toBe(false);
    if (!more.ok) expect(more.reason).toBe('milestone_closed');
  });

  it('rejects zero, negative, fractional, and oversized amounts', () => {
    for (const amount of [0, -1, 1.5, Number.NaN, 60_000_000_000]) {
      const r = applyPaymentEvent(installLedger(), depositEvent({ amount_cents: amount }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_amount');
    }
  });

  it('rejects an event without an idempotency key', () => {
    const r = applyPaymentEvent(installLedger(), depositEvent({ idempotency_key: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_event');
  });

  it('the payment condition fails closed for unknown milestones and empty ledgers', () => {
    expect(paymentConditionMet(installLedger(), 'pre_order').ok).toBe(false);
    expect(paymentConditionMet(null, 'deposit').ok).toBe(false);
    expect(paymentConditionMet(installLedger(), 'deposit').ok).toBe(false);
  });

  it('owner waiver requires a human actor and then satisfies the condition', () => {
    const ledger = installLedger();
    const byAgent = waiveExpectationByOwner(ledger, 'deposit', AGENT);
    expect(byAgent.ok).toBe(false);
    const byOwner = waiveExpectationByOwner(ledger, 'deposit', OWNER);
    expect(byOwner.ok).toBe(true);
    if (!byOwner.ok) return;
    expect(paymentConditionMet(byOwner.ledger, 'deposit')).toEqual({ ok: true });
    const after = applyPaymentEvent(byOwner.ledger, depositEvent());
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('milestone_closed');
  });
});

describe('payment state - static pin: no money-movement path exists', () => {
  const dir = join(__dirname, '..', 'src', 'lib', 'business', 'order-chain');
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it('no source in order-chain names a return-of-funds or collection function', () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(/refund/i);
      expect(text, name).not.toMatch(/charge/i);
      expect(text, name).not.toMatch(/payout/i);
      expect(text, name).not.toMatch(/stripe|paypal|square|plaid/i);
    }
  });

  it('applying a payment never lowers received_cents (no reversal path)', () => {
    let ledger = installLedger();
    const keys = ['a', 'b', 'c', 'd'];
    let last = 0;
    for (const key of keys) {
      const r = applyPaymentEvent(
        ledger,
        depositEvent({ amount_cents: 200000, idempotency_key: key }),
      );
      if (!r.ok) break;
      expect(r.expectation.received_cents).toBeGreaterThanOrEqual(last);
      last = r.expectation.received_cents;
      ledger = r.ledger;
    }
    expect(last).toBeGreaterThan(0);
  });
});
