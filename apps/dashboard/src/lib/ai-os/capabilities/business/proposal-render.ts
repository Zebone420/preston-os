// Preston AI OS - Phase 3 proposal.document.render. PURE, deterministic.
// INTERNAL preparation: structured quote data -> versioned document
// descriptor + rendered text. ARITHMETIC IS INPUT: this module never
// computes a price, subtotal, tax or total; it only CHECKS that the input
// reconciles (line qty * unit = line total; sum of lines = subtotal;
// subtotal + tax = total) and REFUSES otherwise (wrong-price prevention).
// No payment terms are rendered: verification-register facts stay out of
// client-facing output until the owner rules on them.

import type { ParamsValidation } from '../registry';
import { sha256Canonical } from '../contract';
import { ProposalRenderParamsSchema, parseWith, type ProposalRenderParams } from './schemas';

export interface ProposalDocumentDescriptor {
  document_id: string;
  document_type: 'proposal';
  project_id: string;
  quote_id: string;
  version: number;
  template_id: string;
  filename: string;
  content_sha256: string;
  mime: 'text/plain';
  line_count: number;
  total_cents: number;
}

export interface ProposalRender {
  descriptor: ProposalDocumentDescriptor;
  rendered_text: string;
}

export type ProposalReconcileFailure =
  | `totals_not_reconciled:line:${number}`
  | 'totals_not_reconciled:subtotal'
  | 'totals_not_reconciled:total'
  | 'line_numbers_not_unique';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${withCommas}.${rem < 10 ? '0' : ''}${rem}`;
}

// Comparison only - no recomputation is ever emitted.
export function checkQuoteReconciles(
  q: ProposalRenderParams['quote'],
): ProposalReconcileFailure | null {
  const seen = new Set<number>();
  let sum = 0;
  for (const li of q.line_items) {
    if (seen.has(li.line_no)) return 'line_numbers_not_unique';
    seen.add(li.line_no);
    if (li.qty * li.unit_price_cents !== li.line_total_cents) {
      return `totals_not_reconciled:line:${li.line_no}`;
    }
    sum += li.line_total_cents;
  }
  if (sum !== q.subtotal_cents) return 'totals_not_reconciled:subtotal';
  if (q.subtotal_cents + q.tax_cents !== q.total_cents) return 'totals_not_reconciled:total';
  return null;
}

export function renderProposal(p: ProposalRenderParams): ProposalRender {
  const q = p.quote;
  const lines = [...q.line_items].sort((a, b) => a.line_no - b.line_no);
  const text: string[] = [
    `PROPOSAL ${p.project_id} V${pad2(q.version)}`,
    `Quote: ${q.quote_id}`,
    `Template: ${p.template_id}`,
    '',
    'LINE  QTY  DESCRIPTION',
  ];
  for (const li of lines) {
    text.push(
      `${String(li.line_no).padStart(4)}  ${String(li.qty).padStart(3)}  ` +
      `${li.description}  ${formatCents(li.unit_price_cents)}  ` +
      `${formatCents(li.line_total_cents)}`,
    );
  }
  text.push('');
  text.push(`Subtotal: ${formatCents(q.subtotal_cents)}`);
  text.push(`Tax: ${formatCents(q.tax_cents)}`);
  text.push(`Total: ${formatCents(q.total_cents)}`);
  const rendered = text.join('\n') + '\n';
  const contentHash = sha256Canonical({
    project_id: p.project_id, template_id: p.template_id, quote: q, rendered,
  });
  return {
    descriptor: {
      document_id: `doc-proposal-${contentHash.slice(0, 24)}`,
      document_type: 'proposal',
      project_id: p.project_id,
      quote_id: q.quote_id,
      version: q.version,
      template_id: p.template_id,
      filename: `${p.project_id}_PROPOSAL_CLIENT_V${pad2(q.version)}.txt`,
      content_sha256: contentHash,
      mime: 'text/plain',
      line_count: lines.length,
      total_cents: q.total_cents,
    },
    rendered_text: rendered,
  };
}

export function validateProposalRender(params: Record<string, unknown>): ParamsValidation {
  const parsed = parseWith(ProposalRenderParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p: ProposalRenderParams = parsed.data;
  const bad = checkQuoteReconciles(p.quote);
  if (bad) return { ok: false, reason: bad };
  const r = renderProposal(p);
  return {
    ok: true,
    canonical: { kind: 'proposal.document.render', ...r.descriptor },
    binding: {
      project_id: p.project_id,
      document_hash: r.descriptor.content_sha256,
      amount: p.quote.total_cents,
      recipient: null,
    },
  };
}
