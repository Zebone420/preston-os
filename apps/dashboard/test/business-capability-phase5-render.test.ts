// Phase 5 safe external-preparation capabilities. Synthetic data only.
// These tests prove both playbook capability ids traverse the trusted
// executor without becoming a provider/send/order-placement surface.

import { describe, expect, it } from 'vitest';
import {
  checkContractTemplate,
  renderContractPackage,
} from '../src/lib/ai-os/capabilities/business/contract-package-render';
import {
  checkPoPackage,
  renderPoDocument,
} from '../src/lib/ai-os/capabilities/business/po-document-render';
import {
  ContractPackageRenderParamsSchema,
  PoDocumentRenderParamsSchema,
} from '../src/lib/ai-os/capabilities/business/schemas';
import {
  computePoHash,
  hashCanonical,
} from '../src/lib/business/order-chain/hash';
import {
  PROJECT,
  SHA_A,
  SHA_B,
  describeCapabilityMatrix,
  execValid,
  makeFakeDb,
  type MatrixSpec,
} from './business-capability-harness.test';

const CONTRACT_TOTAL = 376_285;

function contractParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    template: {
      id: 'template-contract-package-v3',
      name: 'contract_package',
      version: 3,
      sha256: SHA_A,
      document_id: 'doc-contract-template-v3',
      required_forms: ['ny-hic', 'rrp-ack'],
      approved_by: 'owner@example.com',
      approved_at: '2026-09-01T10:00:00.000Z',
      is_current: true,
    },
    included_forms: [
      { form_id: 'rrp-ack', document_id: 'doc-rrp-ack-v2', sha256: SHA_B },
      { form_id: 'ny-hic', document_id: 'doc-ny-hic-v4', sha256: SHA_A },
    ],
    proposal: {
      document_id: 'doc-proposal-0041-v1',
      content_sha256: SHA_B,
      quote_id: 'quote-0041-v1',
      quote_version: 1,
      quote_sha256: SHA_A,
      currency: 'USD',
      total_cents: CONTRACT_TOTAL,
    },
    payment_plan: 'installation_50_25_25',
    ...over,
  };
}

const CONTRACT_SPEC: MatrixSpec = {
  capability: 'contract.package.render',
  approval_class: 'INTERNAL',
  risk_class: 'GREEN',
  operation_kind: 'write',
  valid: () => contractParams(),
  schemaInvalid: [
    { name: 'wrong template kind', reason: 'schema_invalid:template.name',
      params: contractParams({ template: {
        ...(contractParams().template as Record<string, unknown>), name: 'proposal',
      } }) },
    { name: 'invalid proposal hash', reason: 'schema_invalid:proposal.content_sha256',
      params: contractParams({ proposal: {
        ...(contractParams().proposal as Record<string, unknown>), content_sha256: 'x',
      } }) },
    { name: 'template without approval actor', reason: 'schema_invalid:template.approved_by',
      params: contractParams({ template: {
        ...(contractParams().template as Record<string, unknown>), approved_by: null,
      } }) },
    { name: 'template without approval timestamp',
      reason: 'schema_invalid:template.approved_at',
      params: contractParams({ template: {
        ...(contractParams().template as Record<string, unknown>), approved_at: null,
      } }) },
    { name: 'fractional contract cents', reason: 'schema_invalid:proposal.total_cents',
      params: contractParams({ proposal: {
        ...(contractParams().proposal as Record<string, unknown>), total_cents: 1.5,
      } }) },
    { name: 'contract total beyond supported money bound',
      reason: 'schema_invalid:proposal.total_cents',
      params: contractParams({ proposal: {
        ...(contractParams().proposal as Record<string, unknown>),
        total_cents: 50_000_000_001,
      } }) },
    { name: 'send instruction at strict boundary', reason: 'schema_invalid:root',
      params: contractParams({ send: true }) },
  ],
  negatives: [
    { name: 'superseded template', reason: 'template_not_current',
      params: contractParams({ template: {
        ...(contractParams().template as Record<string, unknown>), is_current: false,
      } }) },
    { name: 'missing required form', reason: 'required_form_missing',
      params: contractParams({ included_forms: [
        { form_id: 'ny-hic', document_id: 'doc-ny-hic-v4', sha256: SHA_A },
      ] }) },
    { name: 'unapproved extra form', reason: 'form_not_required',
      params: contractParams({ included_forms: [
        ...(contractParams().included_forms as Record<string, unknown>[]),
        { form_id: 'extra-form', document_id: 'doc-extra', sha256: SHA_A },
      ] }) },
    { name: 'duplicate required form ids', reason: 'required_forms_not_unique',
      params: contractParams({ template: {
        ...(contractParams().template as Record<string, unknown>),
        required_forms: ['ny-hic', 'ny-hic'],
      }, included_forms: [
        { form_id: 'ny-hic', document_id: 'doc-ny-hic-v4', sha256: SHA_A },
      ] }) },
    { name: 'duplicate included form descriptors', reason: 'included_forms_not_unique',
      params: contractParams({ included_forms: [
        ...(contractParams().included_forms as Record<string, unknown>[]),
        { form_id: 'ny-hic', document_id: 'doc-ny-hic-other', sha256: SHA_B },
      ] }) },
  ],
};

describeCapabilityMatrix(CONTRACT_SPEC);

describe('contract.package.render - deterministic safe package', () => {
  it('binds template, proposal, quote, amount and exact 50/25/25 schedule', () => {
    const params = ContractPackageRenderParamsSchema.parse(contractParams());
    expect(checkContractTemplate(params)).toBeNull();
    const first = renderContractPackage(params);
    expect(renderContractPackage(params)).toEqual(first);
    expect(first.descriptor).toMatchObject({
      document_type: 'contract_package',
      project_id: PROJECT,
      template_id: 'template-contract-package-v3',
      template_version: 3,
      template_sha256: SHA_A,
      template_document_id: 'doc-contract-template-v3',
      template_approved_by: 'owner@example.com',
      template_approved_at: '2026-09-01T10:00:00.000Z',
      proposal_sha256: SHA_B,
      quote_sha256: SHA_A,
      total_cents: CONTRACT_TOTAL,
      provider_state: 'rendered_not_sent',
    });
    expect(first.descriptor.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.descriptor.required_forms).toEqual([
      { form_id: 'ny-hic', document_id: 'doc-ny-hic-v4', sha256: SHA_A },
      { form_id: 'rrp-ack', document_id: 'doc-rrp-ack-v2', sha256: SHA_B },
    ]);
    expect(first.rendered_text).toContain(
      `ny-hic: doc-ny-hic-v4 SHA-256 ${SHA_A}`,
    );
    expect(first.rendered_text).toContain('Payment 1: 50% $1,881.43');
    expect(first.rendered_text).toContain('Payment 2: 25% $940.71');
    expect(first.rendered_text).toContain('Payment 3: 25% $940.71');
    expect(first.rendered_text).not.toMatch(/recipient|envelope|send now/i);
  });

  it('binds every exact required-form document and hash into the content hash', () => {
    const first = ContractPackageRenderParamsSchema.parse(contractParams());
    const changed = ContractPackageRenderParamsSchema.parse(contractParams({
      included_forms: [
        { form_id: 'rrp-ack', document_id: 'doc-rrp-ack-v2', sha256: SHA_A },
        { form_id: 'ny-hic', document_id: 'doc-ny-hic-v4', sha256: SHA_A },
      ],
    }));
    expect(renderContractPackage(changed).descriptor.content_sha256)
      .not.toBe(renderContractPackage(first).descriptor.content_sha256);
  });

  it('supports only the deterministic 75/25 product-only schedule', () => {
    const params = ContractPackageRenderParamsSchema.parse(
      contractParams({ payment_plan: 'product_only_75_25' }),
    );
    const rendered = renderContractPackage(params).rendered_text;
    expect(rendered).toContain('Payment 1: 75% $2,822.14');
    expect(rendered).toContain('Payment 2: 25% $940.71');
    expect(rendered).not.toContain('Payment 3:');
  });

  it('executor output is sandbox-only and explicitly not sent', async () => {
    const { res } = await execValid(makeFakeDb(), CONTRACT_SPEC);
    expect(res.ok).toBe(true);
    expect(res.provider_state).toBe('sandbox_only');
    expect((res.output?.descriptor as Record<string, unknown>).provider_state)
      .toBe('rendered_not_sent');
  });
});

function basePoBody(): Record<string, unknown> {
  const measurementSha = hashCanonical({ project_id: PROJECT, version: 2 });
  const configurationHash = hashCanonical({
    vendor: 'Andersen', product_line: '400 Series', product_codes: ['TW3046', 'CW24'],
  });
  const poHash = computePoHash({
    measurement_sha256: measurementSha,
    configuration_hash: configurationHash,
    template_sha256: SHA_A,
  });
  if (!poHash) throw new Error('fixture: PO hash');
  return {
    project_id: PROJECT,
    contract_id: 'contract-0041-v1',
    measurement_id: 'measure-0041-v2',
    measurement_sha256: measurementSha,
    configuration_hash: configurationHash,
    template_sha256: SHA_A,
    po_hash: poHash,
    vendor: 'Andersen',
    product_line: '400 Series',
    line_items: [
      { position: 1, opening_id: 'W1', width_in: 35.5, height_in: 62,
        unit_type: 'DH', product_code: 'TW3046', options: { color: 'white' }, quantity: 1 },
      { position: 2, opening_id: 'W2', width_in: 36, height_in: 60.25,
        unit_type: 'DH', product_code: 'CW24', options: { color: 'white' }, quantity: 1 },
    ],
    sold_to: { company: 'Preston', attention: 'Preston Orders',
      email: 'orders@preston.nyc', phone: '212-555-0100',
      address_lines: ['1 Synthetic Street', 'New York, NY 10001'] },
    ship_to: { company: 'Preston', attention: 'Preston Site Receiving',
      email: 'orders@preston.nyc', phone: '212-555-0100',
      address_lines: ['1 Synthetic Street', 'New York, NY 10001'] },
  };
}

function poParams(
  packageOver: Record<string, unknown> = {},
  rootOver: Record<string, unknown> = {},
): Record<string, unknown> {
  const body = { ...basePoBody(), ...packageOver };
  const vendorSlug = String(body.vendor).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const pkg = {
    ...body,
    measurement_version: 2,
    document_id: null,
    document: {
      document_type: 'purchase_order',
      canonical_filename:
        `PO_${body.project_id}_${vendorSlug}_m2_${String(body.po_hash).slice(0, 12)}.json`,
      mime_type: 'application/json',
      sha256: hashCanonical(body),
    },
    state: 'prepared',
    prepared_at: '2026-09-08T12:00:00.000Z',
    approved_by: null,
    placed_at: null,
  };
  return { project_id: PROJECT, template_id: 'po_v1', package: pkg, ...rootOver };
}

const PO_SPEC: MatrixSpec = {
  capability: 'po.document.render',
  approval_class: 'INTERNAL',
  risk_class: 'GREEN',
  operation_kind: 'write',
  valid: () => poParams(),
  schemaInvalid: [
    { name: 'unknown template', reason: 'schema_invalid:template_id',
      params: poParams({}, { template_id: 'po_v2' }) },
    { name: 'already approved package', reason: 'schema_invalid:package.state',
      params: poParams({}, { package: {
        ...(poParams().package as Record<string, unknown>),
        state: 'approved_for_placement', approved_by: 'owner-1',
      } }) },
    { name: 'placement instruction at strict boundary', reason: 'schema_invalid:root',
      params: poParams({}, { place_order: true }) },
  ],
  negatives: [
    { name: 'project binding mismatch', reason: 'project_binding_mismatch',
      params: poParams({ project_id: 'P26-0099' }) },
    { name: 'forged PO hash', reason: 'po_hash_mismatch',
      params: poParams({ po_hash: SHA_B }) },
    { name: 'non-Preston vendor contact', reason: 'po_contact_not_preston',
      params: poParams({ sold_to: {
        ...(basePoBody().sold_to as Record<string, unknown>), email: 'customer@example.com',
      } }) },
    { name: 'non-canonical line positions', reason: 'po_line_positions_invalid',
      params: poParams({ line_items: [
        ...((basePoBody().line_items as Record<string, unknown>[]).map((line) =>
          ({ ...line, position: 2 }))),
      ] }) },
  ],
};

describeCapabilityMatrix(PO_SPEC);

describe('po.document.render - deterministic safe package', () => {
  it('verifies all bindings and renders the exact canonical prepared body', () => {
    const params = PoDocumentRenderParamsSchema.parse(poParams());
    expect(checkPoPackage(params)).toBeNull();
    const first = renderPoDocument(params);
    expect(renderPoDocument(params)).toEqual(first);
    expect(first.descriptor).toMatchObject({
      document_type: 'purchase_order', project_id: PROJECT, template_id: 'po_v1',
      template_sha256: SHA_A, po_hash: params.package.po_hash,
      content_sha256: params.package.document.sha256,
      provider_state: 'rendered_not_placed',
    });
    expect(JSON.parse(first.rendered_text)).toMatchObject({
      project_id: PROJECT, vendor: 'Andersen', measurement_sha256:
        params.package.measurement_sha256,
    });
    expect(first.rendered_text).not.toMatch(/approved_by|placed_at|place_order/);
  });

  it('executor output is sandbox-only and explicitly not placed', async () => {
    const { res } = await execValid(makeFakeDb(), PO_SPEC);
    expect(res.ok).toBe(true);
    expect(res.provider_state).toBe('sandbox_only');
    expect((res.output?.descriptor as Record<string, unknown>).provider_state)
      .toBe('rendered_not_placed');
  });
});
