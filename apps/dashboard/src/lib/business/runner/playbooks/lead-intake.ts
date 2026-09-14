// lead.intake v1 - a parsed inbound lead (comms lane andersen-lead /
// google-voice parsers) becomes a project-match proposal, a lead stage
// record, and an acknowledgement DRAFT. Nothing is sent by this playbook.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const LEAD_INTAKE_V1: PlaybookDeclaration = {
  id: 'lead.intake',
  version: 1,
  trigger: 'comms.parser.lead_detected',
  required_data: ['lead.source_ref', 'lead.contact_ref', 'lead.property_hint'],
  allowed_capabilities: [
    CAP.projectMatchPropose,
    CAP.timelineEventRecord,
    CAP.gmailDraft,
  ],
  predicates: [PRED.leadParsed, PRED.projectMatchResolved],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.projectMatchPropose]: 'INTERNAL',
    [CAP.timelineEventRecord]: 'INTERNAL',
    [CAP.gmailDraft]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.leadParsed]: 'block',
    [PRED.projectMatchResolved]: 'wait',
  },
  exit_condition: 'lead recorded at stage lead and acknowledgement drafted',
  steps: [
    { kind: 'evaluate_gate', args: { predicate: PRED.leadParsed } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.projectMatchPropose,
        input_refs: ['lead.source_ref', 'lead.contact_ref'],
      },
    },
    { kind: 'evaluate_gate', args: { predicate: PRED.projectMatchResolved } },
    { kind: 'advance_state', args: { to: 'lead' } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.timelineEventRecord,
        payload: { event: 'lead_received' },
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.gmailDraft,
        payload: { template: 'lead_acknowledgement' },
        input_refs: ['lead.contact_ref'],
      },
    },
  ],
};
