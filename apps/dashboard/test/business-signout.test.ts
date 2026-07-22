import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateOwnerGate } from '../src/lib/owner-auth';
import {
  performSignOut,
  type AuthSignOutClient,
} from '../src/lib/sign-out';

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'x',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y',
  OWNER_EMAIL_ALLOWLIST: 'owner@example.test',
};

describe('performSignOut - session termination', () => {
  it('calls supabase auth.signOut exactly once and reports ok', async () => {
    let calls = 0;
    const client: AuthSignOutClient = {
      auth: {
        signOut: async () => {
          calls++;
          return { error: null };
        },
      },
    };
    const res = await performSignOut(client);
    expect(res.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('surfaces a signOut failure instead of claiming success', async () => {
    const client: AuthSignOutClient = {
      auth: {
        signOut: async () => ({ error: { message: 'network down' } }),
      },
    };
    const res = await performSignOut(client);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network down');
  });

  it('treats a thrown signOut as a failure, not a crash', async () => {
    const client: AuthSignOutClient = {
      auth: {
        signOut: async () => {
          throw new Error('boom');
        },
      },
    };
    const res = await performSignOut(client);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
  });

  it('setup mode (no client) has no session and succeeds', async () => {
    const res = await performSignOut(null);
    expect(res.ok).toBe(true);
  });
});

describe('after sign-out, protected /business routes redirect', () => {
  const BUSINESS_PATHS = [
    '/business',
    '/business/pipeline',
    '/business/quotes',
    '/business/quotes/abc',
    '/business/projects',
    '/business/payments',
    '/business/activity',
    '/business/agents',
  ];

  it('a cleared session (no user email) gets login on every path', () => {
    for (const path of BUSINESS_PATHS) {
      expect(
        evaluateOwnerGate({ path, userEmail: null, env: ENV }),
      ).toBe('login');
      expect(
        evaluateOwnerGate({ path, userEmail: undefined, env: ENV }),
      ).toBe('login');
    }
  });

  it('the signed-in owner still passes (control case)', () => {
    expect(
      evaluateOwnerGate({
        path: '/business',
        userEmail: 'owner@example.test',
        env: ENV,
      }),
    ).toBe('allow');
  });

  it('the /login landing target itself stays reachable signed out', () => {
    expect(
      evaluateOwnerGate({ path: '/login', userEmail: null, env: ENV }),
    ).toBe('allow');
  });
});

describe('sign-out control - structural pins', () => {
  it('the shared business shell renders a Sign out control', () => {
    const ui = readFileSync(
      join(__dirname, '..', 'src/components/business/ui.tsx'),
      'utf8',
    );
    expect(ui).toContain('Sign out');
    expect(ui).toContain('action={signOutOwner}');
  });

  it('the action ends the session then lands on /login', () => {
    const actions = readFileSync(
      join(__dirname, '..', 'src/app/business/actions.ts'),
      'utf8',
    );
    const body = actions.slice(
      actions.indexOf('export async function signOutOwner'),
    );
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).toContain('performSignOut');
    expect(fn).toContain("redirect('/login')");
    // Session termination must precede the redirect.
    expect(fn.indexOf('performSignOut')).toBeLessThan(
      fn.indexOf("redirect('/login')"),
    );
  });
});
