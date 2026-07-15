import { describe, expect, it, vi } from 'vitest';
import {
  missingRuntimeEnv,
  refreshRuntimeToken,
  resolveRuntimeToken,
} from '../src/os-runtime/supabase-runtime';

const BASE = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_RUNTIME_KEY: 'anon' };

function okFetch(token: string) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ access_token: token }) }) as unknown as Response) as unknown as typeof fetch;
}

describe('missingRuntimeEnv', () => {
  it('requires url + key + (token or refresh token)', () => {
    expect(missingRuntimeEnv({})).toContain('SUPABASE_URL');
    expect(missingRuntimeEnv(BASE)).toContain('SUPABASE_RUNTIME_TOKEN|SUPABASE_RUNTIME_REFRESH_TOKEN');
    expect(missingRuntimeEnv({ ...BASE, SUPABASE_RUNTIME_TOKEN: 't' })).toEqual([]);
    expect(missingRuntimeEnv({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'r' })).toEqual([]);
  });
});

describe('refreshRuntimeToken (durable, injected fetch)', () => {
  it('mints a fresh access token from the refresh token', async () => {
    const calls: { url: string; body: string }[] = [];
    const mock = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return { ok: true, json: async () => ({ access_token: 'FRESH-abc' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const t = await refreshRuntimeToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'r1' }, mock);
    expect(t).toBe('FRESH-abc');
    expect(calls[0].url).toContain('/auth/v1/token?grant_type=refresh_token');
    expect(calls[0].body).toContain('r1');
  });

  it('fails closed on a non-200 (revoked/expired refresh token)', async () => {
    const bad = (async () => ({ ok: false, status: 400, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(refreshRuntimeToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'r' }, bad)).rejects.toThrow('reconnect required');
  });

  it('fails closed when the exchange returns no token', async () => {
    const empty = (async () => ({ ok: true, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(refreshRuntimeToken({ ...BASE, SUPABASE_RUNTIME_REFRESH_TOKEN: 'r' }, empty)).rejects.toThrow('fail-closed');
  });
});

describe('resolveRuntimeToken precedence', () => {
  it('prefers the refresh flow over a static token', async () => {
    const t = await resolveRuntimeToken(
      { ...BASE, SUPABASE_RUNTIME_TOKEN: 'STATIC', SUPABASE_RUNTIME_REFRESH_TOKEN: 'r' },
      okFetch('MINTED'),
    );
    expect(t).toBe('MINTED');
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
