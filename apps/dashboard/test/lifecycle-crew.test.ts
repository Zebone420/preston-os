import { describe, expect, it } from 'vitest';
import {
  buildSiteAccessChecklist,
  proposeCrewAssignment,
  siteAccessConfirmed,
  type CrewAvailabilityWindow,
  type SiteAccess,
} from '../src/lib/business/lifecycle/crew-scheduling';

const P = '00000000-0000-4000-8000-0000000000aa';
const DOC = '00000000-0000-4000-8000-0000000000d1';

const access: SiteAccess = {
  contact_role: 'super',
  instructions: 'service entrance, freight elevator 9-4',
  coi_required: true,
  coi_document_id: DOC,
  building_rules_document_id: DOC,
};

const windows: CrewAvailabilityWindow[] = [
  { crew_id: 'crew-b', start: '2026-09-10T13:00:00.000Z',
    end: '2026-09-10T17:00:00.000Z' },
  { crew_id: 'crew-a', start: '2026-09-10T13:00:00.000Z',
    end: '2026-09-10T22:00:00.000Z' },
  { crew_id: 'crew-c', start: '2026-09-09T13:00:00.000Z',
    end: '2026-09-09T15:00:00.000Z' },
];

describe('proposeCrewAssignment', () => {
  it('is deterministic regardless of input order', () => {
    const a = proposeCrewAssignment(P, windows, 6, access);
    const b = proposeCrewAssignment(P, [...windows].reverse(), 6, access);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.proposal.crew_id).toBe('crew-a');
      expect(a.proposal.scheduled_start).toBe('2026-09-10T13:00:00.000Z');
      expect(a.proposal.scheduled_end).toBe('2026-09-10T19:00:00.000Z');
      expect(a.proposal.state).toBe('proposed');
      expect(a.proposal.confirmed_by).toBeNull();
      expect(a.proposal.capability).toBe('crew_scheduling.propose');
    }
  });

  it('picks the earliest fitting window; ties break on crew_id', () => {
    const r = proposeCrewAssignment(P, windows, 2, access);
    expect(r.ok && r.proposal.crew_id).toBe('crew-c');
    const r2 = proposeCrewAssignment(P, windows, 3, access);
    expect(r2.ok && r2.proposal.crew_id).toBe('crew-a');
  });

  it('honours not_before by shifting the start inside the window', () => {
    const r = proposeCrewAssignment(P, windows, 2, access, {
      not_before: '2026-09-10T15:00:00.000Z',
    });
    expect(r.ok && r.proposal.scheduled_start).toBe('2026-09-10T15:00:00.000Z');
    expect(r.ok && r.proposal.crew_id).toBe('crew-a');
  });

  it('fails closed on no fit, bad duration, bad windows, bad project', () => {
    expect(proposeCrewAssignment(P, windows, 10, access).ok).toBe(false);
    expect(proposeCrewAssignment(P, windows, 0, access).ok).toBe(false);
    expect(proposeCrewAssignment(P, windows, NaN, access).ok).toBe(false);
    expect(proposeCrewAssignment('', windows, 1, access).ok).toBe(false);
    expect(proposeCrewAssignment(P, [{ crew_id: 'x', start: 'soon',
      end: 'later' }], 1, access).ok).toBe(false);
    expect(proposeCrewAssignment(P, windows, 1, access,
      { not_before: 'tomorrow' }).ok).toBe(false);
  });

  it('carries the site access checklist on the proposal', () => {
    const r = proposeCrewAssignment(P, windows, 1, access);
    expect(r.ok && r.proposal.site_access_checklist.every((i) => i.ok))
      .toBe(true);
  });
});

describe('site access checklist', () => {
  it('passes when role, instructions, COI and building rules are present', () => {
    expect(siteAccessConfirmed(access)).toBe(true);
    expect(buildSiteAccessChecklist(access).map((i) => i.key)).toEqual([
      'contact_role', 'instructions', 'coi_on_file', 'building_rules_on_file',
    ]);
  });

  it('COI is only required when flagged', () => {
    const noCoi: SiteAccess = { ...access, coi_required: false,
      coi_document_id: null };
    expect(siteAccessConfirmed(noCoi)).toBe(true);
    const missingCoi: SiteAccess = { ...access, coi_document_id: null };
    const item = buildSiteAccessChecklist(missingCoi)
      .find((i) => i.key === 'coi_on_file');
    expect(item?.ok).toBe(false);
    expect(siteAccessConfirmed(missingCoi)).toBe(false);
  });

  it('blocks on missing role, instructions, or building rules', () => {
    expect(siteAccessConfirmed({ ...access, contact_role: ' ' })).toBe(false);
    expect(siteAccessConfirmed({ ...access, instructions: '' })).toBe(false);
    expect(siteAccessConfirmed({ ...access,
      building_rules_document_id: null })).toBe(false);
  });
});
