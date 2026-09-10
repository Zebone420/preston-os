// Shared synthetic fixtures for the order-chain test suites. Every id
// and value here is fabricated; no real client data.

import type { ContractRecord, ContractTemplateRecord }
  from '../src/lib/business/order-chain/contract-state';
import {
  approveMeasurement,
  newMeasurementVersion,
  submitMeasurement,
  type FinalMeasurement,
} from '../src/lib/business/order-chain/final-measure';
import { sha256Hex } from '../src/lib/business/order-chain/hash';
import {
  applyPaymentEvent,
  buildExpectations,
  type PaymentLedger,
} from '../src/lib/business/order-chain/payment-state';
import type { OrderEligibilityFacts }
  from '../src/lib/business/order-chain/order-eligibility';
import {
  configurationHash,
  type PoConfiguration,
  type PrestonContactBlock,
} from '../src/lib/business/order-chain/po-preparation';
import type { Actor } from '../src/lib/business/order-chain/actor';

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
export const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
export const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';
export const QUOTE_VERSION_ID = '77777777-7777-4777-8777-777777777777';
export const MEASUREMENT_ID = '44444444-4444-4444-8444-444444444444';
export const OTHER_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
export const OTHER_CONTRACT_ID = '66666666-6666-4666-8666-666666666666';

export const TEMPLATE_SHA = sha256Hex('contract-template-v3');
export const STALE_TEMPLATE_SHA = sha256Hex('contract-template-v4');
export const QUOTE_HASH = sha256Hex('quote-version-7');
export const CONTRACT_PAYLOAD_HASH = sha256Hex('signed-contract-payload-v3');

export const OWNER: Actor = { kind: 'human', id: 'owner-1' };
export const RUNTIME: Actor = { kind: 'runtime', id: 'os-runtime' };
export const AGENT: Actor = { kind: 'agent', id: 'agent-x' };

export const SIGNED_AT = '2026-09-04T10:00:00.000Z'; // Friday
export const NOW = '2026-09-15T12:00:00.000Z';

export function draftedContract(): ContractRecord {
  return {
    id: CONTRACT_ID,
    project_id: PROJECT_ID,
    quote_version_id: QUOTE_VERSION_ID,
    template_id: TEMPLATE_ID,
    template_sha256: TEMPLATE_SHA,
    provider: 'docusign',
    provider_envelope_id: null,
    state: 'drafted',
    signed_at: null,
    provider_event_verified: false,
    payload_hash: CONTRACT_PAYLOAD_HASH,
    included_forms: ['installation-agreement', 'cancellation-notice'],
  };
}

export function currentTemplate(): ContractTemplateRecord {
  return {
    id: TEMPLATE_ID,
    name: 'installation-contract',
    version: 3,
    sha256: TEMPLATE_SHA,
    required_forms: ['installation-agreement', 'cancellation-notice'],
    approved_by: OWNER.id,
    approved_at: '2026-09-01T12:00:00.000Z',
    is_current: true,
  };
}

export function completedContract(): ContractRecord {
  return {
    ...draftedContract(),
    provider_envelope_id: 'env-001',
    state: 'completed',
    signed_at: SIGNED_AT,
    provider_event_verified: true,
  };
}

export const OPENINGS = [
  { opening_id: 'W1', width_in: 35.5, height_in: 62, unit_type: 'DH' },
  { opening_id: 'W2', width_in: 36, height_in: 60.25, unit_type: 'DH' },
];

export function approvedMeasurement(): FinalMeasurement {
  const created = newMeasurementVersion({
    project_id: PROJECT_ID,
    contract_id: CONTRACT_ID,
    measured_at: '2026-09-10T15:00:00.000Z',
    measured_by: 'field-tech-1',
    signed_at: SIGNED_AT,
    openings: OPENINGS,
  });
  if (!created.ok) throw new Error('fixture: measurement invalid');
  const withId = { ...created.measurement, id: MEASUREMENT_ID };
  const submitted = submitMeasurement(withId);
  if (!submitted.ok) throw new Error('fixture: submit failed');
  const approved = approveMeasurement(
    submitted.measurement,
    OWNER,
    '2026-09-11T09:00:00.000Z',
    SIGNED_AT,
  );
  if (!approved.ok) throw new Error('fixture: approve failed');
  return approved.measurement;
}

export const CONTRACT_TOTAL = 925438;

export function paidDepositLedger(): PaymentLedger {
  const ledger = buildExpectations(
    'installation_50_25_25',
    { quote_version_id: QUOTE_VERSION_ID, quote_hash: QUOTE_HASH,
      total_cents: CONTRACT_TOTAL },
    { project_id: PROJECT_ID, contract_id: CONTRACT_ID },
  );
  const applied = applyPaymentEvent(ledger, {
    amount_cents: 462719,
    project_id: PROJECT_ID,
    contract_id: CONTRACT_ID,
    quote_version_id: QUOTE_VERSION_ID,
    milestone: 'deposit',
    quote_hash: QUOTE_HASH,
    expected_amount_cents: 462719,
    idempotency_key: 'pay-deposit-1',
  });
  if (!applied.ok) throw new Error('fixture: deposit failed');
  return applied.ledger;
}

export const PRESTON_BLOCK: PrestonContactBlock = {
  company: 'Preston',
  attention: 'Preston Orders',
  email: 'orders@preston.nyc',
  phone: '212-555-0100',
  address_lines: ['1 Example Street', 'New York, NY 10001'],
};

export const CLIENT_CONTACT = {
  emails: ['jane.example@example.com'],
  phones: ['(917) 555-0199'],
};

export function configuration(): PoConfiguration {
  return {
    vendor: 'Andersen',
    product_line: '400 Series',
    lines: [
      { opening_id: 'W1', product_code: 'TW3062', options: { color: 'white' } },
      { opening_id: 'W2', product_code: 'TW3060', options: { color: 'white' } },
    ],
  };
}

export function allPassFacts(
  overrides: Partial<OrderEligibilityFacts> = {},
): OrderEligibilityFacts {
  const contract = completedContract();
  const measurement = approvedMeasurement();
  const config = configuration();
  const configHash = configurationHash(config);
  const poHash = sha256Hex(
    `po:${measurement.sha256}:${configHash}:${contract.template_sha256}`,
  );
  return {
    project_id: PROJECT_ID,
    evaluated_at: NOW,
    contract,
    current_template: currentTemplate(),
    authoritative_quote: { quote_version_id: QUOTE_VERSION_ID,
      quote_hash: QUOTE_HASH, total_cents: CONTRACT_TOTAL },
    plan_type: 'installation_50_25_25',
    payment_ledger: paidDepositLedger(),
    measurement,
    building_approval: { required: true, approved: true, evidence_ref: 'doc-b' },
    lpc: { required: false, approved: false, evidence_ref: null },
    dob: { required: true, approved: true, evidence_ref: 'doc-dob' },
    configuration_hash: configHash,
    po_hash: poHash,
    change_order_states: ['approved', 'rejected'],
    vendor_material: {
      vendor: 'Andersen',
      sold_to: PRESTON_BLOCK,
      ship_to: { ...PRESTON_BLOCK, attention: 'Jane Example (site)' },
      line_items: [{ opening_id: 'W1', notes: 'ground floor' }],
    },
    client_contact: CLIENT_CONTACT,
    ...overrides,
  };
}
