// Phase 8 - /api/os/remote/goal + /api/os/remote/status header-gate tests.
// Same idiom as chatgpt-route.test.ts: the header-only fail-closed gates
// return BEFORE getServerSupabase(), so a plain Request stub suffices and
// Supabase env stays unset (a request clearing the gates resolves 503
// 'unconfigured' with no network attempt). The DB-side behavior of the
// gateway RPCs is pinned statically in migration-0011.test.ts and proven
// live on the migrated staging DB.

import { afterEach, describe, expect, it } from 'vitest';
import { POST as goalPost } from '../src/app/api/os/remote/goal/route';
import { GET as statusGet } from '../src/app/api/os/remote/status/route';

const ENV_KEYS = [
  'REMOTE_INTAKE_ENABLED', 'REMOTE_INTAKE_TOKEN', 'SUPABASE_RUNTIME_ENV',
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

const TOKEN = 's3cr3t-remote-token';

function enable() {
  process.env['REMOTE_INTAKE_ENABLED'] = 'true';
  process.env['REMOTE_INTAKE_TOKEN'] = TOKEN;
  process.env['SUPABASE_RUNTIME_ENV'] = 'staging';
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function goalReq(over: {
  auth?: string; length?: string | null; body?: unknown;
} = {}): Request {
  const headers = new Headers();
  if (over.auth !== undefined) headers.set('authorization', over.auth);
  if (over.length !== null) headers.set('content-length', over.length ?? '100');
  return {
    headers,
    json: async () => over.body ?? {
      request_id: 'req-abc-12345678', owner_identity: 'info@preston.nyc',
      request: 'Create a goal to tidy docs. Create tasks to inspect README.',
    },
    url: 'https://x.example/api/os/remote/goal',
  } as unknown as Request;
}

function statusReq(over: { auth?: string; id?: string } = {}): Request {
  const headers = new Headers();
  if (over.auth !== undefined) headers.set('authorization', over.auth);
  return {
    headers,
    url: `https://x.example/api/os/remote/status?request_id=${over.id ?? 'req-abc-12345678'}`,
  } as unknown as Request;
}

describe('POST /api/os/remote/goal - header-only fail-closed gates', () => {
  it('503 disabled when REMOTE_INTAKE_ENABLED is not exactly true', async () => {
    const res = await goalPost(goalReq());
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('disabled');
  });

  it('503 unconfigured outside the env allowlist (P1: staging|production)', async () => {
    process.env['REMOTE_INTAKE_ENABLED'] = 'true';
    for (const bad of ['test_dev', '', 'Production', 'prod']) {
      process.env['SUPABASE_RUNTIME_ENV'] = bad;
      const res = await goalPost(goalReq({ auth: `Bearer ${TOKEN}` }));
      expect(res.status).toBe(503);
      expect((await res.json()).status).toBe('unconfigured');
    }
    delete process.env['SUPABASE_RUNTIME_ENV'];
    expect((await goalPost(goalReq({ auth: `Bearer ${TOKEN}` }))).status).toBe(503);
  });

  it('production passes the env gate (P1) and still fails closed at the next gate', async () => {
    process.env['REMOTE_INTAKE_ENABLED'] = 'true';
    process.env['SUPABASE_RUNTIME_ENV'] = 'production';
    // Clears env gates, then 503 'unconfigured' from the ABSENT Supabase
    // env - proving the request reached the delegation step, no network.
    const res = await goalPost(goalReq({ auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });

  it('413 on missing or oversize Content-Length BEFORE reading the body', async () => {
    enable();
    expect((await goalPost(goalReq({ length: null, auth: `Bearer ${TOKEN}` }))).status).toBe(413);
    expect((await goalPost(goalReq({ length: '999999', auth: `Bearer ${TOKEN}` }))).status).toBe(413);
  });

  it('401 only on an ABSENT/EMPTY bearer; token VALUES are never judged in the web tier', async () => {
    // S4 live defect (2026-08-11): the old web-tier equality gate against
    // REMOTE_INTAKE_TOKEN blocked valid ACTOR tokens before the gateway
    // could authenticate them. Authentication is delegated: any presented
    // token must pass the web gate and reach the RPC (here: 503
    // unconfigured because no Supabase env exists - proving the request
    // got PAST authentication and to the delegation step).
    enable();
    expect((await goalPost(goalReq())).status).toBe(401); // no header
    expect((await goalPost(goalReq({ auth: 'Bearer ' }))).status).toBe(401); // empty
    const delegated = await goalPost(goalReq({ auth: 'Bearer some-actor-token' }));
    expect(delegated.status).toBe(503);
    expect((await delegated.json()).status).toBe('unconfigured');
  });

  it('web tier holds NO token material: route source has no env-token compare (S4 pin)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      'src/app/api/os/remote/goal/route.ts', 'utf8');
    expect(src).not.toContain("env['REMOTE_INTAKE_TOKEN']"); // no env token read
    expect(src).not.toContain('constantTimeEqual'); // no web-tier compare
    expect(src).toContain('submit_remote_intake'); // delegation target
  });

  it('400 on malformed JSON after the gates', async () => {
    enable();
    const req = goalReq({ auth: `Bearer ${TOKEN}` });
    (req as unknown as { json: () => Promise<unknown> }).json =
      async () => { throw new Error('bad json'); };
    expect((await goalPost(req)).status).toBe(400);
  });

  it('503 unconfigured (no Supabase env) once every gate passes - no network', async () => {
    enable();
    const res = await goalPost(goalReq({ auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });
});

describe('GET /api/os/remote/status - header-only fail-closed gates', () => {
  it('503 disabled by default', async () => {
    expect((await statusGet(statusReq())).status).toBe(503);
  });

  it('401 without the bearer token', async () => {
    enable();
    expect((await statusGet(statusReq())).status).toBe(401);
  });

  it('400 on a missing request_id', async () => {
    enable();
    const res = await statusGet(statusReq({ auth: `Bearer ${TOKEN}`, id: '' }));
    expect(res.status).toBe(400);
  });

  it('503 unconfigured (no Supabase env) after gates pass - no network', async () => {
    enable();
    const res = await statusGet(statusReq({ auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(503);
  });
});
