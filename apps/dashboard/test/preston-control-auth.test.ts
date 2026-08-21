import { describe, expect, it } from 'vitest';
import {
  authenticateControlRequest,
  bearerFrom,
  controlSurfaceEnabled,
  decodeJwtPayload,
  MAX_BEARER_LENGTH,
  type ControlClient,
} from '../src/lib/preston-control/auth';

// Preston Control auth - every gate fails closed. No real JWT signature is
// involved: the verifier is injected (Supabase Auth is the authority in
// production); these tests pin the ORDER and the OUTCOME of each gate.

const CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const OWNER = 'info@preston.nyc';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const OWNER_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: CLIENT_ID, email: OWNER });

function env(over: Record<string, string | undefined> = {}) {
  return {
    PRESTON_CONTROL_ENABLED: 'true',
    PRESTON_CONTROL_OAUTH_CLIENT_ID: CLIENT_ID,
    SUPABASE_RUNTIME_ENV: 'staging',
    OWNER_EMAIL_ALLOWLIST: OWNER,
    ...over,
  };
}

interface FakeOpts {
  users?: Record<string, { id: string; email: string | null }>; // token -> user
  isOwner?: (token: string) => boolean;
  rpcError?: string;
}

function fakeDeps(opts: FakeOpts = {}) {
  const calls: string[] = [];
  const clientFor = (token: string): ControlClient => ({
    auth: {
      async getUser(t: string) {
        calls.push('getUser');
        const u = opts.users?.[t];
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    rpc(fn: string) {
      calls.push('rpc:' + fn);
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      if (fn === 'is_owner') return Promise.resolve({ data: opts.isOwner ? opts.isOwner(token) : true, error: null });
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    },
  });
  return { deps: { clientFor }, calls };
}

const ownerUsers = { [OWNER_TOKEN]: { id: 'u-owner', email: OWNER } };

describe('preston-control auth gates', () => {
  it('disabled -> 503 before any verifier call', async () => {
    const { deps, calls } = fakeDeps({ users: ownerUsers });
    const r = await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env({ PRESTON_CONTROL_ENABLED: undefined }), deps);
    expect(r).toMatchObject({ ok: false, reason: 'disabled', httpStatus: 503 });
    expect(calls).toEqual([]);
  });

  it('wrong environment / missing client id -> unconfigured 503', async () => {
    const { deps } = fakeDeps({ users: ownerUsers });
    expect(await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env({ SUPABASE_RUNTIME_ENV: 'development' }), deps))
      .toMatchObject({ ok: false, reason: 'unconfigured' });
    expect(await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env({ PRESTON_CONTROL_OAUTH_CLIENT_ID: '' }), deps))
      .toMatchObject({ ok: false, reason: 'unconfigured' });
  });

  it('no auth / non-bearer / oversize -> 401 without touching the verifier', async () => {
    const { deps, calls } = fakeDeps({ users: ownerUsers });
    expect(await authenticateControlRequest(null, env(), deps)).toMatchObject({ ok: false, reason: 'missing_token', httpStatus: 401 });
    expect(await authenticateControlRequest('Basic abc', env(), deps)).toMatchObject({ ok: false, reason: 'missing_token' });
    expect(await authenticateControlRequest('Bearer ' + 'x'.repeat(MAX_BEARER_LENGTH + 1), env(), deps)).toMatchObject({ ok: false, reason: 'missing_token' });
    expect(calls).toEqual([]);
  });

  it('expired / forged token (verifier rejects) -> invalid_token 401', async () => {
    const { deps, calls } = fakeDeps({ users: {} });
    const r = await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env(), deps);
    expect(r).toMatchObject({ ok: false, reason: 'invalid_token', httpStatus: 401 });
    expect(calls).toEqual(['getUser']); // never reached the owner RPC
  });

  it('verifier throwing -> invalid_token (fail closed, no crash)', async () => {
    const deps = { clientFor: () => ({
      auth: { getUser: async () => { throw new Error('network'); } },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }) };
    expect(await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env(), deps)).toMatchObject({ ok: false, reason: 'invalid_token' });
  });

  it('wrong audience -> wrong_client 403', async () => {
    const t = jwt({ sub: 'u-owner', aud: 'other', client_id: CLIENT_ID, email: OWNER });
    const { deps } = fakeDeps({ users: { [t]: { id: 'u-owner', email: OWNER } } });
    expect(await authenticateControlRequest('Bearer ' + t, env(), deps)).toMatchObject({ ok: false, reason: 'wrong_client', httpStatus: 403 });
  });

  it('a plain dashboard session JWT (no client_id) is refused even for the owner', async () => {
    const t = jwt({ sub: 'u-owner', aud: 'authenticated', email: OWNER });
    const { deps, calls } = fakeDeps({ users: { [t]: { id: 'u-owner', email: OWNER } } });
    expect(await authenticateControlRequest('Bearer ' + t, env(), deps)).toMatchObject({ ok: false, reason: 'wrong_client' });
    expect(calls).not.toContain('rpc:is_owner');
  });

  it('token minted for another OAuth client -> wrong_client', async () => {
    const t = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: 'someone-else', email: OWNER });
    const { deps } = fakeDeps({ users: { [t]: { id: 'u-owner', email: OWNER } } });
    expect(await authenticateControlRequest('Bearer ' + t, env(), deps)).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('non-owner user (not on allowlist) -> not_owner 403 before the DB check', async () => {
    const t = jwt({ sub: 'u-guest', aud: 'authenticated', client_id: CLIENT_ID, email: 'guest@example.com' });
    const { deps, calls } = fakeDeps({ users: { [t]: { id: 'u-guest', email: 'guest@example.com' } } });
    expect(await authenticateControlRequest('Bearer ' + t, env(), deps)).toMatchObject({ ok: false, reason: 'not_owner', httpStatus: 403 });
    expect(calls).toEqual(['getUser']);
  });

  it('empty allowlist -> nobody is owner', async () => {
    const { deps } = fakeDeps({ users: ownerUsers });
    expect(await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env({ OWNER_EMAIL_ALLOWLIST: '' }), deps)).toMatchObject({ ok: false, reason: 'not_owner' });
  });

  it('runtime service identity (allowlisted by mistake, is_owner()=false) -> not_owner: DB is the authority', async () => {
    const t = jwt({ sub: 'u-runtime', aud: 'authenticated', client_id: CLIENT_ID, email: 'runtime@service.preston' });
    const { deps, calls } = fakeDeps({
      users: { [t]: { id: 'u-runtime', email: 'runtime@service.preston' } },
      isOwner: () => false,
    });
    const r = await authenticateControlRequest('Bearer ' + t, env({ OWNER_EMAIL_ALLOWLIST: OWNER + ',runtime@service.preston' }), deps);
    expect(r).toMatchObject({ ok: false, reason: 'not_owner', httpStatus: 403 });
    expect(calls).toEqual(['getUser', 'rpc:is_owner']);
  });

  it('is_owner RPC error -> not_owner (fail closed)', async () => {
    const { deps } = fakeDeps({ users: ownerUsers, rpcError: 'permission denied' });
    expect(await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env(), deps)).toMatchObject({ ok: false, reason: 'not_owner' });
  });

  it('owner via the Preston Control client passes and yields the RLS-bound client', async () => {
    const { deps, calls } = fakeDeps({ users: ownerUsers });
    const r = await authenticateControlRequest('Bearer ' + OWNER_TOKEN, env(), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ownerEmail).toBe(OWNER);
      expect(r.userId).toBe('u-owner');
    }
    expect(calls).toEqual(['getUser', 'rpc:is_owner']);
  });

  it('accepts aud as an array containing authenticated', async () => {
    const t = jwt({ sub: 'u-owner', aud: ['authenticated'], client_id: CLIENT_ID, email: OWNER });
    const { deps } = fakeDeps({ users: { [t]: { id: 'u-owner', email: OWNER } } });
    expect((await authenticateControlRequest('Bearer ' + t, env(), deps)).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('bearerFrom / decodeJwtPayload / controlSurfaceEnabled', () => {
    expect(bearerFrom('Bearer abc ')).toBe('abc');
    expect(bearerFrom('bearer abc')).toBe('');
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!.c')).toBeNull();
    expect(decodeJwtPayload(OWNER_TOKEN)).toMatchObject({ client_id: CLIENT_ID });
    expect(controlSurfaceEnabled(env())).toBe(true);
    expect(controlSurfaceEnabled(env({ PRESTON_CONTROL_ENABLED: 'TRUE' }))).toBe(false);
    expect(controlSurfaceEnabled(env({ SUPABASE_RUNTIME_ENV: 'prod' }))).toBe(false);
    expect(controlSurfaceEnabled(env({ SUPABASE_RUNTIME_ENV: 'production' }))).toBe(true);
  });
});
