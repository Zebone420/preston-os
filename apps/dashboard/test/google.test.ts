import { describe, expect, it } from 'vitest';
import { GuardError, neutralizeUntrusted } from '../src/lib/guards';
import {
  getCalendarSummary,
  getGmailSummary,
  sendGmail,
  writeCalendarEvent,
} from '../src/lib/google';

// A fully-configured live setup (canonical env var names from env.template)
// plus the explicit enable flag. Phase 1A/1B must still fail closed on this.
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

// Phase 1B Stage 1 - readiness only. No live path is implemented. These tests
// prove the adapter fails SAFE (to mock) for every env shape short of the exact
// activation the future RED subgate will introduce, so nothing accidentally
// enables live Google access.
describe('google adapter - Phase 1B Stage 1 fail-safe readiness', () => {
  it('missing all Google env values -> mock (fail-safe, never live)', () => {
    expect(getGmailSummary({ env: {} }).source).toBe('mock');
    expect(getCalendarSummary({ env: {} }).source).toBe('mock');
  });

  it('full read-only config but enable flag absent -> mock', () => {
    const configNoFlag = {
      GOOGLE_OAUTH_CLIENT_ID: 'x',
      GOOGLE_OAUTH_CLIENT_SECRET: 'y',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/oauth/callback',
      GOOGLE_WORKSPACE_READONLY_SCOPES: 'gmail.readonly calendar.readonly',
    };
    expect(getGmailSummary({ env: configNoFlag }).source).toBe('mock');
    expect(getCalendarSummary({ env: configNoFlag }).source).toBe('mock');
  });

  it('enable flag with any non-exact value never enables live (stays mock)', () => {
    for (const v of ['TRUE', 'True', '1', 'yes', 'on', ' true ', '']) {
      expect(getGmailSummary({ env: { GOOGLE_READONLY_LIVE_ENABLED: v } }).source).toBe('mock');
      expect(getCalendarSummary({ env: { GOOGLE_READONLY_LIVE_ENABLED: v } }).source).toBe('mock');
    }
  });

  it('only mutation-shaped exports are the fail-closed stubs (no live-enabling export)', () => {
    expect(() => sendGmail()).toThrow(GuardError);
    expect(() => writeCalendarEvent()).toThrow(GuardError);
  });
});
