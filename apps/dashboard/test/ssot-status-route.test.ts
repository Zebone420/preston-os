// SSOT B3 - /api/os/ssot/status header-gate tests. Same idiom as
// remote-routes.test.ts: the header-only fail-closed gates return BEFORE
// getServerSupabase(), so a plain Request stub suffices and Supabase env
// stays unset (a request clearing the gates resolves 503 'unconfigured'
// with no network attempt). DB-side behavior of the gateway is pinned
// statically in migration-0013.test.ts; there is deliberately NO env
// token gate here - per-actor auth lives in the 0012/0013 gateways.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as ssotGet } from '../src/app/api/os/ssot/status/route';

const ENV_KEYS = ['SSOT_STATUS_ENABLED', 'SUPABASE_RUNTIME_ENV'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

function enable() {
  process.env['SSOT_STATUS_ENABLED'] = 'true';
  process.env['SUPABASE_RUNTIME_ENV'] = 'staging';
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function req(over: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (over.auth !== undefined) headers.set('authorization', over.auth);
  return {
    headers,
    url: 'https://x.example/api/os/ssot/status',
  } as unknown as Request;
}

describe('GET /api/os/ssot/status - header-only fail-closed gates', () => {
  it('503 disabled unless SSOT_STATUS_ENABLED is exactly true', async () => {
    const res = await ssotGet(req({ auth: 'Bearer some-actor-token' }));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('disabled');

    process.env['SSOT_STATUS_ENABLED'] = 'TRUE';
    expect((await ssotGet(req())).status).toBe(503);
  });

  it('503 unconfigured outside staging', async () => {
    process.env['SSOT_STATUS_ENABLED'] = 'true';
    process.env['SUPABASE_RUNTIME_ENV'] = 'production';
    const res = await ssotGet(req({ auth: 'Bearer some-actor-token' }));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });

  it('401 on absent, malformed, or oversize bearer', async () => {
    enable();
    expect((await ssotGet(req())).status).toBe(401);
    expect((await ssotGet(req({ auth: 'Basic abc' }))).status).toBe(401);
    expect((await ssotGet(req({ auth: 'Bearer ' }))).status).toBe(401);
    expect((await ssotGet(req({ auth: `Bearer ${'x'.repeat(200)}` }))).status).toBe(401);
  });

  it('503 unconfigured (no Supabase env) after gates pass - no network', async () => {
    enable();
    const res = await ssotGet(req({ auth: 'Bearer some-actor-token' }));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });
});

describe('proxy exclusion pin', () => {
  it('matcher excludes api/os/ssot so bearer calls reach the route', () => {
    const proxy = readFileSync(
      join(__dirname, '..', 'src', 'proxy.ts'), 'utf8');
    const m = proxy.match(/matcher: \['([^']+)'\]/);
    expect(m, 'proxy matcher not found').toBeTruthy();
    expect(m![1]).toContain('api/os/ssot');
    // The existing exclusions must survive this edit.
    for (const p of ['api/health', 'api/os/chatgpt', 'api/os/remote']) {
      expect(m![1]).toContain(p);
    }
  });
});
