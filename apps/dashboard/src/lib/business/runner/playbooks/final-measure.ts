// final_measure v1 - after deposit, schedule the final measure no sooner
// than 3 business days after signing (stage-gates predicate, plan section
// 19), then register the final-measure record. Only final_measure openings
// are PO material; the stage advance is the order-chain lane's decision.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, NO_WORKER, PRED } from './common';

export const FINAL_MEASURE_V1: PlaybookDeclaration = {
  id: 'final_measure',
  version: 1,
  trigger: 'event.deposit_received',
  required_data: ['project.id', 'availability.windows', 'final_measure.ref'],
  allowed_capabilities: [CAP.calendarEventCreate, CAP.documentRegister],
  predicates: [
    PRED.identityConfirmed,
    PRED.gateFinalMeasureAfter3Days,
    PRED.availabilityStaffSelected,
    PRED.openingsFinalValidated,
  ],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.calendarEventCreate]: 'EXTERNAL',
    [CAP.documentRegister]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: { max: 10, backoff_ms: 24 * 60 * 60 * 1000 },
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.gateFinalMeasureAfter3Days]: 'wait',
    [PRED.availabilityStaffSelected]: 'wait',
    [PRED.openingsFinalValidated]: 'block',
  },
  exit_condition: 'final measure recorded and registered; order-chain decides stage',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['deposit_received'] } },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.gateFinalMeasureAfter3Days },
    },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.availabilityStaffSelected },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.calendarEventCreate,
        input_refs: ['final_measure.slot', 'project.id'],
      },
    },
    { kind: 'wait_for_event', args: { event: 'final_measure.recorded' } },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.openingsFinalValidated },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.documentRegister,
        payload: { document_kind: 'final_measure' },
        input_refs: ['final_measure.ref'],
      },
    },
  ],
};
