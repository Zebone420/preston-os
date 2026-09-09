// Phase 5 contract.package.render - deterministic, sandbox-only external
// preparation. This module creates a reviewable contract PACKAGE; it cannot
// create or send a DocuSign envelope. Payment amounts come exclusively from
// the deterministic quote-engine schedule and integer-cents quote total.

import type { ParamsValidation } from '../registry';
import { sha256Canonical } from '../contract';
import { buildPaymentSchedule } from '../../../business/quote-engine';
import {
  ContractPackageRenderParamsSchema,
  parseWith,
  type ContractPackageRenderParams,
} from './schemas';
import { formatCents } from './proposal-render';

export interface ContractPackageDescriptor {
  document_id: string;
  document_type: 'contract_package';
  project_id: string;
  version: number;
  template_id: 'contract_package_v1';
  template_sha256: string;
  proposal_document_id: string;
  proposal_sha256: string;
  quote_sha256: string;
  filename: string;
  content_sha256: string;
  mime: 'text/plain';
  total_cents: number;
  provider_state: 'rendered_not_sent';
}

export interface ContractPackageRender {
  descriptor: ContractPackageDescriptor;
  rendered_text: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function renderContractPackage(
  p: ContractPackageRenderParams,
): ContractPackageRender {
  const scheduleScope = p.payment_plan === 'installation_50_25_25'
    ? 'installation' : 'product_only';
  const schedule = buildPaymentSchedule(scheduleScope, p.proposal.total_cents);
  const text = [
    `CONTRACT PACKAGE ${p.project_id} V${pad2(p.proposal.quote_version)}`,
    `Template: ${p.template_id}`,
    `Template SHA-256: ${p.template_sha256}`,
    `Proposal: ${p.proposal.document_id}`,
    `Proposal SHA-256: ${p.proposal.content_sha256}`,
    `Quote: ${p.proposal.quote_id}`,
    `Quote SHA-256: ${p.proposal.quote_sha256}`,
    `Contract total: ${formatCents(p.proposal.total_cents)}`,
    `Payment plan: ${p.payment_plan}`,
    '',
    ...schedule.stages.map((stage, index) =>
      `Payment ${index + 1}: ${stage.fraction_milli / 1_000}% ` +
      formatCents(stage.amount_cents)),
  ].join('\n') + '\n';
  const contentHash = sha256Canonical({
    project_id: p.project_id,
    template_id: p.template_id,
    template_sha256: p.template_sha256,
    proposal: p.proposal,
    payment_plan: p.payment_plan,
    rendered: text,
  });
  return {
    descriptor: {
      document_id: `doc-contract-${contentHash.slice(0, 24)}`,
      document_type: 'contract_package',
      project_id: p.project_id,
      version: p.proposal.quote_version,
      template_id: p.template_id,
      template_sha256: p.template_sha256,
      proposal_document_id: p.proposal.document_id,
      proposal_sha256: p.proposal.content_sha256,
      quote_sha256: p.proposal.quote_sha256,
      filename:
        `${p.project_id}_CONTRACT_PACKAGE_V${pad2(p.proposal.quote_version)}.txt`,
      content_sha256: contentHash,
      mime: 'text/plain',
      total_cents: p.proposal.total_cents,
      provider_state: 'rendered_not_sent',
    },
    rendered_text: text,
  };
}

export function validateContractPackageRender(
  params: Record<string, unknown>,
): ParamsValidation {
  const parsed = parseWith(ContractPackageRenderParamsSchema, params);
  if (!parsed.ok) return parsed;
  const rendered = renderContractPackage(parsed.data);
  return {
    ok: true,
    canonical: { kind: 'contract.package.render', ...rendered.descriptor },
    binding: {
      project_id: parsed.data.project_id,
      document_hash: rendered.descriptor.content_sha256,
      amount: parsed.data.proposal.total_cents,
      recipient: null,
    },
  };
}
