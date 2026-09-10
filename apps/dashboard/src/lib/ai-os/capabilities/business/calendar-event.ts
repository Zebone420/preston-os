// Preston AI OS - Phase 3 calendar.event.create validation + canonical
// rendering. PURE. EXTERNAL side effect (invitations leave Preston) - in
// this phase only the sandbox adapter exists. Requires a CONFIRMED project
// identity input (wrong-project prevention) and validates every attendee
// against the recipient allowlist.

import type { ParamsValidation } from '../registry';
import { CalendarEventParamsSchema, parseWith, type CalendarEventParams } from './schemas';
import { resolveRecipients, vendorLeakReason } from './recipient-allowlist';
import { guardOutboundText } from './injection-boundary';

export interface CalendarEventCanonical extends Record<string, unknown> {
  kind: 'calendar.event.create';
  project_id: string;
  human_project_id: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  audience: string;
  location: string;
  description: string;
}

export function validateCalendarEvent(params: Record<string, unknown>): ParamsValidation {
  const parsed = parseWith(CalendarEventParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p: CalendarEventParams = parsed.data;

  if (p.project_identity.confirmed !== true) {
    return { ok: false, reason: 'project_identity_unconfirmed' };
  }
  if (p.project_identity.project_id !== p.project_id
    || p.project_identity.human_project_id !== p.project_id) {
    return { ok: false, reason: 'project_identity_mismatch' };
  }
  const startMs = Date.parse(p.start);
  const endMs = Date.parse(p.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, reason: 'event_window_invalid' };
  }

  const rec = resolveRecipients(p.attendees, p.recipient_allowlist, p.project_id);
  if (!rec.ok) return { ok: false, reason: rec.reason };

  const title = guardOutboundText(p.title, 'title', 300);
  if (!title.ok) return { ok: false, reason: title.reason };
  const location = guardOutboundText(p.location ?? '', 'location', 300);
  if (!location.ok) return { ok: false, reason: location.reason };
  const description = guardOutboundText(p.description ?? '', 'description', 4000);
  if (!description.ok) return { ok: false, reason: description.reason };

  const leak = vendorLeakReason(rec.audience,
    [title.data, location.data, description.data], p.recipient_allowlist);
  if (leak) return { ok: false, reason: leak };

  const attendees = rec.resolved.map((r) => r.email).sort();
  const canonical: CalendarEventCanonical = {
    kind: 'calendar.event.create',
    project_id: p.project_id,
    human_project_id: p.project_identity.human_project_id,
    title: title.data,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    attendees,
    audience: rec.audience,
    location: location.data,
    description: description.data,
  };
  return {
    ok: true,
    canonical,
    binding: {
      project_id: p.project_id,
      document_hash: null,
      amount: null,
      recipient: attendees.join(','),
    },
  };
}
