// contract.proceed v1 - accepted proposal -> contract package render ->
// owner approval -> DocuSign envelope PROPOSAL (STEP_UP). This playbook
// ENDS at the proposal: contract_signed / deposit_received are advanced
// by the order-chain lane from verified provider evidence, never here.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const CONTRACT_PROCEED_V1: PlaybookDeclaration = {
  id: 'contract.proceed',
  version: 1,
  trigger: 'event.proposal_accepted',
  required_data: ['project.id', 'proposal.document_ref', 'quote.version'],
  allowed_capabilities: [CAP.contractPackageRender, CAP.docusignEnvelopeSend],
  predicates: [PRED.identityConfirmed, PRED.gateContractProviderVerified],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.contractPackageRender]: 'INTERNAL',
    [CAP.docusignEnvelopeSend]: 'STEP_UP',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.gateContractProviderVerified]: 'block',
  },
  exit_condition:
    'docusign envelope proposal emitted with STEP_UP class; ' +
    'signature and deposit states are advanced by order-chain evidence',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['proposal_sent', 'accepted'] } },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.gateContractProviderVerified },
    },
    {
      kind: 'render_document',
      args: {
        capability_id: CAP.contractPackageRender,
        document_kind: 'contract_package',
        template: 'contract_package_v1',
        input_refs: ['proposal.document_ref', 'quote.version'],
      },
    },
    {
      kind: 'wait_for_event',
      args: { event: 'owner.approval.contract_package' },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.docusignEnvelopeSend,
        input_refs: ['contract.package_ref'],
      },
    },
  ],
};
