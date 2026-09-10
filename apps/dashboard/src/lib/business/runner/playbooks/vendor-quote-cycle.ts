// vendor.quote_cycle v1 - scope -> vendor quote request (EXTERNAL) ->
// parsed + reconciled vendor quote. The contact-leak predicate (comms
// lane) must be clear before anything vendor-facing is proposed (plan
// section 19: customer contact must not leak into vendor material).

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const VENDOR_QUOTE_CYCLE_V1: PlaybookDeclaration = {
  id: 'vendor.quote_cycle',
  version: 1,
  trigger: 'stage.measured',
  required_data: ['project.id', 'scope.ref', 'vendor.request_ref'],
  allowed_capabilities: [
    CAP.vendorQuoteRequestSend,
    CAP.vendorQuoteParse,
    CAP.vendorQuoteReconcile,
  ],
  predicates: [
    PRED.identityConfirmed,
    PRED.scopeBuilt,
    PRED.contactLeakClear,
    PRED.vendorQuoteReconciled,
  ],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.vendorQuoteRequestSend]: 'EXTERNAL',
    [CAP.vendorQuoteParse]: 'INTERNAL',
    [CAP.vendorQuoteReconcile]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.scopeBuilt]: 'wait',
    [PRED.contactLeakClear]: 'block',
    [PRED.vendorQuoteReconciled]: 'block',
    'event.vendor.quote.received.timeout': 'wait',
  },
  exit_condition: 'vendor quote parsed and reconciled against scope',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['measured', 'quoted'] } },
    { kind: 'evaluate_gate', args: { predicate: PRED.scopeBuilt } },
    { kind: 'evaluate_gate', args: { predicate: PRED.contactLeakClear } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.vendorQuoteRequestSend,
        input_refs: ['scope.ref', 'vendor.request_ref'],
      },
    },
    {
      kind: 'wait_for_event',
      args: { event: 'vendor.quote.received', timeout_hours: 120 },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.vendorQuoteParse,
        input_refs: ['vendor.quote_document_ref'],
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.vendorQuoteReconcile,
        input_refs: ['scope.ref', 'vendor.quote_parsed_ref'],
      },
    },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.vendorQuoteReconciled },
    },
  ],
};
