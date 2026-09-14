// visit.recap v1 - after a site visit the recap form yields normalized
// openings (sales/openings.ts). The recap document is registered and the
// project advances to measured. Site-visit openings are estimate-grade.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, NO_WORKER, PRED } from './common';

export const VISIT_RECAP_V1: PlaybookDeclaration = {
  id: 'visit.recap',
  version: 1,
  trigger: 'event.visit_completed',
  required_data: ['project.id', 'visit.recap_ref'],
  allowed_capabilities: [CAP.documentRegister, CAP.timelineEventRecord],
  predicates: [PRED.identityConfirmed, PRED.openingsNormalized],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.documentRegister]: 'INTERNAL',
    [CAP.timelineEventRecord]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: { max: 5, backoff_ms: 12 * 60 * 60 * 1000 },
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.openingsNormalized]: 'block',
    'event.visit.recap_submitted.timeout': 'wait',
  },
  exit_condition: 'recap registered, openings normalized, stage measured',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['visit_scheduled'] } },
    {
      kind: 'wait_for_event',
      args: { event: 'visit.recap_submitted', timeout_hours: 72 },
    },
    { kind: 'evaluate_gate', args: { predicate: PRED.openingsNormalized } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.documentRegister,
        payload: { document_kind: 'visit_recap' },
        input_refs: ['visit.recap_ref'],
      },
    },
    { kind: 'advance_state', args: { to: 'measured' } },
  ],
};
