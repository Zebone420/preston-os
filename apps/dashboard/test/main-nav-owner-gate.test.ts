import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Review Finding 1 (authentication boundary) - BEHAVIORAL reproduction.
//
// Contract (main-nav.tsx header + nav-config NON_NAV_ROUTES): the main
// navigation renders NOTHING unless the request belongs to an
// allowlisted OWNER. The proxy's evaluateOwnerGate denies an
// authenticated non-owner everywhere EXCEPT /login (kept reachable for
// re-auth), and the root layout mounts <MainNav /> on every route
// including /login - so MainNav itself must apply the same owner
// predicate as the rest of the app (resolveOwner / isOwnerEmail), not
// merely "some authenticated user exists". These tests call the async
// server component as a function and assert on its rendered result.

let supabaseResult: unknown = null;

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => supabaseResult,
}));

vi.mock('@/components/nav/nav-menu', () => ({
  NavMenu: () => null,
}));

import { MainNav } from '../src/components/nav/main-nav';

function authedAs(email: string | null, error: unknown = null) {
  return {
    auth: {
      getUser: async () =>
        error || !email
          ? { data: { user: null }, error: error ?? { message: 'no session' } }
          : { data: { user: { email } }, error: null },
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  supabaseResult = null;
});

describe('MainNav owner gate (server component behavior)', () => {
  it('renders nothing in setup mode (no supabase client)', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', 'owner@example.com');
    supabaseResult = null;
    expect(await MainNav()).toBeNull();
  });

  it('renders nothing for an unauthenticated visitor', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', 'owner@example.com');
    supabaseResult = authedAs(null);
    expect(await MainNav()).toBeNull();
  });

  it('renders nothing for an expired/failed session', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', 'owner@example.com');
    supabaseResult = authedAs(null, { message: 'JWT expired' });
    expect(await MainNav()).toBeNull();
  });

  it('renders nothing for an AUTHENTICATED NON-OWNER (the /login exposure)', async () => {
    // evaluateOwnerGate: authenticated non-owner -> 'deny' everywhere,
    // 'allow' only on /login. The layout renders MainNav there, so a
    // session-only gate would show the full protected-route menu (and a
    // sign-out control) to a user the app denies everywhere else.
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', 'owner@example.com');
    supabaseResult = authedAs('intruder@example.com');
    expect(await MainNav()).toBeNull();
  });

  it('renders nothing when the allowlist is empty (fail closed)', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', '');
    supabaseResult = authedAs('owner@example.com');
    expect(await MainNav()).toBeNull();
  });

  it('renders the menu for the allowlisted owner', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', 'owner@example.com');
    supabaseResult = authedAs('owner@example.com');
    expect(await MainNav()).not.toBeNull();
  });

  it('is case/whitespace tolerant like isOwnerEmail', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', ' Owner@Example.com ');
    supabaseResult = authedAs('owner@example.com');
    expect(await MainNav()).not.toBeNull();
  });
});

describe('auth request efficiency (review Finding 3 - structural pins)', () => {
  const SRC = join(__dirname, '../src');
  const mainNav = readFileSync(join(SRC, 'components/nav/main-nav.tsx'), 'utf8');
  const ownerCtx = readFileSync(join(SRC, 'lib/ai-os/owner-context.ts'), 'utf8');

  it('MainNav issues no supabase.auth.getUser of its own; it reuses resolveOwner', () => {
    expect(mainNav).not.toContain('auth.getUser');
    expect(mainNav).toContain('resolveOwner');
  });

  it('resolveOwner is memoized per render pass with React cache()', () => {
    // Next 16 authentication guide (DAL pattern): wrap the session/user
    // resolver in React cache() so layout + page share one auth request
    // per render pass. cache() silently does not memoize in route
    // handlers (documented), so control-plane callers are unaffected.
    expect(ownerCtx).toMatch(/import \{ cache \} from 'react'/);
    expect(ownerCtx).toMatch(/resolveOwner = cache\(/);
  });
});
