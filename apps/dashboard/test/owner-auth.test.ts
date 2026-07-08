import { describe, expect, it } from 'vitest';
import {
  evaluateOwnerGate,
  isAuthConfigured,
  isOwnerEmail,
  ownerAllowlist,
} from '../src/lib/owner-auth';

// Fake (non-secret) auth env. Values are placeholders, never credentials.
const authEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.example',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'TEST-not-a-real-key',
};

const ownerEnv = {
  ...authEnv,
  OWNER_EMAIL_ALLOWLIST: 'owner@example.com',
};

describe('isAuthConfigured', () => {
  it('is false when env is empty (setup mode)', () => {
    expect(isAuthConfigured({})).toBe(false);
  });
  it('is false when only one of the two values is present', () => {
    expect(
      isAuthConfigured({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.example' }),
    ).toBe(false);
    expect(isAuthConfigured({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toBe(
      false,
    );
  });
  it('is true when both are present', () => {
    expect(isAuthConfigured(authEnv)).toBe(true);
  });
});

describe('ownerAllowlist / isOwnerEmail (fail-closed allowlist)', () => {
  it('missing allowlist var yields an empty list', () => {
    expect(ownerAllowlist({})).toEqual([]);
  });
  it('empty or whitespace-only allowlist yields an empty list', () => {
    expect(ownerAllowlist({ OWNER_EMAIL_ALLOWLIST: '' })).toEqual([]);
    expect(ownerAllowlist({ OWNER_EMAIL_ALLOWLIST: ' ,  , ' })).toEqual([]);
  });
  it('parses, trims, and lowercases comma-separated entries', () => {
    expect(
      ownerAllowlist({ OWNER_EMAIL_ALLOWLIST: ' Owner@Example.com , second@example.com ' }),
    ).toEqual(['owner@example.com', 'second@example.com']);
  });
  it('nobody is owner when the allowlist is missing (fail closed)', () => {
    expect(isOwnerEmail('owner@example.com', authEnv)).toBe(false);
  });
  it('nobody is owner when the allowlist is empty (fail closed)', () => {
    expect(
      isOwnerEmail('owner@example.com', {
        ...authEnv,
        OWNER_EMAIL_ALLOWLIST: '',
      }),
    ).toBe(false);
  });
  it('null/undefined email is never owner', () => {
    expect(isOwnerEmail(null, ownerEnv)).toBe(false);
    expect(isOwnerEmail(undefined, ownerEnv)).toBe(false);
  });
  it('allowlisted email matches case-insensitively with whitespace', () => {
    expect(isOwnerEmail('OWNER@example.com', ownerEnv)).toBe(true);
    expect(isOwnerEmail('  owner@example.com  ', ownerEnv)).toBe(true);
  });
  it('non-allowlisted email is not owner', () => {
    expect(isOwnerEmail('intruder@example.com', ownerEnv)).toBe(false);
  });
});

describe('evaluateOwnerGate: setup mode (missing auth env) fails closed', () => {
  it('blocks the dashboard root with the setup action', () => {
    expect(
      evaluateOwnerGate({ path: '/', userEmail: null, env: {} }),
    ).toBe('setup');
  });
  it('blocks every operational page', () => {
    for (const path of ['/approvals', '/audit', '/brief', '/remote']) {
      expect(evaluateOwnerGate({ path, userEmail: null, env: {} })).toBe(
        'setup',
      );
    }
  });
  it('still allows the /login surface (safe setup notice, no data)', () => {
    expect(
      evaluateOwnerGate({ path: '/login', userEmail: null, env: {} }),
    ).toBe('allow');
  });
  it('stays closed even if an email is somehow present', () => {
    expect(
      evaluateOwnerGate({ path: '/', userEmail: 'owner@example.com', env: {} }),
    ).toBe('setup');
  });
});

describe('evaluateOwnerGate: unauthenticated visitors are blocked', () => {
  it('redirects the dashboard root to login', () => {
    expect(
      evaluateOwnerGate({ path: '/', userEmail: null, env: ownerEnv }),
    ).toBe('login');
  });
  it('redirects operational pages to login', () => {
    for (const path of ['/approvals', '/audit', '/brief', '/remote']) {
      expect(
        evaluateOwnerGate({ path, userEmail: null, env: ownerEnv }),
      ).toBe('login');
    }
  });
  it('allows the login page itself', () => {
    expect(
      evaluateOwnerGate({ path: '/login', userEmail: null, env: ownerEnv }),
    ).toBe('allow');
  });
});

describe('evaluateOwnerGate: authorized owner path', () => {
  it('allows the dashboard for the allowlisted owner', () => {
    expect(
      evaluateOwnerGate({
        path: '/',
        userEmail: 'owner@example.com',
        env: ownerEnv,
      }),
    ).toBe('allow');
  });
  it('matches the owner email case-insensitively', () => {
    expect(
      evaluateOwnerGate({
        path: '/approvals',
        userEmail: 'Owner@Example.COM',
        env: ownerEnv,
      }),
    ).toBe('allow');
  });
  it('sends a signed-in owner from /login back home', () => {
    expect(
      evaluateOwnerGate({
        path: '/login',
        userEmail: 'owner@example.com',
        env: ownerEnv,
      }),
    ).toBe('home');
  });
});

describe('evaluateOwnerGate: authenticated non-owner is blocked', () => {
  it('denies the dashboard to a non-allowlisted user', () => {
    expect(
      evaluateOwnerGate({
        path: '/',
        userEmail: 'intruder@example.com',
        env: ownerEnv,
      }),
    ).toBe('deny');
  });
  it('denies every operational page to a non-allowlisted user', () => {
    for (const path of ['/approvals', '/audit', '/brief', '/remote']) {
      expect(
        evaluateOwnerGate({
          path,
          userEmail: 'intruder@example.com',
          env: ownerEnv,
        }),
      ).toBe('deny');
    }
  });
  it('denies everyone when the allowlist is not configured (fail closed)', () => {
    expect(
      evaluateOwnerGate({
        path: '/',
        userEmail: 'owner@example.com',
        env: authEnv,
      }),
    ).toBe('deny');
  });
  it('leaves /login reachable so the owner can re-authenticate', () => {
    expect(
      evaluateOwnerGate({
        path: '/login',
        userEmail: 'intruder@example.com',
        env: ownerEnv,
      }),
    ).toBe('allow');
  });
});
