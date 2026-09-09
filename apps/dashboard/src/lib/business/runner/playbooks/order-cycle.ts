// order.cycle v1 - order eligibility (order-chain lane) + PO hash bound to
// the final measure + contact-leak clear -> PO render -> owner approval
// -> vendor.order.place PROPOSAL (STEP_UP). This playbook ENDS at the
// proposal; the 'ordered' stage is advanced by order-chain evidence only.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const ORDER_CYCLE_V1: PlaybookDeclaration = {
  id: 'order.cycle',
  version: 1,
  trigger: 'event.final_measure_approved',
  required_data: ['project.id', 'final_measure.ref', 'po.line_items_ref'],
  allowed_capabilities: [CAP.poRender, CAP.vendorOrderPlace],
  predicates: [
    PRED.identityConfirmed,
    PRED.orderEligibility,
    PRED.gatePoHashBound,
    PRED.contactLeakClear,
  ],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.poRender]: 'INTERNAL',
    [CAP.vendorOrderPlace]: 'STEP_UP',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.orderEligibility]: 'block',
    [PRED.gatePoHashBound]: 'block',
    [PRED.contactLeakClear]: 'block',
  },
  exit_condition:
    'vendor order proposal emitted with STEP_UP class; ' +
    'ordered state is advanced by order-chain evidence only',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['final_measured', 'order_ready'] } },
    { kind: 'evaluate_gate', args: { predicate: PRED.orderEligibility } },
    { kind: 'evaluate_gate', args: { predicate: PRED.gatePoHashBound } },
    { kind: 'evaluate_gate', args: { predicate: PRED.contactLeakClear } },
    {
      kind: 'render_document',
      args: {
        capability_id: CAP.poRender,
        document_kind: 'purchase_order',
        template: 'po_v1',
        input_refs: ['final_measure.ref', 'po.line_items_ref'],
      },
    },
    { kind: 'wait_for_event', args: { event: 'owner.approval.po' } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.vendorOrderPlace,
        input_refs: ['po.document_ref'],
      },
    },
  ],
};
