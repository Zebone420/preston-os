// follow_up v1 - when a follow-up clock is due and no inbound reply has
// arrived, draft + send (EXTERNAL) a touch and record it on the clock.
// The clock itself (sales/follow-up-clocks.ts) never auto-closes: after
// max touches it hands the owner the final call.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const FOLLOW_UP_V1: PlaybookDeclaration = {
  id: 'follow_up',
  version: 1,
  trigger: 'clock.due',
  required_data: ['project.id', 'clock.id', 'proposal.document_ref'],
  allowed_capabilities: [CAP.gmailDraft, CAP.gmailSend, CAP.followUpClockTouch],
  predicates: [PRED.identityConfirmed, PRED.inboundReplyAbsent],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.gmailDraft]: 'INTERNAL',
    [CAP.gmailSend]: 'EXTERNAL',
    [CAP.followUpClockTouch]: 'INTERNAL',
  },
  evidence_policy: 'every_step',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    // A reply arrived: the clock pauses; this run is done.
    [PRED.inboundReplyAbsent]: 'complete',
    'clock.proposal': 'wait',
  },
  exit_condition: 'one touch sent and recorded, or reply detected',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'check_clock', args: { clock: 'proposal', expect: 'due' } },
    { kind: 'evaluate_gate', args: { predicate: PRED.inboundReplyAbsent } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.gmailDraft,
        payload: { template: 'follow_up_touch' },
        input_refs: ['proposal.document_ref'],
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.gmailSend,
        input_refs: ['follow_up.draft_ref'],
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.followUpClockTouch,
        input_refs: ['clock.id'],
      },
    },
  ],
};
