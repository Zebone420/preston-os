// deal.intelligence v1 - deterministic detector findings (comms lane, the
// 12 detectors) are recorded as findings + timeline events. Read/derive
// only; nothing leaves Preston.

import type { PlaybookDeclaration } from '../playbook';
import { CAP, DEFAULT_RETRIES, NO_WORKER, PRED } from './common';

export const DEAL_INTELLIGENCE_V1: PlaybookDeclaration = {
  id: 'deal.intelligence',
  version: 1,
  trigger: 'schedule.daily_or_detector_event',
  required_data: ['project.id', 'detector.findings_ref'],
  allowed_capabilities: [CAP.dealFindingRecord, CAP.timelineEventRecord],
  predicates: [PRED.identityConfirmed, PRED.detectorFindings],
  worker_use: NO_WORKER,
  approvals: {
    [CAP.dealFindingRecord]: 'INTERNAL',
    [CAP.timelineEventRecord]: 'INTERNAL',
  },
  evidence_policy: 'proposals_and_exceptions',
  retries: DEFAULT_RETRIES,
  exception_routes: {
    [PRED.identityConfirmed]: 'block',
    [PRED.detectorFindings]: 'complete',
  },
  exit_condition: 'findings and timeline events recorded for the project',
  steps: [
    { kind: 'check_identity', args: { predicate: PRED.identityConfirmed } },
    { kind: 'evaluate_gate', args: { predicate: PRED.detectorFindings } },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.dealFindingRecord,
        input_refs: ['detector.findings_ref'],
      },
    },
    {
      kind: 'propose_capability',
      args: {
        capability_id: CAP.timelineEventRecord,
        payload: { event: 'deal_intelligence_recorded' },
      },
    },
  ],
};
