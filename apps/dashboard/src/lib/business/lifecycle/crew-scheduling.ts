// Phase 6 - crew scheduling (PROPOSAL ONLY) + site access checklist.
//
// Mirrors public.crew_assignments (migration 0035). proposeCrewAssignment
// is the contract shape for the crew-scheduling capability: it returns a
// deterministic PROPOSAL (state 'proposed') from an availability list.
// Confirmation is a separate human step recorded by the store adapter
// (state 'confirmed', confirmed_by). Nothing here writes a calendar or
// contacts anyone.

import { isIsoTimestamp } from './types';

export interface CrewAvailabilityWindow {
  crew_id: string;
  start: string; // ISO timestamp
  end: string; // ISO timestamp
}

export interface SiteAccess {
  contact_role: string; // e.g. 'super', 'doorman', 'client', 'managing_agent'
  contact_name?: string | null;
  instructions: string;
  coi_required: boolean;
  coi_document_id?: string | null;
  building_rules_document_id?: string | null;
  elevator_reservation?: string | null;
}

export interface SiteAccessChecklistItem {
  key:
    | 'contact_role'
    | 'instructions'
    | 'coi_on_file'
    | 'building_rules_on_file';
  ok: boolean;
  detail: string;
}

export function buildSiteAccessChecklist(
  sa: SiteAccess,
): SiteAccessChecklistItem[] {
  const role = typeof sa.contact_role === 'string' && sa.contact_role.trim();
  const instr = typeof sa.instructions === 'string' && sa.instructions.trim();
  const coiOk = sa.coi_required !== true || Boolean(sa.coi_document_id);
  const rulesOk = Boolean(sa.building_rules_document_id);
  return [
    {
      key: 'contact_role',
      ok: Boolean(role),
      detail: role ? `site contact role: ${role}` : 'site contact role missing',
    },
    {
      key: 'instructions',
      ok: Boolean(instr),
      detail: instr ? 'access instructions present' : 'instructions missing',
    },
    {
      key: 'coi_on_file',
      ok: coiOk,
      detail: sa.coi_required
        ? coiOk
          ? 'COI registered'
          : 'COI required but not registered'
        : 'COI not required',
    },
    {
      key: 'building_rules_on_file',
      ok: rulesOk,
      detail: rulesOk
        ? 'building rules document registered'
        : 'building rules document missing',
    },
  ];
}

export function siteAccessConfirmed(sa: SiteAccess): boolean {
  return buildSiteAccessChecklist(sa).every((i) => i.ok);
}

export interface CrewAssignmentProposal {
  project_id: string;
  crew_id: string;
  scheduled_start: string;
  scheduled_end: string;
  site_access: SiteAccess;
  state: 'proposed';
  confirmed_by: null;
  capability: 'crew_scheduling.propose';
  site_access_checklist: SiteAccessChecklistItem[];
}

export type ProposeCrewResult =
  | { ok: true; proposal: CrewAssignmentProposal }
  | { ok: false; reason: string };

const HOUR_MS = 60 * 60 * 1000;

// Deterministic: windows are ordered by start then crew_id; the first
// window that can hold the whole duration (from max(start, not_before))
// wins. Same inputs always yield the same proposal.
export function proposeCrewAssignment(
  projectId: string,
  availability: CrewAvailabilityWindow[],
  durationHours: number,
  siteAccess: SiteAccess,
  opts: { not_before?: string } = {},
): ProposeCrewResult {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return { ok: false, reason: 'project id required' };
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return { ok: false, reason: 'duration must be a positive number of hours' };
  }
  if (opts.not_before !== undefined && !isIsoTimestamp(opts.not_before)) {
    return { ok: false, reason: 'not_before must be ISO' };
  }
  const floor = opts.not_before ? Date.parse(opts.not_before) : -Infinity;
  const need = durationHours * HOUR_MS;
  const windows = availability
    .filter(
      (w) =>
        typeof w.crew_id === 'string' &&
        w.crew_id.length > 0 &&
        isIsoTimestamp(w.start) &&
        isIsoTimestamp(w.end),
    )
    .sort((a, b) =>
      a.start === b.start
        ? a.crew_id.localeCompare(b.crew_id)
        : a.start.localeCompare(b.start),
    );
  for (const w of windows) {
    const start = Math.max(Date.parse(w.start), floor);
    const end = Date.parse(w.end);
    if (start + need <= end) {
      return {
        ok: true,
        proposal: {
          project_id: projectId,
          crew_id: w.crew_id,
          scheduled_start: new Date(start).toISOString(),
          scheduled_end: new Date(start + need).toISOString(),
          site_access: siteAccess,
          state: 'proposed',
          confirmed_by: null,
          capability: 'crew_scheduling.propose',
          site_access_checklist: buildSiteAccessChecklist(siteAccess),
        },
      };
    }
  }
  return { ok: false, reason: 'no availability window fits the duration' };
}
