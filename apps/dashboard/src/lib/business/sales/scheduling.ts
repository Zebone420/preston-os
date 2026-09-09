// Phase 4 - scheduling minimum (plan PHASE 4): staff-selected availability
// -> deterministic first-fit slot -> calendar.event.create PAYLOAD shape
// + confirmation-message DRAFT descriptor + selection guide text.
//
// PURE: no calendar API, no send, no clock. Everything here is a
// proposal payload for Preston Control to gate; attendees are restricted
// to an explicit allowlist supplied by the caller (client + Preston).

export interface AvailabilityWindow {
  start: string; // ISO
  end: string; // ISO
  staff: string; // staff identifier (no PII required)
}

export interface BusinessHours {
  start_hour: number; // 0..23, local wall clock
  end_hour: number; // 1..24, exclusive
  utc_offset_minutes: number; // fixed offset the windows are expressed in
}

export interface SlotConstraints {
  duration_min: number;
  travel_buffer_min: number;
  business_hours: BusinessHours;
  earliest?: string | null; // ISO lower bound (e.g. now + lead time)
}

export interface VisitSlot {
  start: string;
  end: string;
  staff: string;
  window_index: number;
  buffer_before: string;
  buffer_after: string;
}

export type SlotSelection =
  | { ok: true; slot: VisitSlot }
  | { ok: false; reason: string };

const MIN_MS = 60 * 1000;

function ms(iso: string): number {
  return Date.parse(iso);
}

function iso(t: number): string {
  return new Date(t).toISOString();
}

function localHourFraction(t: number, offsetMin: number): number {
  const shifted = t + offsetMin * MIN_MS;
  const dayMs = 24 * 60 * MIN_MS;
  const inDay = ((shifted % dayMs) + dayMs) % dayMs;
  return inDay / (60 * MIN_MS);
}

function sameLocalDay(a: number, b: number, offsetMin: number): boolean {
  const dayMs = 24 * 60 * MIN_MS;
  return (
    Math.floor((a + offsetMin * MIN_MS) / dayMs) ===
    Math.floor((b + offsetMin * MIN_MS) / dayMs)
  );
}

export function validateConstraints(c: SlotConstraints): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(c.duration_min) || c.duration_min <= 0) {
    errors.push('duration_invalid');
  }
  if (!Number.isSafeInteger(c.travel_buffer_min) || c.travel_buffer_min < 0) {
    errors.push('travel_buffer_invalid');
  }
  const h = c.business_hours;
  if (
    !h ||
    !Number.isSafeInteger(h.start_hour) ||
    !Number.isSafeInteger(h.end_hour) ||
    h.start_hour < 0 ||
    h.end_hour > 24 ||
    h.start_hour >= h.end_hour ||
    !Number.isSafeInteger(h.utc_offset_minutes) ||
    Math.abs(h.utc_offset_minutes) > 14 * 60
  ) {
    errors.push('business_hours_invalid');
  }
  if (c.earliest && Number.isNaN(ms(c.earliest))) errors.push('earliest_invalid');
  return errors;
}

// Deterministic first-fit: windows are scanned in ascending start order
// (ties by staff id); the first window that can hold buffer + duration +
// buffer inside business hours wins. Same inputs -> same slot.
export function selectVisitSlot(
  availability: AvailabilityWindow[],
  constraints: SlotConstraints,
): SlotSelection {
  const errors = validateConstraints(constraints);
  if (errors.length > 0) return { ok: false, reason: errors.join(',') };
  if (!Array.isArray(availability) || availability.length === 0) {
    return { ok: false, reason: 'no_availability' };
  }
  const buffer = constraints.travel_buffer_min * MIN_MS;
  const duration = constraints.duration_min * MIN_MS;
  const earliest = constraints.earliest ? ms(constraints.earliest) : -Infinity;
  const hours = constraints.business_hours;
  const indexed = availability
    .map((w, i) => ({ w, i }))
    .filter(
      ({ w }) =>
        !Number.isNaN(ms(w.start)) && !Number.isNaN(ms(w.end)) && ms(w.end) > ms(w.start),
    )
    .sort((a, b) => {
      const d = ms(a.w.start) - ms(b.w.start);
      return d !== 0 ? d : a.w.staff.localeCompare(b.w.staff);
    });
  for (const { w, i } of indexed) {
    const windowStart = ms(w.start);
    const windowEnd = ms(w.end);
    let start = Math.max(windowStart + buffer, earliest);
    // Snap the visit start up to the business-hours opening if needed.
    const startHour = localHourFraction(start, hours.utc_offset_minutes);
    if (startHour < hours.start_hour) {
      start += (hours.start_hour - startHour) * 60 * MIN_MS;
    }
    const end = start + duration;
    if (end + buffer > windowEnd) continue;
    if (!sameLocalDay(start, end, hours.utc_offset_minutes)) continue;
    const endHour = localHourFraction(end, hours.utc_offset_minutes);
    const endsAtMidnight = endHour === 0 && hours.end_hour === 24;
    if (endHour > hours.end_hour || (endHour === 0 && !endsAtMidnight)) continue;
    if (localHourFraction(start, hours.utc_offset_minutes) >= hours.end_hour) {
      continue;
    }
    return {
      ok: true,
      slot: {
        start: iso(start),
        end: iso(end),
        staff: w.staff,
        window_index: i,
        buffer_before: iso(start - buffer),
        buffer_after: iso(end + buffer),
      },
    };
  }
  return { ok: false, reason: 'no_fit' };
}

export interface ProjectRef {
  project_id: string;
  project_code: string; // human Project ID from the identity lane
  address_line: string;
  visit_kind: 'site_visit' | 'final_measure';
}

export interface Attendee {
  email: string;
  role: 'client' | 'preston';
}

export interface CalendarEventDraft {
  capability_id: 'calendar.event.create';
  approval_class: 'EXTERNAL';
  project_id: string;
  payload: {
    summary: string;
    description: string;
    start: string;
    end: string;
    attendees: Attendee[];
    location: string;
    reminders_min: number[];
    external_ref: string;
  };
  confirmation_draft: {
    capability_id: 'gmail.message.draft';
    approval_class: 'INTERNAL';
    template: 'visit_confirmation_with_selection_guide';
    to: string[];
    subject: string;
    body_text: string;
  };
}

export type CalendarDraftResult =
  | { ok: true; draft: CalendarEventDraft }
  | { ok: false; reason: string; rejected: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

// Build the calendar.event.create payload. Every attendee must be on the
// caller's allowlist (client contacts + Preston staff for THIS project);
// any other address is refused outright - no partial event is built.
export function buildCalendarEventDraft(
  project: ProjectRef,
  slot: VisitSlot,
  attendees: Attendee[],
  allowlist: string[],
): CalendarDraftResult {
  const allow = new Set(allowlist.map(normEmail));
  const rejected: string[] = [];
  const clean: Attendee[] = [];
  for (const a of attendees) {
    const email = normEmail(a.email);
    if (!EMAIL_RE.test(email) || !allow.has(email)) {
      rejected.push(a.email);
      continue;
    }
    if (a.role !== 'client' && a.role !== 'preston') {
      rejected.push(a.email);
      continue;
    }
    clean.push({ email, role: a.role });
  }
  if (rejected.length > 0) {
    return { ok: false, reason: 'attendee_not_allowlisted', rejected };
  }
  if (!clean.some((a) => a.role === 'preston')) {
    return { ok: false, reason: 'preston_attendee_required', rejected: [] };
  }
  const kind = project.visit_kind === 'final_measure' ? 'Final measure' : 'Site visit';
  const summary = `${kind} - ${project.project_code}`;
  const guide = buildSelectionGuide(project, slot);
  return {
    ok: true,
    draft: {
      capability_id: 'calendar.event.create',
      approval_class: 'EXTERNAL',
      project_id: project.project_id,
      payload: {
        summary,
        description: `${kind} for project ${project.project_code}.`,
        start: slot.start,
        end: slot.end,
        attendees: clean,
        location: project.address_line,
        reminders_min: [24 * 60, 60],
        external_ref: `preston:${project.project_code}:${project.visit_kind}`,
      },
      confirmation_draft: {
        capability_id: 'gmail.message.draft',
        approval_class: 'INTERNAL',
        template: 'visit_confirmation_with_selection_guide',
        to: clean.filter((a) => a.role === 'client').map((a) => a.email),
        subject: `${kind} confirmation - ${project.project_code}`,
        body_text: guide,
      },
    },
  };
}

export interface SelectionGuideOptions {
  series_options?: string[];
  prep_items?: string[];
}

// Pure text builder for the confirmation + selection guide. No product
// claims are made here: series options are whatever the caller passes
// (from verified catalog rows), and the default prep list is generic.
export function buildSelectionGuide(
  project: ProjectRef,
  slot: VisitSlot,
  opts: SelectionGuideOptions = {},
): string {
  const kind = project.visit_kind === 'final_measure' ? 'final measure' : 'site visit';
  const lines: string[] = [
    `Your ${kind} for project ${project.project_code} is scheduled.`,
    `When: ${slot.start} to ${slot.end} (UTC)`,
    `Where: ${project.address_line}`,
    '',
    'To make the visit productive, please have ready:',
  ];
  const prep = opts.prep_items ?? [
    'access to every opening in scope',
    'any building or board requirements you already know of',
    'photos or notes on preferred styles, if any',
  ];
  for (const p of prep) lines.push(`- ${p}`);
  if (opts.series_options && opts.series_options.length > 0) {
    lines.push('', 'Product series we can review together:');
    for (const s of opts.series_options) lines.push(`- ${s}`);
  }
  lines.push('', 'Reply to this message if the time does not work.');
  return lines.join('\n');
}
