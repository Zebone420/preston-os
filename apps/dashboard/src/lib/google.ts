import { GuardError, assertNoSend, neutralizeUntrusted } from './guards';

// Read-only Google Workspace adapter - Phase 1B Stage 3. The adapter is MOCK by
// default and fail-closed. A LIVE read-only path exists but only activates when
// GOOGLE_READONLY_LIVE_ENABLED === 'true' AND config is present; otherwise it
// stays mock or fails closed. Every external field is neutralized as untrusted
// (data only; CLAUDE.md rule 12). Read-only ONLY: no send, no calendar/Drive
// write, no Maps. Server-only. Live real-API mapping is validated by the owner
// at Stage 4; tests here inject mocks so NO real Google call ever runs in CI.
// See docs/PHASE_1B_LIVE_READONLY_GOOGLE_OAUTH_GATE_PLAN.md.

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

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

// Injectable read client for the live path. Tests provide a mock so no real
// Google request occurs. The default implementation calls read-only REST
// endpoints with a bearer access token (owner-provisioned at Stage 4).
export interface GoogleReadClient {
  gmailSummaries(): Promise<GmailMessageSummary[]>;
  calendarSummaries(): Promise<CalendarEventSummary[]>;
}

const GMAIL_MOCK: GmailMessageSummary[] = [
  { id: 'mock-1', from: 'client@example.com', subject: 'Quote follow-up', snippet: 'MOCK - checking on the window quote' },
  { id: 'mock-2', from: 'supplier@example.com', subject: 'Delivery update', snippet: 'MOCK - order ships Friday' },
];

const CAL_MOCK: CalendarEventSummary[] = [
  { id: 'mock-1', title: 'Site measure - Brooklyn', start: '2026-07-07T09:30:00', location: '123 Example St' },
  { id: 'mock-2', title: 'Install crew check-in', start: '2026-07-07T14:00:00', location: 'Shop' },
];

const NOTE = 'setup mode: Google read-only OAuth not activated (mock mode)';

function liveRequested(env: Env): boolean {
  return env['GOOGLE_READONLY_LIVE_ENABLED'] === 'true';
}

// Config required for a live read. Missing/invalid => fail closed (throw).
// Uses a pre-obtained access token (owner sets it at Stage 4); no refresh-token
// exchange and no OAuth consent are performed here.
function requireAccessToken(env: Env): string {
  const scopes = env['GOOGLE_WORKSPACE_READONLY_SCOPES'];
  if (!scopes || !scopes.includes('readonly')) {
    throw new GuardError('google: read-only scopes not configured (fail-closed)');
  }
  const token = env['GOOGLE_OAUTH_ACCESS_TOKEN'];
  if (!token || token.trim() === '') {
    throw new GuardError('google: live read requested but access token is not configured (fail-closed)');
  }
  return token;
}

function neutralizeGmail(m: GmailMessageSummary): GmailMessageSummary {
  return {
    id: m.id,
    from: neutralizeUntrusted(m.from),
    subject: neutralizeUntrusted(m.subject),
    snippet: neutralizeUntrusted(m.snippet),
  };
}

function neutralizeCal(e: CalendarEventSummary): CalendarEventSummary {
  return {
    id: e.id,
    title: neutralizeUntrusted(e.title),
    start: e.start,
    location: neutralizeUntrusted(e.location),
  };
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  token: string,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new GuardError('google: read-only request failed with status ' + res.status);
  return (await res.json()) as Record<string, unknown>;
}

// Default live client - READ-ONLY endpoints only. Never invoked in tests (a
// mock client/fetch is injected). Real-API response mapping is validated by the
// owner at Stage 4 on the owner account.
function defaultClient(env: Env, fetchImpl: FetchLike): GoogleReadClient {
  const token = requireAccessToken(env);
  return {
    async gmailSummaries() {
      const list = await getJson(
        fetchImpl,
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
        token,
      );
      const ids = (((list['messages'] as { id: string }[]) ?? []).map((m) => m.id)).slice(0, 5);
      const out: GmailMessageSummary[] = [];
      for (const id of ids) {
        const msg = await getJson(
          fetchImpl,
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id +
            '?format=metadata&metadataHeaders=From&metadataHeaders=Subject',
          token,
        );
        const headers = ((msg['payload'] as { headers?: { name: string; value: string }[] })?.headers) ?? [];
        const header = (n: string) => headers.find((h) => h.name === n)?.value ?? '';
        out.push({ id, from: header('From'), subject: header('Subject'), snippet: String(msg['snippet'] ?? '') });
      }
      return out;
    },
    async calendarSummaries() {
      const data = await getJson(
        fetchImpl,
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&singleEvents=true&orderBy=startTime',
        token,
      );
      const items = (data['items'] as Record<string, unknown>[]) ?? [];
      return items.slice(0, 5).map((e) => ({
        id: String(e['id'] ?? ''),
        title: String(e['summary'] ?? ''),
        start: String((e['start'] as { dateTime?: string; date?: string })?.dateTime ?? (e['start'] as { date?: string })?.date ?? ''),
        location: String(e['location'] ?? ''),
      }));
    },
  };
}

interface AdapterOpts {
  env?: Env;
  client?: GoogleReadClient;
  fetchImpl?: FetchLike;
}

export async function getGmailSummary(opts?: AdapterOpts): Promise<GoogleReadResult<GmailMessageSummary>> {
  const env = opts?.env ?? process.env;
  if (!liveRequested(env)) {
    return { source: 'mock', note: NOTE, items: GMAIL_MOCK.map(neutralizeGmail) };
  }
  const client = opts?.client ?? defaultClient(env, opts?.fetchImpl ?? fetch);
  const items = await client.gmailSummaries();
  return { source: 'google_readonly', items: items.map(neutralizeGmail) };
}

export async function getCalendarSummary(opts?: AdapterOpts): Promise<GoogleReadResult<CalendarEventSummary>> {
  const env = opts?.env ?? process.env;
  if (!liveRequested(env)) {
    return { source: 'mock', note: NOTE, items: CAL_MOCK.map(neutralizeCal) };
  }
  const client = opts?.client ?? defaultClient(env, opts?.fetchImpl ?? fetch);
  const items = await client.calendarSummaries();
  return { source: 'google_readonly', items: items.map(neutralizeCal) };
}

// No send or live-write path exists. These fail closed (CLAUDE.md rules 4, 5).
export function sendGmail(): never {
  return assertNoSend('gmail');
}

export function writeCalendarEvent(): never {
  throw new GuardError('google calendar: live event writes are blocked (read-only only)');
}
