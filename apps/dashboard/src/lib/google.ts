import { GuardError, assertNoSend, neutralizeUntrusted } from './guards';

// Read-only Google Workspace adapter - Phase 1A PREP ONLY. Live OAuth is not
// activated: the adapter serves MOCK fixtures, live reads/writes/sends are
// fail-closed, and every external text field (from/subject/snippet and
// title/location) is neutralized as untrusted (data only; CLAUDE.md rule 12).
// Server-only. See docs/PHASE_1A_EXTERNAL_CONTENT_INJECTION_DEFENSE.md.

type Env = Record<string, string | undefined>;

export interface GmailMessageSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
}

export interface CalendarEventSummary {
  id: string;
  title: string;
  start: string;
  location: string;
}

export interface GoogleReadResult<T> {
  source: 'mock' | 'google_readonly';
  items: T[];
  note?: string;
}

const GMAIL_MOCK: GmailMessageSummary[] = [
  {
    id: 'mock-1',
    from: 'client@example.com',
    subject: 'Quote follow-up',
    snippet: 'MOCK - checking on the window quote',
  },
  {
    id: 'mock-2',
    from: 'supplier@example.com',
    subject: 'Delivery update',
    snippet: 'MOCK - order ships Friday',
  },
];

const CAL_MOCK: CalendarEventSummary[] = [
  {
    id: 'mock-1',
    title: 'Site measure - Brooklyn',
    start: '2026-07-07T09:30:00',
    location: '123 Example St',
  },
  {
    id: 'mock-2',
    title: 'Install crew check-in',
    start: '2026-07-07T14:00:00',
    location: 'Shop',
  },
];

const NOTE = 'setup mode: Google read-only OAuth not activated (Phase 1A prep)';

// Phase 1A blocks live Google access unconditionally. The only way to request
// live access is GOOGLE_READONLY_LIVE_ENABLED=true; in Phase 1A that request is
// treated as an attempt to cross a boundary only a later owner-approved gate
// may open, so it is fail-closed here. A fully-configured live setup is still
// blocked. Absent, empty, or any other value keeps the adapter in mock mode.
function liveRequested(env: Env): boolean {
  return env['GOOGLE_READONLY_LIVE_ENABLED'] === 'true';
}

function guardLive(env: Env): void {
  if (liveRequested(env)) {
    throw new GuardError(
      'google: live read-only access is blocked until a later owner-approved gate',
    );
  }
}

export function getGmailSummary(opts?: { env?: Env }): GoogleReadResult<GmailMessageSummary> {
  const env = opts?.env ?? process.env;
  guardLive(env);

  return {
    source: 'mock',
    note: NOTE,
    items: GMAIL_MOCK.map((m) => ({
      id: m.id,
      from: neutralizeUntrusted(m.from),
      subject: neutralizeUntrusted(m.subject),
      snippet: neutralizeUntrusted(m.snippet),
    })),
  };
}

export function getCalendarSummary(opts?: {
  env?: Env;
}): GoogleReadResult<CalendarEventSummary> {
  const env = opts?.env ?? process.env;
  guardLive(env);

  return {
    source: 'mock',
    note: NOTE,
    items: CAL_MOCK.map((e) => ({
      id: e.id,
      title: neutralizeUntrusted(e.title),
      start: e.start,
      location: neutralizeUntrusted(e.location),
    })),
  };
}

// No send or live-write path exists in Phase 1A. These functions exist only so
// tests can prove that any attempt to send mail or mutate a calendar event
// fails closed. They never reach a Google API.
export function sendGmail(): never {
  return assertNoSend('gmail');
}

export function writeCalendarEvent(): never {
  throw new GuardError(
    'google calendar: live event writes are blocked (no live writes in Phase 1A)',
  );
}
