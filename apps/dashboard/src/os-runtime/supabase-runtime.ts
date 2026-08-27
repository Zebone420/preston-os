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

// Only URL + anon key are strictly required here. Token sourcing (store vs
// bootstrap vs diagnostic) is enforced by resolveWorkerToken, so the operator
// can REMOVE the consumed bootstrap refresh token from the env after seeding.
export function missingRuntimeEnv(env: Env): string[] {
  const missing: string[] = [];
  if (!present(env['SUPABASE_URL'])) missing.push('SUPABASE_URL');
  if (!present(env['SUPABASE_RUNTIME_KEY'])) missing.push('SUPABASE_RUNTIME_KEY');
  return missing;
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string | null; // the ROTATED refresh token (Supabase rotates by default)
  // Fast-track C2: when the auth response declares the access token's expiry
  // it is captured (epoch ms) so oneshots can REUSE the token until near
  // expiry instead of paying a full refresh-grant + rotation every tick.
  access_expires_at_ms: number | null;
}

// Persisted token-store payload (v2). Backward compatible: a legacy store
// containing a bare refresh-token string is still accepted (refresh-only).
interface StorePayloadV2 {
  v: 2;
  refresh_token: string;
  access_token?: string;
  access_expires_at_ms?: number;
}

// Reuse margin: an access token within 2 minutes of expiry is treated as
// expired (a bounded oneshot finishes well within that window).
const ACCESS_REUSE_MARGIN_MS = 120_000;

// Durable refresh-token store (atomic + locked on the host; injected as a fake
// in tests). Holds the CURRENT refresh token so successive oneshots present a
// valid one - Supabase rotates refresh tokens on use, so reusing a consumed one
// revokes the session family.
//   read()  -> current refresh token, or null if the store is not yet
//              bootstrapped; THROWS (non-secret message) if the store is
//              configured but unreadable / malformed / insecurely permissioned.
//   write() -> atomically replace under a single-writer lock; THROWS on failure.
export interface TokenStore {
  read(): string | null;
  write(refreshToken: string): void;
}

export interface ResolveOpts {
  // Local diagnostic ONLY: permit a static access token with no store. Never
  // set for systemd worker/Hermes service commands.
  diagnostic?: boolean;
  // Explicit ONE-TIME bootstrap: only when set may an EMPTY store be seeded from
  // the env refresh token. Normal service runs leave this false, so a lost/empty
  // store fails closed instead of re-presenting an already-rotated (revoked) env
  // token.
  allowBootstrap?: boolean;
}

// Worker/Hermes token resolution. SERVICE mode requires a durable store:
//   - store empty (not bootstrapped) -> use the env bootstrap refresh token
//     ONCE, refresh, and persist the ROTATED token to the store;
//   - store populated -> use the store token (env is IGNORED after bootstrap,
//     so a consumed bootstrap token is never reused);
//   - store configured but read() throws (unreadable/malformed/insecure) ->
//     FAIL CLOSED (do not fall back to the env token);
//   - refresh response without a rotated token -> FAIL CLOSED (cannot persist
//     continuity; reconnect/reprovision required).
// DIAGNOSTIC mode allows a static access token only (no store, no refresh).
export async function resolveWorkerToken(
  env: Env,
  fetchImpl: FetchLike,
  store: TokenStore | null,
  opts: ResolveOpts = {},
): Promise<string> {
  if (opts.diagnostic) {
    const t = (env['SUPABASE_RUNTIME_TOKEN'] ?? '').trim();
    if (t !== '') return t;
    throw new Error('diagnostic mode requires SUPABASE_RUNTIME_TOKEN (fail-closed)');
  }
  if (!store) {
    throw new Error('SUPABASE_RUNTIME_TOKEN_STORE is required for service operation (fail-closed)');
  }
  const current = store.read(); // may throw -> fail closed (do NOT use env)
  let refreshToken: string;
  let cachedAccess: string | null = null;
  let cachedExpMs = 0;
  if (current !== null && current.trim() !== '') {
    const raw = current.trim(); // bootstrapped: store wins, env ignored
    if (raw.startsWith('{')) {
      // v2 JSON payload. A malformed payload FAILS CLOSED exactly like an
      // unreadable store (never silently degrades to the env token).
      let p: StorePayloadV2;
      try {
        p = JSON.parse(raw) as StorePayloadV2;
      } catch {
        throw new Error('token store payload malformed (fail-closed)');
      }
      if (p.v !== 2 || typeof p.refresh_token !== 'string' || !p.refresh_token.trim()) {
        throw new Error('token store payload invalid (fail-closed)');
      }
      refreshToken = p.refresh_token.trim();
      if (typeof p.access_token === 'string' && p.access_token.trim() &&
          Number.isFinite(p.access_expires_at_ms)) {
        cachedAccess = p.access_token.trim();
        cachedExpMs = Number(p.access_expires_at_ms);
      }
    } else {
      refreshToken = raw; // legacy bare refresh-token store
    }
  } else if (opts.allowBootstrap) {
    refreshToken = (env['SUPABASE_RUNTIME_REFRESH_TOKEN'] ?? '').trim();
    if (refreshToken === '') {
      throw new Error('bootstrap requested but no SUPABASE_RUNTIME_REFRESH_TOKEN set (fail-closed)');
    }
  } else {
    // Empty store on a normal run: never re-present a possibly-revoked env token.
    throw new Error('token store empty; run once with --bootstrap to seed, then remove the env token; reconnect/reprovision required (fail-closed)');
  }

  // Fast-track C2: reuse the persisted, still-valid access token WITHOUT a
  // network refresh (the dominant per-tick auth cost at a 60s cadence).
  // Expiration, rotation, and every fail-closed rule are unchanged: an
  // expired/near-expiry/absent cached token falls through to the exact
  // pre-existing refresh-and-rotate path, and validation is untouched (the
  // token is still presented to the API, which is the validator).
  if (cachedAccess && cachedExpMs - Date.now() > ACCESS_REUSE_MARGIN_MS) {
    return cachedAccess;
  }

  const r = await refreshRuntimeToken(env, fetchImpl, refreshToken);
  if (!r.refresh_token) {
    throw new Error('refresh response had no rotated token; reconnect required (fail-closed)');
  }
  const payload: StorePayloadV2 = {
    v: 2,
    refresh_token: r.refresh_token,
    ...(r.access_expires_at_ms
      ? { access_token: r.access_token, access_expires_at_ms: r.access_expires_at_ms }
      : {}),
  };
  store.write(JSON.stringify(payload)); // persist rotation (atomic; see fileTokenStore)
  return r.access_token;
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
  const json = (await res.json()) as {
    access_token?: string; refresh_token?: string;
    expires_in?: number; expires_at?: number;
  };
  const access = (json.access_token ?? '').trim();
  if (access === '') {
    throw new Error('supabase token refresh returned no access token (fail-closed)');
  }
  const rotated = (json.refresh_token ?? '').trim();
  // Prefer the server's absolute expiry (epoch seconds); fall back to
  // expires_in relative seconds; null when the response declares neither
  // (then no access-token caching happens - refresh-per-tick as before).
  const expMs = Number.isFinite(json.expires_at)
    ? Number(json.expires_at) * 1000
    : Number.isFinite(json.expires_in)
      ? Date.now() + Number(json.expires_in) * 1000
      : null;
  return {
    access_token: access,
    refresh_token: rotated !== '' ? rotated : null,
    access_expires_at_ms: expMs,
  };
}

export function createRuntimeClientWithToken(env: Env, token: string): RuntimeClient {
  const client = createClient(String(env['SUPABASE_URL']), String(env['SUPABASE_RUNTIME_KEY']), {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client as unknown as RuntimeClient;
}
