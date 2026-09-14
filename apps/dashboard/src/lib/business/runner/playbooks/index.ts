// Versioned v1 playbook set (plan section 9 core playbooks in Phase 4
// scope). Later playbooks (order.pending, receiving, install, closeout,
// dispute, lpc.research, reengagement.batch) are out of Phase 4 scope.

import type { PlaybookDeclaration } from '../playbook';
import { CONTRACT_PROCEED_V1 } from './contract-proceed';
import { DEAL_INTELLIGENCE_V1 } from './deal-intelligence';
import { FINAL_MEASURE_V1 } from './final-measure';
import { FOLLOW_UP_V1 } from './follow-up';
import { LEAD_INTAKE_V1 } from './lead-intake';
import { ORDER_CYCLE_V1 } from './order-cycle';
import { QUOTE_CLIENT_V1 } from './quote-client';
import { VENDOR_QUOTE_CYCLE_V1 } from './vendor-quote-cycle';
import { VISIT_RECAP_V1 } from './visit-recap';
import { VISIT_SCHEDULE_V1 } from './visit-schedule';

export const PLAYBOOKS_V1: readonly PlaybookDeclaration[] = Object.freeze([
  LEAD_INTAKE_V1,
  DEAL_INTELLIGENCE_V1,
  VISIT_SCHEDULE_V1,
  VISIT_RECAP_V1,
  VENDOR_QUOTE_CYCLE_V1,
  QUOTE_CLIENT_V1,
  FOLLOW_UP_V1,
  CONTRACT_PROCEED_V1,
  FINAL_MEASURE_V1,
  ORDER_CYCLE_V1,
]);

export function findPlaybook(
  id: string,
  version: number,
): PlaybookDeclaration | null {
  return (
    PLAYBOOKS_V1.find((p) => p.id === id && p.version === version) ?? null
  );
}

export {
  CONTRACT_PROCEED_V1,
  DEAL_INTELLIGENCE_V1,
  FINAL_MEASURE_V1,
  FOLLOW_UP_V1,
  LEAD_INTAKE_V1,
  ORDER_CYCLE_V1,
  QUOTE_CLIENT_V1,
  VENDOR_QUOTE_CYCLE_V1,
  VISIT_RECAP_V1,
  VISIT_SCHEDULE_V1,
};
export { CAP, PRED } from './common';
