// Phase 5 po.document.render - deterministic, sandbox-only external
// preparation. It renders an already prepared, hash-bound PO package for
// owner review. It cannot approve, place, transmit, or mutate an order.

import type { ParamsValidation } from '../registry';
import { canonicalJson } from '../contract';
import {
  computePoHash,
  hashCanonical,
} from '../../../business/order-chain/hash';
import { isPrestonEmail } from '../../../business/order-chain/contact-guard';
import {
  PoDocumentRenderParamsSchema,
  parseWith,
  type PoDocumentRenderParams,
} from './schemas';

type PoPackage = PoDocumentRenderParams['package'];

export interface PoRenderDescriptor {
  document_id: string;
  document_type: 'purchase_order';
  project_id: string;
  version: number;
  template_id: 'po_v1';
  template_sha256: string;
  measurement_sha256: string;
  po_hash: string;
  filename: string;
  content_sha256: string;
  mime: 'application/json';
  provider_state: 'rendered_not_placed';
}

export interface PoDocumentRender {
  descriptor: PoRenderDescriptor;
  rendered_text: string;
}

function poBody(p: PoPackage): Record<string, unknown> {
  return {
    project_id: p.project_id,
    contract_id: p.contract_id,
    measurement_id: p.measurement_id,
    measurement_sha256: p.measurement_sha256,
    configuration_hash: p.configuration_hash,
    template_sha256: p.template_sha256,
    po_hash: p.po_hash,
    vendor: p.vendor,
    product_line: p.product_line,
    line_items: p.line_items,
    sold_to: p.sold_to,
    ship_to: p.ship_to,
  };
}

function expectedFilename(p: PoPackage): string {
  const vendor = p.vendor.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `PO_${p.project_id}_${vendor}_m${p.measurement_version}` +
    `_${p.po_hash.slice(0, 12)}.json`;
}

export type PoRenderRefusal =
  | 'project_binding_mismatch'
  | 'po_hash_mismatch'
  | 'po_document_hash_mismatch'
  | 'po_filename_mismatch'
  | 'po_contact_not_preston'
  | 'po_line_positions_invalid';

export function checkPoPackage(p: PoDocumentRenderParams): PoRenderRefusal | null {
  const pkg = p.package;
  if (p.project_id !== pkg.project_id) return 'project_binding_mismatch';
  const poHash = computePoHash({
    measurement_sha256: pkg.measurement_sha256,
    configuration_hash: pkg.configuration_hash,
    template_sha256: pkg.template_sha256,
  });
  if (poHash !== pkg.po_hash) return 'po_hash_mismatch';
  if (hashCanonical(poBody(pkg)) !== pkg.document.sha256) {
    return 'po_document_hash_mismatch';
  }
  if (pkg.document.canonical_filename !== expectedFilename(pkg)) {
    return 'po_filename_mismatch';
  }
  if (!isPrestonEmail(pkg.sold_to.email) || !isPrestonEmail(pkg.ship_to.email)) {
    return 'po_contact_not_preston';
  }
  if (pkg.line_items.some((line, index) => line.position !== index + 1)) {
    return 'po_line_positions_invalid';
  }
  return null;
}

export function renderPoDocument(p: PoDocumentRenderParams): PoDocumentRender {
  const pkg = p.package;
  return {
    descriptor: {
      document_id: `doc-po-${pkg.document.sha256.slice(0, 24)}`,
      document_type: 'purchase_order',
      project_id: p.project_id,
      version: pkg.measurement_version,
      template_id: p.template_id,
      template_sha256: pkg.template_sha256,
      measurement_sha256: pkg.measurement_sha256,
      po_hash: pkg.po_hash,
      filename: pkg.document.canonical_filename,
      content_sha256: pkg.document.sha256,
      mime: 'application/json',
      provider_state: 'rendered_not_placed',
    },
    rendered_text: canonicalJson(poBody(pkg)),
  };
}

export function validatePoDocumentRender(
  params: Record<string, unknown>,
): ParamsValidation {
  const parsed = parseWith(PoDocumentRenderParamsSchema, params);
  if (!parsed.ok) return parsed;
  const refusal = checkPoPackage(parsed.data);
  if (refusal) return { ok: false, reason: refusal };
  const rendered = renderPoDocument(parsed.data);
  return {
    ok: true,
    canonical: { kind: 'po.document.render', ...rendered.descriptor },
    binding: {
      project_id: parsed.data.project_id,
      document_hash: rendered.descriptor.content_sha256,
      amount: null,
      recipient: null,
    },
  };
}
