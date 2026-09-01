import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  authenticateControlRequest,
  PRESTON_CONTROL_HERMES_CLIENT_ID_ENV,
  registeredClientIds,
  type ControlClient,
} from '../src/lib/preston-control/auth';
import { evaluateConsent } from '../src/lib/preston-control/consent';
import { READ_SURFACES } from '../src/lib/preston-control/http';

// Preston Control 'hermes' auth surface - the Hermes dashboard Preston
// Supervisor backend gets a THIRD, independently revocable OAuth client
// that is valid for the seven READ operations and NOTHING else. Pins:
//   - a verified hermes-client token passes the read routes
//   - missing hermes env fails closed (never a fallback to mcp/gpt)
//   - wrong/foreign client ids are refused
//   - mcp/gpt tokens cannot impersonate hermes and vice versa
//   - the four consequential routes (submit, follow-up, decision,
//     cancel) refuse hermes tokens as wrong_client BY CONSTRUCTION
//   - the owner-confirmation handshake on decide is untouched for gpt
//   - owner allowlist + is_owner() DB scoping still gate the new surface

const MCP_ID = '11111111-2222-4333-8444-555555555555';
const GPT_ID = '22222222-3333-4444-8555-666666666666';
const HERMES_ID = '33333333-4444-4555-8666-777777777777';
const OWNER = 'info@preston.nyc';
const GOAL_ID = '99999999-8888-4777-8666-555555555555';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const HERMES_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: HERMES_ID, email: OWNER });
const GPT_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: GPT_ID, email: OWNER });
const MCP_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: MCP_ID, email: OWNER });
const STRANGER_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: 'someone-else', email: OWNER });
const GUEST_HERMES_TOKEN = jwt({ sub: 'u-guest', aud: 'authenticated', client_id: HERMES_ID, email: 'guest@example.com' });

let db: ReturnType<typeof makeComposerFakeDb>;
const users: Record<string, { id: string; email: string; owner: boolean }> = {
  [HERMES_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [GPT_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [MCP_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [STRANGER_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [GUEST_HERMES_TOKEN]: { id: 'u-guest', email: 'guest@example.com', owner: false },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: (
    _url: string,
    _key: string,
    opts: { global: { headers: { Authorization: string } } },
  ) => {
    const token = opts.global.headers.Authorization.replace('Bearer ', '');
    const u = users[token];
    return {
      auth: {
        getUser: async (t: string) =>
          users[t]
            ? { data: { user: { id: users[t].id, email: users[t].email } }, error: null }
            : { data: { user: null }, error: { message: 'invalid JWT' } },
      },
      from: (t: string) => db.client.from(t),
      rpc: (fn: string, args: Record<string, unknown>) => {
        if (fn === 'is_owner') {
          return Promise.resolve({ data: Boolean(u?.owner), error: null });
        }
        return db.client.rpc(fn, args);
      },
    };
  },
}));

const ENV_ON = {
  PRESTON_CONTROL_ENABLED: 'true',
  PRESTON_CONTROL_OAUTH_CLIENT_ID: MCP_ID,
  PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID: GPT_ID,
  PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID: HERMES_ID,
  SUPABASE_RUNTIME_ENV: 'staging',
  OWNER_EMAIL_ALLOWLIST: OWNER,
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-placeholder',
};
const ENV_KEYS = Object.keys(ENV_ON);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  db = makeComposerFakeDb();
  db.rowsOf('master_goals').push({
    id: GOAL_ID, title: 'g', objective: 'o', status: 'running',
    source: 'owner', requested_by: OWNER, environment: 'staging',
    correlation_id: 'corr-h', simulation_only: true, iteration: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  });
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV_ON);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// --- auth-level: surface isolation ----------------------------------------

function fakeDeps() {
  const clientFor = (token: string): ControlClient => ({
    auth: {
      async getUser(t: string) {
        return users[t]
          ? { data: { user: { id: users[t].id, email: users[t].email } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    rpc(fn: string) {
      if (fn === 'is_owner') {
        return Promise.resolve({ data: Boolean(users[token]?.owner), error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    },
  });
  return { clientFor };
}

const AUTH_ENV = { ...ENV_ON };

describe('hermes surface - auth isolation', () => {
  it('valid hermes token authenticates on the read-surface list', async () => {
    const r = await authenticateControlRequest(
      'Bearer ' + HERMES_TOKEN, AUTH_ENV, fakeDeps(), READ_SURFACES,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.surface).toBe('hermes');
      expect(r.ownerEmail).toBe(OWNER);
    }
  });

  it('missing hermes client env fails closed - never a mcp/gpt fallback', async () => {
    const env = { ...AUTH_ENV, PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID: '' };
    // hermes-only route: unconfigured (503-class), not a pass-through.
    expect(
      await authenticateControlRequest('Bearer ' + HERMES_TOKEN, env, fakeDeps(), ['hermes']),
    ).toMatchObject({ ok: false, reason: 'unconfigured', httpStatus: 503 });
    // read routes: hermes is simply not a candidate; its token is refused.
    expect(
      await authenticateControlRequest('Bearer ' + HERMES_TOKEN, env, fakeDeps(), READ_SURFACES),
    ).toMatchObject({ ok: false, reason: 'wrong_client', httpStatus: 403 });
  });

  it('a token for an unregistered client is refused', async () => {
    expect(
      await authenticateControlRequest('Bearer ' + STRANGER_TOKEN, AUTH_ENV, fakeDeps(), READ_SURFACES),
    ).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('mcp token cannot impersonate hermes', async () => {
    expect(
      await authenticateControlRequest('Bearer ' + MCP_TOKEN, AUTH_ENV, fakeDeps(), ['hermes']),
    ).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('gpt token cannot impersonate hermes', async () => {
    expect(
      await authenticateControlRequest('Bearer ' + GPT_TOKEN, AUTH_ENV, fakeDeps(), ['hermes']),
    ).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('hermes token cannot reach the mcp surface', async () => {
    expect(
      await authenticateControlRequest('Bearer ' + HERMES_TOKEN, AUTH_ENV, fakeDeps(), 'mcp'),
    ).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('hermes token cannot reach the gpt-only (write) surface list', async () => {
    expect(
      await authenticateControlRequest('Bearer ' + HERMES_TOKEN, AUTH_ENV, fakeDeps(), ['gpt']),
    ).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('owner allowlist + DB is_owner still gate the hermes surface', async () => {
    expect(
      await authenticateControlRequest('Bearer ' + GUEST_HERMES_TOKEN, AUTH_ENV, fakeDeps(), ['hermes']),
    ).toMatchObject({ ok: false, reason: 'not_owner', httpStatus: 403 });
  });

  it('single-surface callers keep their exact behavior (regression)', async () => {
    const r = await authenticateControlRequest('Bearer ' + MCP_TOKEN, AUTH_ENV, fakeDeps(), 'mcp');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.surface).toBe('mcp');
  });

  it('the consent registry includes the hermes client id', () => {
    expect(registeredClientIds(AUTH_ENV)).toContain(HERMES_ID);
    expect(
      registeredClientIds({ ...AUTH_ENV, [PRESTON_CONTROL_HERMES_CLIENT_ID_ENV]: '' }),
    ).not.toContain(HERMES_ID);
  });
});

// --- route-level: read allowed, consequential refused ----------------------

function get(url: string, token: string): Request {
  return new Request(url, {
    headers: { authorization: 'Bearer ' + token },
  });
}

function post(url: string, token: string, body: unknown): Request {
  const text = JSON.stringify(body);
  return new Request(url, {
    method: 'POST',
    body: text,
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
  });
}

describe('hermes surface - route behavior', () => {
  it('hermes token reads status through the real route', async () => {
    const { GET } = await import('../src/app/api/control/status/route');
    const res = await GET(get('https://preston.test/api/control/status', HERMES_TOKEN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posture: string; environment: string };
    expect(body.posture).toBeDefined();
    expect(body.environment).toBeDefined();
  });

  it('hermes token reads the event feed and a goal', async () => {
    const { GET: events } = await import('../src/app/api/control/events/route');
    const r1 = await events(get('https://preston.test/api/control/events', HERMES_TOKEN));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { ok: boolean }).ok).toBe(true);

    const { GET: goal } = await import('../src/app/api/control/goals/[goal_id]/route');
    const r2 = await goal(
      get(`https://preston.test/api/control/goals/${GOAL_ID}`, HERMES_TOKEN),
      { params: Promise.resolve({ goal_id: GOAL_ID }) },
    );
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { found: boolean }).found).toBe(true);
  });

  it('gpt token still reads (both surfaces accepted on reads)', async () => {
    const { GET } = await import('../src/app/api/control/status/route');
    const res = await GET(get('https://preston.test/api/control/status', GPT_TOKEN));
    expect(res.status).toBe(200);
  });

  it('hermes token CANNOT submit a goal (wrong_client 403)', async () => {
    const { POST } = await import('../src/app/api/control/goals/route');
    const res = await POST(post('https://preston.test/api/control/goals', HERMES_TOKEN, {
      request: 'Audit the repository.',
    }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { status: string }).status).toBe('wrong_client');
  });

  it('hermes token CANNOT follow up a goal', async () => {
    const { POST } = await import('../src/app/api/control/goals/[goal_id]/follow-up/route');
    const res = await POST(
      post(`https://preston.test/api/control/goals/${GOAL_ID}/follow-up`, HERMES_TOKEN, {
        instruction: 'Continue.',
      }),
      { params: Promise.resolve({ goal_id: GOAL_ID }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { status: string }).status).toBe('wrong_client');
  });

  it('hermes token CANNOT decide an approval', async () => {
    const { POST } = await import(
      '../src/app/api/control/approvals/[approval_id]/decision/route'
    );
    const res = await POST(
      post('https://preston.test/api/control/approvals/apr-x/decision', HERMES_TOKEN, {
        outcome: 'approved',
      }),
      { params: Promise.resolve({ approval_id: 'apr-x1234567' }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { status: string }).status).toBe('wrong_client');
  });

  it('hermes token CANNOT cancel a goal', async () => {
    const { POST } = await import('../src/app/api/control/goals/[goal_id]/cancel/route');
    const res = await POST(
      post(`https://preston.test/api/control/goals/${GOAL_ID}/cancel`, HERMES_TOKEN, {}),
      { params: Promise.resolve({ goal_id: GOAL_ID }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { status: string }).status).toBe('wrong_client');
  });

  it('gpt decide path still runs the owner-confirmation handshake (unchanged)', async () => {
    const { POST } = await import(
      '../src/app/api/control/approvals/[approval_id]/decision/route'
    );
    const res = await POST(
      post('https://preston.test/api/control/approvals/apr-x/decision', GPT_TOKEN, {
        outcome: 'approved',
      }),
      { params: Promise.resolve({ approval_id: 'apr-x1234567' }) },
    );
    // Authenticated, reaches the tool, and WITHOUT an owner-confirmation
    // phrase NO decision happens - the G8 handshake refuses exactly as
    // before the hermes surface existed.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      decision_made?: boolean;
      error?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.decision_made).toBe(false);
    expect(String(body.error)).toContain('confirmation');
  });
});

// --- static pin: hermes stays off the consequential routes ------------------

describe('hermes surface - route source pins', () => {
  const APP = join(__dirname, '..', 'src', 'app', 'api', 'control');
  const READ_ROUTES = [
    'status/route.ts',
    'goals/[goal_id]/route.ts',
    'jobs/[job_id]/route.ts',
    'approvals/route.ts',
    'events/route.ts',
    'evidence/route.ts',
    'artifacts/[artifact_id]/route.ts',
  ];
  const WRITE_ROUTES = [
    'goals/route.ts',
    'goals/[goal_id]/follow-up/route.ts',
    'goals/[goal_id]/cancel/route.ts',
    'approvals/[approval_id]/decision/route.ts',
  ];

  it('every read route accepts READ_SURFACES', () => {
    for (const rel of READ_ROUTES) {
      const text = readFileSync(join(APP, rel), 'utf8');
      expect(text.includes('surfaces: READ_SURFACES'), rel).toBe(true);
    }
  });

  it('no consequential route ever names the hermes surface', () => {
    for (const rel of WRITE_ROUTES) {
      const text = readFileSync(join(APP, rel), 'utf8');
      expect(text.includes('hermes'), rel).toBe(false);
      expect(text.includes('READ_SURFACES'), rel).toBe(false);
      expect(text.includes('surfaces:'), rel).toBe(false);
    }
  });

  it('READ_SURFACES is exactly gpt + hermes', () => {
    expect([...READ_SURFACES].sort()).toEqual(['gpt', 'hermes']);
  });
});

// --- consent gate: the hermes client must reach the consent screen ----------
// Regression for the staging bootstrap failure "Consent refused:
// client_not_allowed": evaluateConsent admits exactly the env-registered
// clients, so the hermes client is consentable IFF its env is configured on
// the deployment that actually serves /oauth/consent (the auth server's
// Site URL must point at that deployment - a config fact, pinned in the
// gate report; this block pins the code side).

function consentDetails(clientId: string) {
  return {
    authorization_id: 'auth-req-12345678',
    client: { id: clientId, name: 'Preston Control — Hermes Staging' },
    scope: 'email',
    user: { id: 'u-owner', email: OWNER },
  };
}

describe('hermes surface - consent gate', () => {
  const CONSENT_ENV = { ...ENV_ON };

  it('the configured hermes client reaches consent', () => {
    const gate = evaluateConsent(consentDetails(HERMES_ID), OWNER, CONSENT_ENV);
    expect(gate).toEqual({ ok: true, scopes: ['email'] });
  });

  it('an unconfigured hermes client fails closed as client_not_allowed', () => {
    const env = { ...CONSENT_ENV, PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID: '' };
    expect(evaluateConsent(consentDetails(HERMES_ID), OWNER, env))
      .toEqual({ ok: false, reason: 'client_not_allowed' });
  });

  it('a wrong hermes client id fails with client_not_allowed', () => {
    expect(
      evaluateConsent(
        consentDetails('deadbeef-0000-4000-8000-000000000000'), OWNER, CONSENT_ENV,
      ),
    ).toEqual({ ok: false, reason: 'client_not_allowed' });
  });

  it('gpt and mcp clients still reach consent unchanged', () => {
    expect(evaluateConsent(consentDetails(GPT_ID), OWNER, CONSENT_ENV).ok).toBe(true);
    expect(evaluateConsent(consentDetails(MCP_ID), OWNER, CONSENT_ENV).ok).toBe(true);
  });

  it('no client configured at all is unconfigured, never allowed', () => {
    const env = {
      ...CONSENT_ENV,
      PRESTON_CONTROL_OAUTH_CLIENT_ID: '',
      PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID: '',
      PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID: '',
    };
    expect(evaluateConsent(consentDetails(HERMES_ID), OWNER, env))
      .toEqual({ ok: false, reason: 'unconfigured' });
  });

  it('a non-owner session can never consent for the hermes client', () => {
    expect(
      evaluateConsent(consentDetails(HERMES_ID), 'guest@example.com', CONSENT_ENV),
    ).toEqual({ ok: false, reason: 'user_not_owner' });
  });

  it('consent scope stays inside the allowlist for the hermes client', () => {
    const details = { ...consentDetails(HERMES_ID), scope: 'email admin' };
    expect(evaluateConsent(details, OWNER, CONSENT_ENV))
      .toEqual({ ok: false, reason: 'scope_not_allowed' });
  });
});
