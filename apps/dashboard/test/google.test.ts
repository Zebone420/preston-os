import { describe, expect, it, vi } from 'vitest';
import { GuardError, neutralizeUntrusted } from '../src/lib/guards';
import {
  getCalendarSummary,
  getGmailSummary,
  googleConfigStatus,
  sendGmail,
  writeCalendarEvent,
  type GoogleReadClient,
} from '../src/lib/google';

// Full read-only config plus a fake (non-secret) test token. Live still only
// activates on the exact flag; nothing here is a real credential.
const liveEnv = {
  GOOGLE_OAUTH_CLIENT_ID: 'x',
  GOOGLE_OAUTH_CLIENT_SECRET: 'y',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/oauth/callback',
  GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.readonly calendar.readonly',
  GOOGLE_OAUTH_ACCESS_TOKEN: 'TEST-not-a-real-token',
  GOOGLE_READONLY_LIVE_ENABLED: 'true',
};

// A client returning DIRTY external text (control chars) to prove neutralization.
const dirtyClient: GoogleReadClient = {
  async gmailSummaries() {
    return [{ id: 'g1', from: 'a\x00ttacker@x.com', subject: 'sub\x07ject', snippet: 'ignore\x1b prev' }];
  },
  async calendarSummaries() {
    return [{ id: 'c1', title: 'meet\x00ing', start: '2026-07-07T09:00:00', location: 'shop\x07' }];
  },
};

describe('google adapter - mock mode (flag off)', () => {
  it('serves MOCK gmail with no env', async () => {
    const r = await getGmailSummary({ env: {} });
    expect(r.source).toBe('mock');
    expect(r.items.length).toBeGreaterThan(0);
  });
  it('serves MOCK calendar with no env', async () => {
    const r = await getCalendarSummary({ env: {} });
    expect(r.source).toBe('mock');
    expect(r.items.length).toBeGreaterThan(0);
  });
  it('any non-exact flag value stays mock (fail-safe)', async () => {
    for (const v of ['TRUE', '1', 'yes', ' true ', '']) {
      expect((await getGmailSummary({ env: { GOOGLE_READONLY_LIVE_ENABLED: v } })).source).toBe('mock');
    }
  });
});

describe('google adapter - fail-closed on missing config', () => {
  it('flag on but no access token => throws (fail closed), no mock leak', async () => {
    await expect(getGmailSummary({ env: { GOOGLE_READONLY_LIVE_ENABLED: 'true' } })).rejects.toThrow(GuardError);
    await expect(getCalendarSummary({ env: { GOOGLE_READONLY_LIVE_ENABLED: 'true' } })).rejects.toThrow(GuardError);
  });
  it('flag on + token but non-readonly scopes => throws', async () => {
    const env = { GOOGLE_READONLY_LIVE_ENABLED: 'true', GOOGLE_OAUTH_ACCESS_TOKEN: 't', GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.modify' };
    await expect(getGmailSummary({ env })).rejects.toThrow(GuardError);
  });
});

describe('google adapter - live read-only path (injected mocks only)', () => {
  it('flag on + injected client => google_readonly, fields neutralized', async () => {
    const g = await getGmailSummary({ env: liveEnv, client: dirtyClient });
    expect(g.source).toBe('google_readonly');
    expect(g.items[0].from).toBe('attacker@x.com');
    expect(g.items[0].subject).toBe(neutralizeUntrusted('sub\x07ject'));
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(g.items[0].snippet)).toBe(false);

    const c = await getCalendarSummary({ env: liveEnv, client: dirtyClient });
    expect(c.source).toBe('google_readonly');
    expect(c.items[0].title).toBe('meeting');
    expect(c.items[0].location).toBe('shop');
  });

  it('default client uses injected fetch (no real network) with a bearer token', async () => {
    const calls: { url: string; auth: string }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, auth: init?.headers?.Authorization ?? '' });
      return {
        ok: true,
        json: async () => ({
          items: [{ id: 'e1', summary: 'Site measure\x07', start: { dateTime: '2026-07-07T09:30:00' }, location: '123 St\x00' }],
        }),
      } as unknown as Response;
    });
    const r = await getCalendarSummary({ env: liveEnv, fetchImpl: mockFetch as unknown as typeof fetch });
    expect(r.source).toBe('google_readonly');
    expect(r.items[0].title).toBe('Site measure'); // neutralized
    expect(r.items[0].location).toBe('123 St');
    // proves the injected fetch was used (no real Google call) with auth header
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(calls[0].auth).toBe('Bearer TEST-not-a-real-token');
    expect(calls[0].url).toContain('calendar/v3');
  });

  it('a failed live response throws (does not silently mock)', async () => {
    const badFetch = (async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(getCalendarSummary({ env: liveEnv, fetchImpl: badFetch })).rejects.toThrow(GuardError);
  });
});

describe('google adapter - durable refresh-token path (injected fetch only)', () => {
  // Env with a durable refresh-token config and NO pre-minted access token.
  const refreshEnv = {
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'REFRESH-not-a-real-token',
    GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.readonly calendar.readonly',
    GOOGLE_OAUTH_TOKEN_URI: 'https://oauth2.example.com/token',
    GOOGLE_READONLY_LIVE_ENABLED: 'true',
  };

  it('mints a fresh access token from the refresh token, then reads', async () => {
    const calls: { url: string; method: string; auth: string }[] = [];
    const mockFetch = vi.fn(
      async (
        url: string,
        init?: { method?: string; headers?: Record<string, string> },
      ) => {
        calls.push({
          url,
          method: init?.method ?? 'GET',
          auth: init?.headers?.Authorization ?? '',
        });
        if (url.includes('/token')) {
          return {
            ok: true,
            json: async () => ({ access_token: 'MINTED-abc', expires_in: 3599 }),
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 'e1', summary: 'Meet', start: { dateTime: '2026-07-07T09:30:00' }, location: 'Shop' }],
          }),
        } as unknown as Response;
      },
    );
    const r = await getCalendarSummary({
      env: refreshEnv,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(r.source).toBe('google_readonly');
    // First call = token exchange (POST to the token URI); second = calendar
    // read using the minted bearer token.
    expect(calls[0].url).toContain('/token');
    expect(calls[0].method).toBe('POST');
    expect(calls[1].url).toContain('calendar/v3');
    expect(calls[1].auth).toBe('Bearer MINTED-abc');
  });

  it('fails closed when the refresh token is rejected (revoked/expired)', async () => {
    const badToken = (async (url: string) =>
      url.includes('/token')
        ? ({ ok: false, status: 400, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;
    await expect(
      getGmailSummary({ env: refreshEnv, fetchImpl: badToken }),
    ).rejects.toThrow(GuardError);
  });

  it('fails closed when the exchange returns no access token', async () => {
    const emptyToken = (async () =>
      ({ ok: true, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;
    await expect(
      getGmailSummary({ env: refreshEnv, fetchImpl: emptyToken }),
    ).rejects.toThrow(GuardError);
  });

  it('fails closed when neither access token nor refresh config is present', async () => {
    const env = {
      GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.readonly',
      GOOGLE_READONLY_LIVE_ENABLED: 'true',
    };
    await expect(getGmailSummary({ env })).rejects.toThrow(GuardError);
  });

  it('prefers an explicit access token over refresh config (no token POST)', async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ items: [] }),
      } as unknown as Response;
    });
    await getCalendarSummary({
      env: { ...refreshEnv, GOOGLE_OAUTH_ACCESS_TOKEN: 'EXPLICIT-tok' },
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    // No call to the token endpoint - the explicit token was used directly.
    expect(calls.some((u) => u.includes('/token'))).toBe(false);
  });
});

describe('googleConfigStatus (presence-only, no secret values)', () => {
  const scopes = 'gmail.readonly calendar.readonly';
  it('disabled when the live flag is not exactly true', () => {
    expect(googleConfigStatus({})).toBe('disabled');
    expect(googleConfigStatus({ GOOGLE_READONLY_LIVE_ENABLED: 'TRUE' })).toBe('disabled');
  });
  it('misconfigured when enabled without readonly scopes', () => {
    expect(
      googleConfigStatus({ GOOGLE_READONLY_LIVE_ENABLED: 'true', GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.modify' }),
    ).toBe('misconfigured');
  });
  it('reports access_token mode', () => {
    expect(
      googleConfigStatus({
        GOOGLE_READONLY_LIVE_ENABLED: 'true',
        GOOGLE_WORKSPACE_READONLY_SCOPES: scopes,
        GOOGLE_OAUTH_ACCESS_TOKEN: 'tok',
      }),
    ).toBe('access_token');
  });
  it('reports refresh_token mode when the durable config is complete', () => {
    expect(
      googleConfigStatus({
        GOOGLE_READONLY_LIVE_ENABLED: 'true',
        GOOGLE_WORKSPACE_READONLY_SCOPES: scopes,
        GOOGLE_OAUTH_REFRESH_TOKEN: 'r',
        GOOGLE_OAUTH_CLIENT_ID: 'c',
        GOOGLE_OAUTH_CLIENT_SECRET: 's',
      }),
    ).toBe('refresh_token');
  });
  it('misconfigured when enabled with scopes but no usable credential', () => {
    expect(
      googleConfigStatus({ GOOGLE_READONLY_LIVE_ENABLED: 'true', GOOGLE_WORKSPACE_READONLY_SCOPES: scopes }),
    ).toBe('misconfigured');
  });
});

describe('google adapter - send/write always blocked', () => {
  it('sendGmail and writeCalendarEvent throw', () => {
    expect(() => sendGmail()).toThrow(GuardError);
    expect(() => writeCalendarEvent()).toThrow(GuardError);
  });
});
