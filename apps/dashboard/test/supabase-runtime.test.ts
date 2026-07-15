import { describe, expect, it, vi } from 'vitest';
import {
  missingRuntimeEnv,
  refreshRuntimeToken,
  resolveRuntimeToken,
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

describe('resolveRuntimeToken precedence + rotation persistence', () => {
  it('prefers the refresh flow over a static token and persists the rotated token', async () => {
    let stored: string | null = 'RT-old';
    const store = { read: () => stored, write: (t: string) => { stored = t; } };
    const t = await resolveRuntimeToken(
      { ...BASE, SUPABASE_RUNTIME_TOKEN: 'STATIC' },
      rotatingFetch('MINTED', 'RT-new'),
      store,
    );
    expect(t).toBe('MINTED');
    expect(stored).toBe('RT-new'); // rotated token persisted for the next run
  });

  it('reads the current refresh token from the store over the env', async () => {
    const calls: string[] = [];
    const mock = vi.fn(async (_url: string, init?: { body?: string }) => {
      calls.push(String(init?.body ?? ''));
      return { ok: true, json: async () => ({ access_token: 'A', refresh_token: 'RT2' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await resolveRuntimeToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'env-rt' }, mock, { read: () => 'store-rt', write: () => {} });
    expect(calls[0]).toContain('store-rt'); // store wins over env
  });

  it('falls back to the static token when no refresh token is set', async () => {
    const noFetch = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    expect(await resolveRuntimeToken({ ...BASE, SUPABASE_RUNTIME_TOKEN: 'STATIC' }, noFetch)).toBe('STATIC');
  });

  it('fails closed when neither is configured', async () => {
    const noFetch = (async () => ({}) as unknown as Response) as unknown as typeof fetch;
    await expect(resolveRuntimeToken(BASE, noFetch)).rejects.toThrow('fail-closed');
  });
});
