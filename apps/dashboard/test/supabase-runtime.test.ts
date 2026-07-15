import { describe, expect, it, vi } from 'vitest';
import {
  missingRuntimeEnv,
  refreshRuntimeToken,
  resolveWorkerToken,
  type TokenStore,
} from '../src/os-runtime/supabase-runtime';

const BASE = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_RUNTIME_KEY: 'anon' };

describe('missingRuntimeEnv', () => {
  it('requires url + key + (token or refresh token)', () => {
    expect(missingRuntimeEnv({})).toContain('SUPABASE_URL');
    expect(missingRuntimeEnv(BASE)).toContain('SUPABASE_RUNTIME_TOKEN|SUPABASE_RUNTIME_REFRESH_TOKEN');
    expect(missingRuntimeEnv({ ...BASE, SUPABASE_RUNTIME_TOKEN: 't' })).toEqual([]);
    expect(missingRuntimeEnv({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'r' })).toEqual([]);
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

  it('bootstraps from the env refresh token when the store is empty, then persists the rotated token', async () => {
    const store = memStore(null);
    const calls: string[] = [];
    const mock = vi.fn(async (_u: string, init?: { body?: string }) => { calls.push(String(init?.body ?? '')); return { ok: true, json: async () => ({ access_token: 'A1', refresh_token: 'RT1' }) } as unknown as Response; }) as unknown as typeof fetch;
    const t = await resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'BOOT' }, mock, store);
    expect(t).toBe('A1');
    expect(calls[0]).toContain('BOOT'); // bootstrap token used once
    expect(store.value).toBe('RT1'); // rotated token persisted
  });

  it('uses the store token and IGNORES the env after bootstrap (no consumed-token reuse)', async () => {
    const store = memStore('RT-current');
    const calls: string[] = [];
    const mock = vi.fn(async (_u: string, init?: { body?: string }) => { calls.push(String(init?.body ?? '')); return { ok: true, json: async () => ({ access_token: 'A2', refresh_token: 'RT2' }) } as unknown as Response; }) as unknown as typeof fetch;
    await resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'STALE-ENV' }, mock, store);
    expect(calls[0]).toContain('RT-current');
    expect(calls[0]).not.toContain('STALE-ENV'); // env ignored once bootstrapped
    expect(store.value).toBe('RT2');
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
    await expect(resolveWorkerToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'BOOT' }, noRotate, memStore(null))).rejects.toThrow('reconnect required');
  });

  it('fails closed on concurrent write (store lock held)', async () => {
    const locked: TokenStore = { read: () => 'RT', write: () => { throw new Error('token store is locked by another writer (concurrent access)'); } };
    await expect(resolveWorkerToken(BASE, rotatingFetch('A', 'RT3'), locked)).rejects.toThrow('locked by another writer');
  });
});
