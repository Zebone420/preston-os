// quote.client v1 - deterministic price engine output (quote-engine.ts;
// arithmetic is never authored by an LLM) -> proposal render -> owner
// approval -> client send (EXTERNAL) -> follow-up clock armed.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const QUOTE_CLIENT_V1: PlaybookDeclaration = {
  id: 'quote.client',
  version: 1,
  trigger: 'event.vendor_quote_reconciled',
  required_data: ['project.id', 'quote.calculation_ref', 'quote.version'],
  allowed_capabilities: [
    CAP.proposalRender,
    CAP.gmailDraft,
    CAP.gmailSend,
    CAP.followUpClockArm,
  ],
  predicates: [
    PRED.identityConfirmed,
    PRED.quoteEngineCalculated,
    PRED.quoteArithmeticValidated,
  ],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.proposalRender]: 'INTERNAL',
    [CAP.gmailDraft]: 'INTERNAL',
    [CAP.gmailSend]: 'EXTERNAL',
    [CAP.followUpClockArm]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.quoteEngineCalculated]: 'block',
    [PRED.quoteArithmeticValidated]: 'block',
  },
  exit_condition: 'proposal sent after owner approval; follow-up clock armed',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['measured', 'quoted'] } },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.quoteEngineCalculated },
    },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.quoteArithmeticValidated },
    },
    {
      kind: 'render_document',
      args: {
        capability_id: CAP.proposalRender,
        document_kind: 'proposal',
        template: 'proposal_v1',
        input_refs: ['quote.calculation_ref', 'quote.version'],
      },
    },
    { kind: 'advance_state', args: { to: 'quoted' } },
    { kind: 'wait_for_event', args: { event: 'owner.approval.quote' } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.gmailDraft,
        payload: { template: 'proposal_cover' },
        input_refs: ['proposal.document_ref'],
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.gmailSend,
        input_refs: ['proposal.draft_ref'],
      },
    },
    { kind: 'advance_state', args: { to: 'proposal_sent' } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.followUpClockArm,
        payload: { subject_type: 'proposal', schedule: 'h48' },
        input_refs: ['quote.version'],
      },
    },
  ],
};
