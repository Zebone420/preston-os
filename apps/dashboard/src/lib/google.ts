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

// Presence-only readiness status for the Google read-only path. Reports which
// credential mode is configured WITHOUT reading or returning any secret value -
// safe to surface on the health endpoint. 'refresh_token' is the durable mode;
// 'access_token' is the legacy short-lived (~1h) mode.
export type GoogleConfigStatus =
  | 'disabled' // GOOGLE_READONLY_LIVE_ENABLED not exactly 'true'
  | 'access_token' // legacy pre-minted token present
  | 'refresh_token' // durable refresh-token config present
  | 'misconfigured'; // enabled but no usable read-only credential/scopes

export function googleConfigStatus(env: Env): GoogleConfigStatus {
  if (!liveRequested(env)) return 'disabled';
  const scopesOk = (env['GOOGLE_WORKSPACE_READONLY_SCOPES'] ?? '').includes(
    'readonly',
  );
  if (!scopesOk) return 'misconfigured';
  if ((env['GOOGLE_OAUTH_ACCESS_TOKEN'] ?? '').trim() !== '') {
    return 'access_token';
  }
  if (
    (env['GOOGLE_OAUTH_REFRESH_TOKEN'] ?? '').trim() !== '' &&
    env['GOOGLE_OAUTH_CLIENT_ID'] &&
    env['GOOGLE_OAUTH_CLIENT_SECRET']
  ) {
    return 'refresh_token';
  }
  return 'misconfigured';
}

// Durable read-only OAuth: exchange the owner's stored refresh token for a
// fresh short-lived access token. Read-safe - it never escalates scope (the
// refresh token's scopes are fixed at consent to gmail/calendar readonly) and
// performs no send/write. Injectable fetch for tests. Never logs any secret;
// errors carry only an HTTP status, never a token value.
async function refreshAccessToken(
  env: Env,
  fetchImpl: FetchLike,
  refresh: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const tokenUrl =
    env['GOOGLE_OAUTH_TOKEN_URI'] ?? 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    // 400/401 here => refresh token revoked/expired or bad client creds.
    throw new GuardError(
      'google: refresh-token exchange failed with status ' +
        res.status +
        ' (reconnect required)',
    );
  }
  const json = (await res.json()) as { access_token?: string };
  const token = (json.access_token ?? '').trim();
  if (token === '') {
    throw new GuardError(
      'google: refresh-token exchange returned no access token (fail-closed)',
    );
  }
  return token;
}

// Resolve a usable read-only access token. Order: (1) explicit pre-minted
// GOOGLE_OAUTH_ACCESS_TOKEN (legacy Stage 4 path, still supported); (2) durable
// refresh-token exchange. Missing/invalid config => fail closed (throw).
async function acquireAccessToken(
  env: Env,
  fetchImpl: FetchLike,
): Promise<string> {
  const scopes = env['GOOGLE_WORKSPACE_READONLY_SCOPES'];
  if (!scopes || !scopes.includes('readonly')) {
    throw new GuardError('google: read-only scopes not configured (fail-closed)');
  }
  const explicit = (env['GOOGLE_OAUTH_ACCESS_TOKEN'] ?? '').trim();
  if (explicit !== '') return explicit;

  const refresh = (env['GOOGLE_OAUTH_REFRESH_TOKEN'] ?? '').trim();
  const clientId = env['GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = env['GOOGLE_OAUTH_CLIENT_SECRET'];
  if (refresh !== '' && clientId && clientSecret) {
    return refreshAccessToken(env, fetchImpl, refresh, clientId, clientSecret);
  }
  throw new GuardError(
    'google: live read requested but no access token or refresh-token config (fail-closed)',
  );
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
async function defaultClient(
  env: Env,
  fetchImpl: FetchLike,
): Promise<GoogleReadClient> {
  const token = await acquireAccessToken(env, fetchImpl);
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
  const client = opts?.client ?? (await defaultClient(env, opts?.fetchImpl ?? fetch));
  const items = await client.gmailSummaries();
  return { source: 'google_readonly', items: items.map(neutralizeGmail) };
}

export async function getCalendarSummary(opts?: AdapterOpts): Promise<GoogleReadResult<CalendarEventSummary>> {
  const env = opts?.env ?? process.env;
  if (!liveRequested(env)) {
    return { source: 'mock', note: NOTE, items: CAL_MOCK.map(neutralizeCal) };
  }
  const client = opts?.client ?? (await defaultClient(env, opts?.fetchImpl ?? fetch));
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
