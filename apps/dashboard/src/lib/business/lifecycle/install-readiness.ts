// Phase 6 - install readiness predicates (pure, deterministic).
//
// Mirrors public.install_readiness_checks (migration 0035): each
// evaluation is an append-only evidence row. Every predicate is a plain
// boolean over facts the caller has already read from the SSOT; this
// module reads nothing itself. Any false predicate lands in blocked_by
// and all_ok is false. The payment predicate is an INPUT FLAG derived by
// the order-chain payment state (pre_install milestone received); this
// module never inspects money.
//
// Vendor-facing rule (plan section 19): PRESTON coordinates delivery in
// its own name. The client contact is required here only so the INSTALL
// can be scheduled with the client; it is never part of any vendor
// material.

import { allUnitsReceived, type ReceivingState } from './receiving';
import type { CrewAssignmentState, DocumentRef } from './types';

export const READINESS_PREDICATES = [
  'all_units_received',
  'site_access_confirmed',
  'crew_confirmed',
  'building_approval_on_file',
  'final_measure_bound',
  'payment_condition_for_install',
  'client_contact_present_for_scheduling',
] as const;
export type ReadinessPredicate = (typeof READINESS_PREDICATES)[number];

export const BUILDING_APPROVAL_DOCUMENT_TYPE = 'lpc_dob_building';

export interface SchedulingContact {
  name: string;
  phone: string;
}

export interface InstallReadinessFacts {
  project_id: string;
  evaluated_at: string;
  receiving: ReceivingState;
  site_access_confirmed: boolean;
  crew_assignment_state: CrewAssignmentState | null;
  documents: DocumentRef[];
  // false only when the property needs no LPC/DOB/building approval.
  building_approval_required: boolean;
  approved_measurement_version: number | null;
  installing_measurement_version: number | null;
  // Order-chain payment state says the pre_install milestone is received.
  pre_install_payment_received: boolean;
  client_contact: SchedulingContact | null;
}

export interface InstallReadinessCheck {
  project_id: string;
  evaluated_at: string;
  predicates: Record<ReadinessPredicate, boolean>;
  all_ok: boolean;
  blocked_by: ReadinessPredicate[];
}

export function hasCurrentDocument(
  docs: DocumentRef[],
  documentType: string,
): boolean {
  return docs.some(
    (d) => d.document_type === documentType && d.is_current === true,
  );
}

function contactPresent(c: SchedulingContact | null): boolean {
  return (
    c !== null &&
    typeof c.name === 'string' &&
    c.name.trim().length > 0 &&
    typeof c.phone === 'string' &&
    c.phone.trim().length > 0
  );
}

function measureBound(facts: InstallReadinessFacts): boolean {
  const approved = facts.approved_measurement_version;
  const installing = facts.installing_measurement_version;
  return (
    typeof approved === 'number' &&
    Number.isInteger(approved) &&
    approved >= 1 &&
    installing === approved
  );
}

export function evaluateInstallReadiness(
  facts: InstallReadinessFacts,
): InstallReadinessCheck {
  const predicates: Record<ReadinessPredicate, boolean> = {
    all_units_received: allUnitsReceived(facts.receiving),
    site_access_confirmed: facts.site_access_confirmed === true,
    crew_confirmed:
      facts.crew_assignment_state === 'confirmed' ||
      facts.crew_assignment_state === 'in_progress',
    building_approval_on_file:
      facts.building_approval_required === false ||
      hasCurrentDocument(facts.documents, BUILDING_APPROVAL_DOCUMENT_TYPE),
    final_measure_bound: measureBound(facts),
    payment_condition_for_install:
      facts.pre_install_payment_received === true,
    client_contact_present_for_scheduling: contactPresent(
      facts.client_contact,
    ),
  };
  const blocked_by = READINESS_PREDICATES.filter((p) => !predicates[p]);
  return {
    project_id: facts.project_id,
    evaluated_at: facts.evaluated_at,
    predicates,
    all_ok: blocked_by.length === 0,
    blocked_by,
  };
}
