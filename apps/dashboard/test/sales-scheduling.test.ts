// Scheduling minimum: deterministic first-fit, buffers, business hours,
// attendee allowlist refusal, draft shapes.

import { describe, expect, it } from 'vitest';
import {
  buildCalendarEventDraft,
  buildSelectionGuide,
  selectVisitSlot,
  type AvailabilityWindow,
  type ProjectRef,
  type SlotConstraints,
} from '../src/lib/business/sales/scheduling';

const HOURS = { start_hour: 9, end_hour: 17, utc_offset_minutes: 0 };
const C: SlotConstraints = {
  duration_min: 90,
  travel_buffer_min: 30,
  business_hours: HOURS,
};
const windows: AvailabilityWindow[] = [
  { start: '2026-09-10T13:00:00.000Z', end: '2026-09-10T16:00:00.000Z', staff: 'staff-b' },
  { start: '2026-09-09T14:00:00.000Z', end: '2026-09-09T15:00:00.000Z', staff: 'staff-a' },
  { start: '2026-09-10T13:00:00.000Z', end: '2026-09-10T17:00:00.000Z', staff: 'staff-a' },
];
const PROJECT: ProjectRef = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_code: 'P-TEST-001',
  address_line: '1 Example Street, Test City',
  visit_kind: 'site_visit',
};

describe('selectVisitSlot - first fit', () => {
  it('skips a window too short for buffer+duration+buffer and picks the earliest fit', () => {
    const r = selectVisitSlot(windows, C);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 09-09 window is only 60 min: cannot hold 30+90+30. Next earliest start
    // is 09-10 13:00 shared by two staff; ties resolve by staff id (staff-a).
    expect(r.slot.staff).toBe('staff-a');
    expect(r.slot.start).toBe('2026-09-10T13:30:00.000Z');
    expect(r.slot.end).toBe('2026-09-10T15:00:00.000Z');
    expect(r.slot.buffer_before).toBe('2026-09-10T13:00:00.000Z');
    expect(r.slot.buffer_after).toBe('2026-09-10T15:30:00.000Z');
    expect(r.slot.window_index).toBe(2);
    expect(selectVisitSlot([...windows].reverse(), C)).toEqual({
      ...r, slot: { ...r.slot, window_index: 0 },
    });
  });
  it('honors earliest and business hours (snaps up, refuses past closing)', () => {
    const early = selectVisitSlot(
      [{ start: '2026-09-11T05:00:00.000Z', end: '2026-09-11T12:00:00.000Z', staff: 's' }],
      C,
    );
    expect(early.ok && early.slot.start).toBe('2026-09-11T09:00:00.000Z');
    const late = selectVisitSlot(
      [{ start: '2026-09-11T16:00:00.000Z', end: '2026-09-11T20:00:00.000Z', staff: 's' }],
      C,
    );
    expect(late).toEqual({ ok: false, reason: 'no_fit' });
    const bounded = selectVisitSlot(windows, { ...C, earliest: '2026-09-10T14:00:00.000Z' });
    expect(bounded.ok && bounded.slot.start).toBe('2026-09-10T14:00:00.000Z');
    // Both 13:00 windows fit at 14:00; the tie resolves by staff id.
    expect(bounded.ok && bounded.slot.staff).toBe('staff-a');
    // A later earliest leaves only staff-a's longer window able to hold the visit.
    const tight = selectVisitSlot(windows, { ...C, earliest: '2026-09-10T15:00:00.000Z' });
    expect(tight.ok && tight.slot.staff).toBe('staff-a');
    expect(tight.ok && tight.slot.buffer_after).toBe('2026-09-10T17:00:00.000Z');
  });
  it('applies the utc offset to business hours', () => {
    const r = selectVisitSlot(
      [{ start: '2026-09-11T12:00:00.000Z', end: '2026-09-11T20:00:00.000Z', staff: 's' }],
      { ...C, business_hours: { ...HOURS, utc_offset_minutes: -240 } },
    );
    // 12:00Z is 08:00 local (UTC-4); first fit snaps to 09:00 local = 13:00Z.
    expect(r.ok && r.slot.start).toBe('2026-09-11T13:00:00.000Z');
  });
  it('fails closed on empty or invalid input', () => {
    expect(selectVisitSlot([], C)).toEqual({ ok: false, reason: 'no_availability' });
    expect(selectVisitSlot(windows, { ...C, duration_min: 0 }).ok).toBe(false);
    expect(selectVisitSlot(windows, {
      ...C, business_hours: { ...HOURS, start_hour: 17 },
    }).ok).toBe(false);
    expect(selectVisitSlot(
      [{ start: 'bad', end: '2026-09-11T20:00:00.000Z', staff: 's' }], C,
    )).toEqual({ ok: false, reason: 'no_fit' });
  });
});

describe('buildCalendarEventDraft - allowlist and shapes', () => {
  const slot = (() => {
    const r = selectVisitSlot(windows, C);
    if (!r.ok) throw new Error('fixture');
    return r.slot;
  })();
  const ALLOW = ['client@example.test', 'staff@preston.example'];
  it('builds the calendar.event.create payload and the confirmation draft', () => {
    const r = buildCalendarEventDraft(PROJECT, slot, [
      { email: 'Client@Example.test', role: 'client' },
      { email: 'staff@preston.example', role: 'preston' },
    ], ALLOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.capability_id).toBe('calendar.event.create');
    expect(r.draft.approval_class).toBe('EXTERNAL');
    expect(r.draft.payload.attendees).toEqual([
      { email: 'client@example.test', role: 'client' },
      { email: 'staff@preston.example', role: 'preston' },
    ]);
    expect(r.draft.payload.start).toBe(slot.start);
    expect(r.draft.payload.external_ref).toBe('preston:P-TEST-001:site_visit');
    expect(r.draft.confirmation_draft.capability_id).toBe('gmail.message.draft');
    expect(r.draft.confirmation_draft.to).toEqual(['client@example.test']);
    expect(r.draft.confirmation_draft.body_text).toContain('P-TEST-001');
  });
  it('refuses any attendee outside the allowlist - no partial event', () => {
    const r = buildCalendarEventDraft(PROJECT, slot, [
      { email: 'client@example.test', role: 'client' },
      { email: 'vendor@somewhere.test', role: 'client' },
      { email: 'staff@preston.example', role: 'preston' },
    ], ALLOW);
    expect(r).toEqual({
      ok: false, reason: 'attendee_not_allowlisted', rejected: ['vendor@somewhere.test'],
    });
    const noPreston = buildCalendarEventDraft(PROJECT, slot, [
      { email: 'client@example.test', role: 'client' },
    ], ALLOW);
    expect(noPreston.ok).toBe(false);
    const badRole = buildCalendarEventDraft(PROJECT, slot, [
      { email: 'staff@preston.example', role: 'vendor' as never },
    ], ALLOW);
    expect(badRole.ok).toBe(false);
  });
  it('selection guide is pure text and only lists caller-provided series', () => {
    const g = buildSelectionGuide(PROJECT, slot, { series_options: ['FX (fixture)'] });
    expect(g).toContain('site visit for project P-TEST-001');
    expect(g).toContain('- FX (fixture)');
    expect(buildSelectionGuide(PROJECT, slot)).not.toContain('Product series');
    expect(buildSelectionGuide(PROJECT, slot)).toBe(buildSelectionGuide(PROJECT, slot));
  });
});
