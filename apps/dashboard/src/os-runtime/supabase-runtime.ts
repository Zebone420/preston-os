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

// Exchange the stored refresh token for a fresh access token. Injectable fetch
// for tests (no live call in CI). Fail-closed; error carries only an HTTP status.
export async function refreshRuntimeToken(env: Env, fetchImpl: FetchLike): Promise<string> {
  const base = String(env['SUPABASE_URL']).replace(/\/+$/, '');
  const res = await fetchImpl(base + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: String(env['SUPABASE_RUNTIME_KEY']),
    },
    body: JSON.stringify({ refresh_token: String(env['SUPABASE_RUNTIME_REFRESH_TOKEN']) }),
  });
  if (!res.ok) {
    throw new Error('supabase token refresh failed with status ' + res.status + ' (reconnect required)');
  }
  const json = (await res.json()) as { access_token?: string };
  const token = (json.access_token ?? '').trim();
  if (token === '') {
    throw new Error('supabase token refresh returned no access token (fail-closed)');
  }
  return token;
}

// Prefer the durable refresh flow; fall back to a static access token.
export async function resolveRuntimeToken(env: Env, fetchImpl: FetchLike): Promise<string> {
  if (present(env['SUPABASE_RUNTIME_REFRESH_TOKEN'])) {
    return refreshRuntimeToken(env, fetchImpl);
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
