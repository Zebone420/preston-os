// visit.schedule v1 - scheduling minimum (plan PHASE 4): staff-selected
// availability -> calendar event (EXTERNAL, gated) -> confirmation DRAFT
// with selection guide -> stage visit_scheduled.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const VISIT_SCHEDULE_V1: PlaybookDeclaration = {
  id: 'visit.schedule',
  version: 1,
  trigger: 'stage.qualified',
  required_data: ['project.id', 'availability.windows', 'visit.slot'],
  allowed_capabilities: [CAP.calendarEventCreate, CAP.gmailDraft],
  predicates: [
    PRED.identityConfirmed,
    PRED.availabilityStaffSelected,
    PRED.visitSlotSelected,
  ],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.calendarEventCreate]: 'EXTERNAL',
    [CAP.gmailDraft]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.availabilityStaffSelected]: 'wait',
    [PRED.visitSlotSelected]: 'wait',
  },
  exit_condition: 'calendar event proposed, confirmation drafted, stage visit_scheduled',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_stage', args: { any_of: ['lead', 'qualified'] } },
    {
      kind: 'evaluate_gate',
      args: { predicate: PRED.availabilityStaffSelected },
    },
    { kind: 'evaluate_gate', args: { predicate: PRED.visitSlotSelected } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.calendarEventCreate,
        input_refs: ['visit.slot', 'project.id'],
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.gmailDraft,
        payload: { template: 'visit_confirmation_with_selection_guide' },
        input_refs: ['visit.slot'],
      },
    },
    { kind: 'advance_state', args: { to: 'visit_scheduled' } },
  ],
};
