// Phase 6 - install state machine with guards (pure, deterministic).
//
// Mirrors public.install_states (migration 0035): one row per project,
// state + state_changed_at + evidence jsonb. Transitions are strictly
// forward, one step at a time:
//   not_ready -> ready -> scheduled -> in_progress -> installed ->
//   punch_open -> punch_closed -> closed_out -> warranty_registered ->
//   archived
// Each step has a guard over facts the caller already read. Refusals
// return a reason and NO new record. The evidence object returned on
// success is what the adapter persists (CAS on the prior state).

import { punchClosurePredicate, type PunchItem } from './punch';
import {
  INSTALL_STATES,
  isIsoTimestamp,
  type CrewAssignmentState,
  type DocumentRef,
  type InstallState,
} from './types';

export const INSTALLATION_PHOTO_DOCUMENT_TYPE = 'installation_photo';

export interface InstallStateRecord {
  project_id: string;
  state: InstallState;
  state_changed_at: string;
  evidence: Record<string, unknown>;
}

export interface InstallGuardFacts {
  readiness_all_ok: boolean;
  crew_assignment_state: CrewAssignmentState | null;
  documents: DocumentRef[];
  punch_items: PunchItem[];
  // completion certificate + final photos registered (see closeout.ts)
  closeout_docs_present: boolean;
  warranty_registered_at: string | null;
  // archivePlan(...).missing from closeout.ts
  archive_missing_document_types: string[];
}

export type GuardResult =
  | { ok: true; evidence: Record<string, unknown> }
  | { ok: false; reason: string };

export type TransitionResult =
  | { ok: true; record: InstallStateRecord }
  | { ok: false; reason: string };

export function initialInstallState(
  projectId: string,
  at: string,
): InstallStateRecord {
  return {
    project_id: projectId,
    state: 'not_ready',
    state_changed_at: at,
    evidence: {},
  };
}

export function nextInstallState(state: InstallState): InstallState | null {
  const i = INSTALL_STATES.indexOf(state);
  if (i < 0 || i + 1 >= INSTALL_STATES.length) return null;
  return INSTALL_STATES[i + 1];
}

export function installStateAtLeast(
  state: InstallState,
  floor: InstallState,
): boolean {
  return INSTALL_STATES.indexOf(state) >= INSTALL_STATES.indexOf(floor);
}

function currentDocIds(docs: DocumentRef[], type: string): string[] {
  return docs
    .filter((d) => d.document_type === type && d.is_current === true)
    .map((d) => d.id);
}

export function guardInstallTransition(
  from: InstallState,
  to: InstallState,
  facts: InstallGuardFacts,
): GuardResult {
  if (nextInstallState(from) !== to) {
    return { ok: false, reason: `${from} -> ${to} is not the next step` };
  }
  switch (to) {
    case 'ready':
      if (!facts.readiness_all_ok) {
        return { ok: false, reason: 'install readiness check not all_ok' };
      }
      return { ok: true, evidence: { readiness_all_ok: true } };
    case 'scheduled':
      if (facts.crew_assignment_state !== 'confirmed') {
        return { ok: false, reason: 'crew assignment must be confirmed' };
      }
      return { ok: true, evidence: { crew_assignment_state: 'confirmed' } };
    case 'in_progress':
      if (
        facts.crew_assignment_state !== 'confirmed' &&
        facts.crew_assignment_state !== 'in_progress'
      ) {
        return { ok: false, reason: 'crew assignment not active' };
      }
      return {
        ok: true,
        evidence: { crew_assignment_state: facts.crew_assignment_state },
      };
    case 'installed': {
      const photos = currentDocIds(
        facts.documents,
        INSTALLATION_PHOTO_DOCUMENT_TYPE,
      );
      if (photos.length < 1) {
        return {
          ok: false,
          reason: 'at least one installation_photo document must be registered',
        };
      }
      return { ok: true, evidence: { installation_photo_document_ids: photos } };
    }
    case 'punch_open':
      return {
        ok: true,
        evidence: { punch_item_count: facts.punch_items.length },
      };
    case 'punch_closed': {
      const closure = punchClosurePredicate(facts.punch_items);
      if (!closure.ok) {
        return {
          ok: false,
          reason: 'open punch items block closure: ' +
            closure.blocked_by.join(','),
        };
      }
      return {
        ok: true,
        evidence: {
          punch_item_count: facts.punch_items.length,
          waived_item_ids: facts.punch_items
            .filter((p) => p.state === 'waived_by_owner')
            .map((p) => p.id),
        },
      };
    }
    case 'closed_out':
      if (!facts.closeout_docs_present) {
        return {
          ok: false,
          reason: 'completion certificate and final photos must be registered',
        };
      }
      return { ok: true, evidence: { closeout_docs_present: true } };
    case 'warranty_registered':
      if (!isIsoTimestamp(facts.warranty_registered_at)) {
        return { ok: false, reason: 'Andersen warranty registration not recorded' };
      }
      return {
        ok: true,
        evidence: { warranty_registered_at: facts.warranty_registered_at },
      };
    case 'archived':
      if (facts.archive_missing_document_types.length > 0) {
        return {
          ok: false,
          reason: 'documents missing before archive: ' +
            facts.archive_missing_document_types.join(','),
        };
      }
      return { ok: true, evidence: { archive_plan_complete: true } };
    default:
      return { ok: false, reason: `no guard for ${to}` };
  }
}

export function transitionInstallState(
  record: InstallStateRecord,
  to: InstallState,
  facts: InstallGuardFacts,
  at: string,
): TransitionResult {
  if (!isIsoTimestamp(at)) return { ok: false, reason: 'timestamp required' };
  const g = guardInstallTransition(record.state, to, facts);
  if (!g.ok) return g;
  return {
    ok: true,
    record: {
      project_id: record.project_id,
      state: to,
      state_changed_at: at,
      evidence: { ...g.evidence, from: record.state },
    },
  };
}
