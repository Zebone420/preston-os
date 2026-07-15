import { createClient } from '@supabase/supabase-js';
import type { RuntimeClient } from '../lib/ai-os/store';

// Preston AI OS - standalone runtime Supabase client (Phase 4B.1 / 4B.2).
// Used ONLY by the compiled remote dispatchers (not the Next app). Builds an
// RLS-bound client for the worker/Hermes SERVICE IDENTITY - an owner-allowlisted
// authenticated user, NEVER the service-role key.
//
// DURABILITY (laptop-closed): a static access token expires (~1h), which would
// break long-running timer-driven services. So a REFRESH TOKEN is preferred: at
// each bounded oneshot startup the dispatcher exchanges it for a fresh access
// token (valid well beyond the <5min run). Read-only intent; fail-closed; never
// logs a token.

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

function present(v: string | undefined): boolean {
  return !!(v && String(v).trim() !== '');
}

// SUPABASE_URL + anon key are always required; plus EITHER a static access
// token OR (preferred) a refresh token.
export function missingRuntimeEnv(env: Env): string[] {
  const missing: string[] = [];
  if (!present(env['SUPABASE_URL'])) missing.push('SUPABASE_URL');
  if (!present(env['SUPABASE_RUNTIME_KEY'])) missing.push('SUPABASE_RUNTIME_KEY');
  if (!present(env['SUPABASE_RUNTIME_TOKEN']) && !present(env['SUPABASE_RUNTIME_REFRESH_TOKEN'])) {
    missing.push('SUPABASE_RUNTIME_TOKEN|SUPABASE_RUNTIME_REFRESH_TOKEN');
  }
  return missing;
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string | null; // the ROTATED refresh token (Supabase rotates by default)
}

// Durable refresh-token store (atomic on the host; injected as a fake in tests).
// Holds the CURRENT refresh token so successive oneshots present a valid one -
// Supabase rotates refresh tokens on use, so reusing a consumed one revokes the
// session family.
export interface TokenStore {
  read(): string | null;
  write(refreshToken: string): void;
}

// Exchange a refresh token for a fresh access token AND capture the rotated
// refresh token. Injectable fetch for tests. Fail-closed; errors carry only an
// HTTP status - never a token.
export async function refreshRuntimeToken(
  env: Env,
  fetchImpl: FetchLike,
  refreshToken: string,
): Promise<RefreshResult> {
  const base = String(env['SUPABASE_URL']).replace(/\/+$/, '');
  const res = await fetchImpl(base + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: String(env['SUPABASE_RUNTIME_KEY']) },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error('supabase token refresh failed with status ' + res.status + ' (reconnect required)');
  }
  const json = (await res.json()) as { access_token?: string; refresh_token?: string };
  const access = (json.access_token ?? '').trim();
  if (access === '') {
    throw new Error('supabase token refresh returned no access token (fail-closed)');
  }
  const rotated = (json.refresh_token ?? '').trim();
  return { access_token: access, refresh_token: rotated !== '' ? rotated : null };
}

// Prefer the durable refresh flow (current token from the store, else env),
// persisting the ROTATED refresh token so the next oneshot stays valid; fall
// back to a static access token; else fail closed.
export async function resolveRuntimeToken(
  env: Env,
  fetchImpl: FetchLike,
  store?: TokenStore | null,
): Promise<string> {
  const current = (store?.read() ?? env['SUPABASE_RUNTIME_REFRESH_TOKEN'] ?? '').trim();
  if (current !== '') {
    const r = await refreshRuntimeToken(env, fetchImpl, current);
    if (store && r.refresh_token) store.write(r.refresh_token); // persist rotation
    return r.access_token;
  }
  const staticToken = (env['SUPABASE_RUNTIME_TOKEN'] ?? '').trim();
  if (staticToken !== '') return staticToken;
  throw new Error('no runtime token or refresh token configured (fail-closed)');
}

export function createRuntimeClientWithToken(env: Env, token: string): RuntimeClient {
  const client = createClient(String(env['SUPABASE_URL']), String(env['SUPABASE_RUNTIME_KEY']), {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client as unknown as RuntimeClient;
}
