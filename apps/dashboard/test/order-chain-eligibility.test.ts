import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateOrderEligibility,
  ORDER_PREDICATES,
  type OrderEligibilityFacts,
  type OrderPredicateName,
} from '../src/lib/business/order-chain/order-eligibility';
import {
  approveForPlacement,
  configurationHash,
  preparePurchaseOrderPackage,
  type PreparePoInput,
} from '../src/lib/business/order-chain/po-preparation';
import { computePoHash, sha256Hex } from '../src/lib/business/order-chain/hash';
import { findContactLeaks } from '../src/lib/business/order-chain/contact-guard';
import * as contractState from '../src/lib/business/order-chain/contract-state';
import * as paymentState from '../src/lib/business/order-chain/payment-state';
import * as finalMeasure from '../src/lib/business/order-chain/final-measure';
import * as eligibility from '../src/lib/business/order-chain/order-eligibility';
import * as poPrep from '../src/lib/business/order-chain/po-preparation';
import * as store from '../src/lib/business/order-chain/store';
import {
  AGENT,
  allPassFacts,
  approvedMeasurement,
  CLIENT_CONTACT,
  completedContract,
  configuration,
  NOW,
  OWNER,
  PRESTON_BLOCK,
  PROJECT_ID,
  RUNTIME,
  STALE_TEMPLATE_SHA,
} from './order-chain-fixtures';

function expectBlockedOnly(
  facts: OrderEligibilityFacts,
  names: OrderPredicateName[],
  reasonPattern?: RegExp,
) {
  const check = evaluateOrderEligibility(facts);
  expect(check.all_ok).toBe(false);
  expect(check.blocked_by).toEqual(names);
  if (reasonPattern) {
    expect(check.predicates[names[0]].reason).toMatch(reasonPattern);
  }
  return check;
}

describe('order eligibility - all-pass case', () => {
  it('passes with every predicate ok and returns the readiness row shape', () => {
    const facts = allPassFacts();
    const check = evaluateOrderEligibility(facts);
    expect(check.all_ok).toBe(true);
    expect(check.blocked_by).toEqual([]);
    expect(check.project_id).toBe(PROJECT_ID);
    expect(check.evaluated_at).toBe(NOW);
    expect(check.po_hash).toBe(facts.po_hash);
    expect(Object.keys(check.predicates).sort()).toEqual([...ORDER_PREDICATES].sort());
    for (const name of ORDER_PREDICATES) {
      expect(check.predicates[name]).toEqual({ ok: true, reason: 'ok' });
    }
  });

  it('has exactly the nine named predicates', () => {
    expect([...ORDER_PREDICATES]).toEqual([
      'signed_contract',
      'payment_condition',
      'final_measure_approved',
      'building_approval_condition',
      'lpc_condition',
      'dob_condition',
      'po_hash_matches_approved_configuration',
      'no_open_change_order',
      'client_contact_absent_from_vendor_material',
    ]);
  });
});

describe('order eligibility - each predicate blocks individually', () => {
  it('signed_contract: missing / pending / unverified / stale', () => {
    expectBlockedOnly(allPassFacts({ contract: null }),
      ['signed_contract', 'po_hash_matches_approved_configuration'], /contract_missing/);
    const pending = { ...completedContract(), state: 'sent' as const };
    expectBlockedOnly(allPassFacts({ contract: pending }), ['signed_contract'],
      /not_completed/);
    const unverified = { ...completedContract(), provider_event_verified: false };
    expectBlockedOnly(allPassFacts({ contract: unverified }), ['signed_contract'],
      /provider_not_verified/);
    expectBlockedOnly(allPassFacts({ current_template_sha256: STALE_TEMPLATE_SHA }),
      ['signed_contract'], /stale_contract/);
  });

  it('payment_condition: unpaid deposit blocks an installation order', () => {
    const unpaid = paymentState.buildExpectations(
      'installation_50_25_25', 925438, allPassFacts().payment_ledger!.quote_hash,
      { project_id: PROJECT_ID, contract_id: completedContract().id },
    );
    expectBlockedOnly(allPassFacts({ payment_ledger: unpaid }), ['payment_condition'],
      /deposit_not_received/);
    expectBlockedOnly(allPassFacts({ payment_ledger: null }), ['payment_condition'],
      /ledger_missing/);
  });

  it('payment_condition: product-only requires pre_order (75%) received', () => {
    const quoteHash = sha256Hex('po-quote');
    const contract = completedContract();
    const ledger = paymentState.buildExpectations('product_only_75_25', 100001,
      quoteHash, { project_id: PROJECT_ID, contract_id: contract.id });
    expectBlockedOnly(
      allPassFacts({ plan_type: 'product_only_75_25', payment_ledger: ledger }),
      ['payment_condition'], /pre_order_not_received/,
    );
    const paid = paymentState.applyPaymentEvent(ledger, {
      amount_cents: 75001, project_id: PROJECT_ID, contract_id: contract.id,
      milestone: 'pre_order', quote_hash: quoteHash, expected_amount_cents: 75001,
      idempotency_key: 'k1',
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    const check = evaluateOrderEligibility(
      allPassFacts({ plan_type: 'product_only_75_25', payment_ledger: paid.ledger }),
    );
    expect(check.all_ok).toBe(true);
  });

  it('payment_condition: a ledger for another contract does not count', () => {
    const facts = allPassFacts();
    const foreign = { ...facts.payment_ledger!, contract_id: 'other' };
    expectBlockedOnly(allPassFacts({ payment_ledger: foreign }), ['payment_condition'],
      /ledger_binding_mismatch/);
  });

  it('final_measure_approved: draft, estimate, or missing measurement blocks', () => {
    const m = approvedMeasurement();
    expectBlockedOnly(allPassFacts({ measurement: { ...m, status: 'submitted' } }),
      ['final_measure_approved', 'po_hash_matches_approved_configuration'],
      /measurement_not_approved/);
    expectBlockedOnly(allPassFacts({ measurement: { ...m, source: 'intake' } }),
      ['final_measure_approved'], /estimate_source_refused/);
    expectBlockedOnly(allPassFacts({ measurement: null }),
      ['final_measure_approved', 'po_hash_matches_approved_configuration'],
      /measurement_missing/);
  });

  it('building / lpc / dob conditions block when required and not evidenced', () => {
    expectBlockedOnly(
      allPassFacts({ building_approval: { required: true, approved: false,
        evidence_ref: null } }),
      ['building_approval_condition'], /not_approved/);
    expectBlockedOnly(
      allPassFacts({ lpc: { required: true, approved: true, evidence_ref: '' } }),
      ['lpc_condition'], /evidence_missing/);
    expectBlockedOnly(allPassFacts({ dob: null }), ['dob_condition'], /condition_unknown/);
  });

  it('po_hash_matches_approved_configuration: mismatch or drift blocks', () => {
    expectBlockedOnly(allPassFacts({ po_hash: sha256Hex('wrong') }),
      ['po_hash_matches_approved_configuration'], /po_hash_mismatch/);
    expectBlockedOnly(allPassFacts({ po_hash: null }),
      ['po_hash_matches_approved_configuration'], /po_hash_missing/);
    expectBlockedOnly(allPassFacts({ configuration_hash: sha256Hex('other-config') }),
      ['po_hash_matches_approved_configuration'], /po_hash_mismatch/);
    // Re-measured sizes change the measurement sha and therefore the hash.
    const m = approvedMeasurement();
    const remeasured = { ...m, sha256: sha256Hex('different-sizes') };
    const check = evaluateOrderEligibility(allPassFacts({ measurement: remeasured }));
    expect(check.all_ok).toBe(false);
    expect(check.blocked_by).toContain('po_hash_matches_approved_configuration');
  });

  it('no_open_change_order: proposed or owner_review blocks', () => {
    expectBlockedOnly(allPassFacts({ change_order_states: ['approved', 'proposed'] }),
      ['no_open_change_order'], /open_change_orders:1/);
    expectBlockedOnly(allPassFacts({ change_order_states: ['owner_review'] }),
      ['no_open_change_order']);
  });

  it('client_contact_absent_from_vendor_material: email or phone leak blocks', () => {
    const facts = allPassFacts();
    const leakEmail = { ...(facts.vendor_material as object),
      ship_to: { ...PRESTON_BLOCK, email: 'jane.example@example.com' } };
    expectBlockedOnly(allPassFacts({ vendor_material: leakEmail }),
      ['client_contact_absent_from_vendor_material'], /email:jane\.example@example\.com/);
    const leakPhone = { ...(facts.vendor_material as object),
      line_items: [{ opening_id: 'W1', notes: 'call 917.555.0199 for access' }] };
    expectBlockedOnly(allPassFacts({ vendor_material: leakPhone }),
      ['client_contact_absent_from_vendor_material'], /phone:9175550199/);
    expectBlockedOnly(allPassFacts({ vendor_material: null }),
      ['client_contact_absent_from_vendor_material'], /vendor_material_missing/);
  });

  it('a fully missing fact set blocks on every predicate', () => {
    const check = evaluateOrderEligibility({
      project_id: PROJECT_ID, evaluated_at: NOW, contract: null,
      current_template_sha256: null, plan_type: null, payment_ledger: null,
      measurement: null, building_approval: null, lpc: null, dob: null,
      configuration_hash: null, po_hash: null, change_order_states: [],
      vendor_material: null, client_contact: null,
    });
    expect(check.all_ok).toBe(false);
    expect(check.blocked_by.length).toBe(8);
    expect(check.po_hash).toBeNull();
  });
});

describe('contact guard', () => {
  it('allows Preston emails and unrelated numbers; flags client contact', () => {
    expect(findContactLeaks({ email: 'orders@preston.nyc', phone: '212-555-0100' },
      CLIENT_CONTACT)).toEqual([]);
    expect(findContactLeaks({ a: 'Jane Example' }, CLIENT_CONTACT)).toEqual([]);
    expect(findContactLeaks({ nested: { deep: 'JANE.EXAMPLE@EXAMPLE.COM' } },
      CLIENT_CONTACT)).toEqual(['email:jane.example@example.com']);
    expect(findContactLeaks({ n: '+1 (917) 555-0199' }, CLIENT_CONTACT))
      .toEqual(['phone:9175550199']);
    expect(findContactLeaks({ n: 'someone@gmail.com' }, { emails: [], phones: [] }))
      .toEqual(['email:someone@gmail.com']);
  });
});

describe('PO preparation - from the approved measurement only', () => {
  function input(over: Partial<PreparePoInput> = {}): PreparePoInput {
    return {
      project_id: PROJECT_ID,
      contract: completedContract(),
      current_template_sha256: completedContract().template_sha256,
      measurement: approvedMeasurement(),
      configuration: configuration(),
      sold_to: PRESTON_BLOCK,
      ship_to: { ...PRESTON_BLOCK, attention: 'Jane Example (site contact)' },
      client_contact: CLIENT_CONTACT,
      prepared_at: NOW,
      ...over,
    };
  }

  it('prepares a deterministic package bound by po_hash', () => {
    const a = preparePurchaseOrderPackage(input());
    const b = preparePurchaseOrderPackage(input());
    expect(a.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.package).toEqual(b.package);
    const p = a.package;
    expect(p.state).toBe('prepared');
    expect(p.approved_by).toBeNull();
    expect(p.placed_at).toBeNull();
    expect(p.line_items.map((l) => [l.opening_id, l.width_in, l.height_in]))
      .toEqual([['W1', 35.5, 62], ['W2', 36, 60.25]]);
    expect(p.line_items.map((l) => l.product_code)).toEqual(['TW3062', 'TW3060']);
    expect(p.configuration_hash).toBe(configurationHash(configuration()));
    expect(p.po_hash).toBe(computePoHash({
      measurement_sha256: p.measurement_sha256,
      configuration_hash: p.configuration_hash,
      template_sha256: completedContract().template_sha256,
    }));
    expect(p.document.document_type).toBe('purchase_order');
    expect(p.document.canonical_filename).toMatch(/^PO_.*_andersen_m1_[0-9a-f]{12}\.json$/);
    expect(p.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The prepared package passes its own eligibility check.
    const check = evaluateOrderEligibility(
      allPassFacts({ po_hash: p.po_hash, configuration_hash: p.configuration_hash,
        vendor_material: p }),
    );
    expect(check.all_ok).toBe(true);
  });

  it('refuses any measurement that is not an approved final measure', () => {
    const m = approvedMeasurement();
    for (const [bad, reason] of [
      [{ ...m, status: 'submitted' }, 'measurement_not_approved'],
      [{ ...m, source: 'estimate' }, 'estimate_source_refused'],
      [{ ...m, source: 'intake' }, 'estimate_source_refused'],
      [{ ...m, status: 'superseded' }, 'measurement_not_approved'],
    ] as const) {
      const r = preparePurchaseOrderPackage(input({ measurement: bad as never }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
  });

  it('refuses an unsigned or stale contract', () => {
    const pending = { ...completedContract(), state: 'viewed' as const,
      provider_event_verified: false };
    const r1 = preparePurchaseOrderPackage(input({ contract: pending }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('contract_not_signed');
    const r2 = preparePurchaseOrderPackage(
      input({ current_template_sha256: STALE_TEMPLATE_SHA }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('stale_contract');
  });

  it('refuses client email/phone anywhere in the package (contact_leak)', () => {
    const r1 = preparePurchaseOrderPackage(input({
      ship_to: { ...PRESTON_BLOCK, email: 'jane.example@example.com' },
    }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('contact_block_invalid');
    const r2 = preparePurchaseOrderPackage(input({
      ship_to: { ...PRESTON_BLOCK, attention: 'Jane (917) 555-0199' },
    }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toBe('contact_leak');
      expect(r2.detail).toEqual(['phone:9175550199']);
    }
    const cfg = configuration();
    cfg.lines[0].options = { note: 'email jane.example@example.com on delivery' };
    const r3 = preparePurchaseOrderPackage(input({ configuration: cfg }));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe('contact_leak');
  });

  it('refuses a configuration that does not match the approved openings', () => {
    const cfg = configuration();
    cfg.lines = [cfg.lines[0]];
    const r = preparePurchaseOrderPackage(input({ configuration: cfg }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('configuration_measurement_mismatch');
      expect(r.detail).toEqual(['missing:W2']);
    }
  });

  it('approveForPlacement needs a human and a fresh passing gate', () => {
    const prepared = preparePurchaseOrderPackage(input());
    if (!prepared.ok) throw new Error('fixture');
    const pkg = prepared.package;
    const facts = allPassFacts();
    expect(approveForPlacement(pkg, facts, RUNTIME, NOW).ok).toBe(false);
    expect(approveForPlacement(pkg, facts, AGENT, NOW).ok).toBe(false);
    // Facts that would block (open change order) block even if the caller
    // passes a po_hash that "matches": the hash is taken from the package.
    const blocked = approveForPlacement(
      pkg, { ...facts, change_order_states: ['proposed'] }, OWNER, NOW);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe('eligibility_blocked');
      expect(blocked.blocked_by).toEqual(['no_open_change_order']);
    }
    // A forged po_hash in facts is ignored; the package's own hash is used.
    const forged = approveForPlacement(
      { ...pkg, po_hash: sha256Hex('forged') }, facts, OWNER, NOW);
    expect(forged.ok).toBe(false);
    const ok = approveForPlacement(pkg, facts, OWNER, NOW);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.package.state).toBe('approved_for_placement');
    expect(ok.package.approved_by).toBe('owner-1');
    expect(ok.package.placed_at).toBeNull();
    expect(approveForPlacement(ok.package, facts, OWNER, NOW).ok).toBe(false);
  });
});

describe('static pin - no placement, transmission, or money-movement path', () => {
  const dir = join(__dirname, '..', 'src', 'lib', 'business', 'order-chain');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('covers every module in the directory', () => {
    expect(files.sort()).toEqual([
      'actor.ts', 'contact-guard.ts', 'contract-state.ts', 'final-measure.ts',
      'hash.ts', 'order-eligibility.ts', 'payment-state.ts', 'po-preparation.ts',
      'store.ts',
    ]);
  });

  it('no forbidden identifiers anywhere in the directory', () => {
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/placeOrder|charge|refund|payout|sendEnvelope/i);
      expect(text, f).not.toMatch(/\bfetch\s*\(/);
      expect(text, f).not.toMatch(/https?:\/\//);
      expect(text, f).not.toMatch(/docusign\.(net|com)|esign|@docusign/i);
      expect(text, f).not.toMatch(/nodemailer|smtp|twilio|sendgrid/i);
    }
  });

  it('only allowed imports (no network, no provider SDKs)', () => {
    const allowed = /^(\.\/|\.\.\/types|\.\.\/quote-engine|\.\.\/\.\.\/ai-os\/store|node:crypto)/;
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const specs = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const spec of specs) expect(spec, `${f} imports ${spec}`).toMatch(allowed);
      expect(text, f).not.toMatch(/\brequire\s*\(/);
    }
  });

  it('no exported function name suggests placing, sending, or paying', () => {
    const modules = [contractState, paymentState, finalMeasure, eligibility, poPrep, store];
    const names = modules.flatMap((m) => Object.keys(m));
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) {
      expect(n).not.toMatch(
        /^(place|send|transmit|submit(Order|Po)|pay(?!ment)|collect|dispatch)/i,
      );
      expect(n).not.toMatch(/placeOrder|sendEnvelope|sendPo|transmitPo/i);
    }
    // approveForPlacement is a human state approval, not a placement:
    expect(names).toContain('approveForPlacement');
  });
});
