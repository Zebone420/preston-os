import { describe, expect, it, vi } from 'vitest';
import {
  missingRuntimeEnv,
  refreshRuntimeToken,
  resolveWorkerToken,
  type TokenStore,
} from '../src/os-runtime/supabase-runtime';

const BASE = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_RUNTIME_KEY: 'anon' };

describe('missingRuntimeEnv', () => {
  it('requires url + key only (token sourcing is resolveWorkerToken\'s job)', () => {
    expect(missingRuntimeEnv({})).toContain('SUPABASE_URL');
    expect(missingRuntimeEnv({ SUPABASE_URL: 'u' })).toContain('SUPABASE_RUNTIME_KEY');
    expect(missingRuntimeEnv(BASE)).toEqual([]); // no env token needed post-bootstrap
  });
});

function rotatingFetch(access: string, rotated: string | undefined) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ access_token: access, refresh_token: rotated }) }) as unknown as Response) as unknown as typeof fetch;
}

describe('refreshRuntimeToken (durable, injected fetch)', () => {
  it('mints a fresh access token and captures the rotated refresh token', async () => {
    const calls: { url: string; body: string }[] = [];
    const mock = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return { ok: true, json: async () => ({ access_token: 'FRESH-abc', refresh_token: 'RT1' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await refreshRuntimeToken(BASE, mock, 'RT0');
    expect(r.access_token).toBe('FRESH-abc');
    expect(r.refresh_token).toBe('RT1'); // rotated captured
    expect(calls[0].url).toContain('/auth/v1/token?grant_type=refresh_token');
    expect(calls[0].body).toContain('RT0');
  });

  it('fails closed on a non-200 (revoked/expired refresh token)', async () => {
    const bad = (async () => ({ ok: false, status: 400, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(refreshRuntimeToken(BASE, bad, 'r')).rejects.toThrow('reconnect required');
  });

  it('fails closed when the exchange returns no access token', async () => {
    const empty = (async () => ({ ok: true, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(refreshRuntimeToken(BASE, empty, 'r')).rejects.toThrow('fail-closed');
  });
});

function memStore(initial: string | null): TokenStore & { value: string | null } {
  const s = { value: initial, read: () => s.value, write: (t: string) => { s.value = t; } };
  return s;
}
const noFetch = (async () => { throw new Error('fetch should not be called'); }) as unknown as typeof fetch;

describe('resolveWorkerToken - diagnostic mode (static token only)', () => {
  it('returns the static access token', async () => {
    expect(await resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_TOKEN: 'STATIC' }, noFetch, null, { diagnostic: true })).toBe('STATIC');
  });
  it('fails closed with no static token', async () => {
    await expect(resolveWorkerToken(BASE, noFetch, null, { diagnostic: true })).rejects.toThrow('fail-closed');
  });
});

describe('resolveWorkerToken - service mode (durable store required)', () => {
  it('rejects service operation with no store (static-only refused)', async () => {
    await expect(resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_TOKEN: 'STATIC' }, noFetch, null)).rejects.toThrow('required for service operation');
  });

  it('bootstraps from the env refresh token ONLY with allowBootstrap, then persists the rotated token', async () => {
    const store = memStore(null);
    const calls: string[] = [];
    const mock = vi.fn(async (_u: string, init?: { body?: string }) => { calls.push(String(init?.body ?? '')); return { ok: true, json: async () => ({ access_token: 'A1', refresh_token: 'RT1' }) } as unknown as Response; }) as unknown as typeof fetch;
    const t = await resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'BOOT' }, mock, store, { allowBootstrap: true });
    expect(t).toBe('A1');
    expect(calls[0]).toContain('BOOT'); // bootstrap token used once
    // C2: the store persists a v2 JSON payload; the rotated refresh token is
    // inside it (no expiry in this mock response => no access-token caching).
    expect(JSON.parse(store.value ?? '{}')).toEqual({ v: 2, refresh_token: 'RT1' });
  });

  it('an empty store WITHOUT allowBootstrap fails closed (no env re-use)', async () => {
    await expect(resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'STALE' }, noFetch, memStore(null))).rejects.toThrow('run once with --bootstrap');
  });

  it('uses the store token and IGNORES the env after bootstrap (no consumed-token reuse)', async () => {
    const store = memStore('RT-current');
    const calls: string[] = [];
    const mock = vi.fn(async (_u: string, init?: { body?: string }) => { calls.push(String(init?.body ?? '')); return { ok: true, json: async () => ({ access_token: 'A2', refresh_token: 'RT2' }) } as unknown as Response; }) as unknown as typeof fetch;
    await resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'STALE-ENV' }, mock, store);
    expect(calls[0]).toContain('RT-current'); // legacy bare-string store accepted
    expect(calls[0]).not.toContain('STALE-ENV'); // env ignored once bootstrapped
    expect(JSON.parse(store.value ?? '{}').refresh_token).toBe('RT2');
  });

  // --- fast-track C2: persisted access-token reuse -------------------------

  it('reuses a persisted unexpired access token WITHOUT a network refresh', async () => {
    const store = memStore(JSON.stringify({
      v: 2, refresh_token: 'RT-live', access_token: 'A-cached',
      access_expires_at_ms: Date.now() + 30 * 60_000,
    }));
    const t = await resolveWorkerToken(BASE, noFetch, store);
    expect(t).toBe('A-cached'); // noFetch would throw if a refresh happened
    expect(JSON.parse(store.value ?? '{}').refresh_token).toBe('RT-live'); // untouched
  });

  it('refreshes (and rotates) when the cached access token is near expiry', async () => {
    const store = memStore(JSON.stringify({
      v: 2, refresh_token: 'RT-old', access_token: 'A-stale',
      access_expires_at_ms: Date.now() + 30_000, // inside the 120s margin
    }));
    const mock = (async () => ({
      ok: true,
      json: async () => ({ access_token: 'A-new', refresh_token: 'RT-new', expires_in: 3600 }),
    }) as unknown as Response) as unknown as typeof fetch;
    const t = await resolveWorkerToken(BASE, mock, store);
    expect(t).toBe('A-new');
    const p = JSON.parse(store.value ?? '{}');
    expect(p.refresh_token).toBe('RT-new');
    expect(p.access_token).toBe('A-new'); // expiry declared => cached for reuse
    expect(p.access_expires_at_ms).toBeGreaterThan(Date.now());
  });

  it('fails closed on a malformed v2 store payload (never falls back to env)', async () => {
    const store = memStore('{not json');
    await expect(
      resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'ENV' }, noFetch, store),
    ).rejects.toThrow('malformed');
  });

  it('fails closed when the store is unreadable/insecure (does NOT fall back to env)', async () => {
    const bad: TokenStore = { read: () => { throw new Error('token store has group/other access (insecure)'); }, write: () => {} };
    await expect(resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'BOOT' }, noFetch, bad)).rejects.toThrow('insecure');
  });

  it('fails closed when the store is empty and no bootstrap token is set', async () => {
    await expect(resolveWorkerToken(BASE, noFetch, memStore(null))).rejects.toThrow('reconnect/reprovision');
  });

  it('fails closed when the refresh response has no rotated token', async () => {
    const noRotate = (async () => ({ ok: true, json: async () => ({ access_token: 'A' }) }) as unknown as Response) as unknown as typeof fetch;
    await expect(resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'BOOT' }, noRotate, memStore(null), { allowBootstrap: true })).rejects.toThrow('reconnect required');
  });

  it('fails closed on concurrent write (store lock held)', async () => {
    const locked: TokenStore = { read: () => 'RT', write: () => { throw new Error('token store is locked by another writer (concurrent access)'); } };
    await expect(resolveWorkerToken(BASE, rotatingFetch('A', 'RT3'), locked)).rejects.toThrow('locked by another writer');
  });
});
