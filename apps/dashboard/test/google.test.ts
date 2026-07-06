import { describe, expect, it } from 'vitest';
import { GuardError, neutralizeUntrusted } from '../src/lib/guards';
import {
  getCalendarSummary,
  getGmailSummary,
  sendGmail,
  writeCalendarEvent,
} from '../src/lib/google';

// A fully-configured live setup (canonical env var names from env.template)
// plus the explicit enable flag. Phase 1A must still fail closed on this.
const liveEnv = {
  GOOGLE_OAUTH_CLIENT_ID: 'x',
  GOOGLE_OAUTH_CLIENT_SECRET: 'y',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/oauth/callback',
  GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.readonly calendar.readonly',
  GOOGLE_READONLY_LIVE_ENABLED: 'true',
};

describe('google read-only adapter (Phase 1A prep)', () => {
  it('serves MOCK gmail data in setup mode (no env)', () => {
    const r = getGmailSummary({ env: {} });
    expect(r.source).toBe('mock');
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.note).toContain('Phase 1A');
  });

  it('serves MOCK calendar data in setup mode (no env)', () => {
    const r = getCalendarSummary({ env: {} });
    expect(r.source).toBe('mock');
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('blocks live read even when credentials + enable flag are present', () => {
    expect(() => getGmailSummary({ env: liveEnv })).toThrow(GuardError);
    expect(() => getCalendarSummary({ env: liveEnv })).toThrow(GuardError);
  });

  it('blocks live read when only the enable flag is set (fail-closed)', () => {
    const flagOnly = { GOOGLE_READONLY_LIVE_ENABLED: 'true' };
    expect(() => getGmailSummary({ env: flagOnly })).toThrow(GuardError);
    expect(() => getCalendarSummary({ env: flagOnly })).toThrow(GuardError);
  });

  it('neutralizes external text fields (external content is data only)', () => {
    const g = getGmailSummary({ env: {} }).items[0];
    expect(g.from).toBe(neutralizeUntrusted(g.from));
    expect(g.subject).toBe(neutralizeUntrusted(g.subject));
    expect(g.snippet).toBe(neutralizeUntrusted(g.snippet));
    // no control characters survive into user-visible summaries
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(g.snippet)).toBe(false);

    const c = getCalendarSummary({ env: {} }).items[0];
    expect(c.title).toBe(neutralizeUntrusted(c.title));
    expect(c.location).toBe(neutralizeUntrusted(c.location));
  });

  it('blocks gmail send and calendar write paths', () => {
    expect(() => sendGmail()).toThrow(GuardError);
    expect(() => writeCalendarEvent()).toThrow(GuardError);
  });
});
