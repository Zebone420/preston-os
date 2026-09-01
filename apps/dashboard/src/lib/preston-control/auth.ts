// Preston Control - bearer authentication for the ChatGPT MCP adapter.
// FAIL-CLOSED. PURE apart from the injected token verifier.
//
// Identity model (no new identity is introduced):
//   ChatGPT -> OAuth 2.1 (Supabase Auth OAuth Server, auth-code + PKCE)
//           -> ordinary Supabase access JWT for the OWNER's auth user
//           -> this module -> RLS-bound client acting AS THE OWNER.
// Every tool therefore runs under auth.uid() = owner, so the existing DB
// authorities (is_owner(), decide_orchestration_approval, RLS) decide, and
// the runtime service identity can never be elevated through this surface.
//
// Gates, in order (each one fails closed):
//   1. PRESTON_CONTROL_ENABLED must be exactly 'true'.
//   2. SUPABASE_RUNTIME_ENV must be on the remote-surface allowlist.
//   3. The SURFACE's OAuth client id must be configured (non-secret id):
//      PRESTON_CONTROL_OAUTH_CLIENT_ID (MCP) / PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID
//      (Custom GPT Actions).
//   4. A Bearer token must be present and bounded in length.
//   5. The token must verify against Supabase Auth (signature, expiry).
//   6. The token's claims must carry client_id == THIS surface's client id
//      (a dashboard cookie-session JWT, a runtime-service JWT, or a token
//      minted for the OTHER surface's client is refused).
//   7. The authenticated email must be on OWNER_EMAIL_ALLOWLIST (app layer).
//   8. public.is_owner() must return true for the token (DB layer, the
//      authority RLS and the decide RPC trust).
// No secret is read, logged, or returned. The token value is never echoed.

import { isOwnerEmail } from '@/lib/owner-auth';
import { remoteSurfaceEnvAllowed } from '@/lib/ai-os/remote-surface-env';

export const PRESTON_CONTROL_ENABLED_ENV = 'PRESTON_CONTROL_ENABLED';
export const PRESTON_CONTROL_CLIENT_ID_ENV = 'PRESTON_CONTROL_OAUTH_CLIENT_ID';
export const PRESTON_CONTROL_GPT_CLIENT_ID_ENV = 'PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID';
export const PRESTON_CONTROL_HERMES_CLIENT_ID_ENV =
  'PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID';
export const MAX_BEARER_LENGTH = 8192;

// Three transport adapters share ONE service layer but hold SEPARATE OAuth
// clients so each surface can be revoked independently:
//   'mcp'    - ChatGPT developer-mode MCP plugin (web/desktop) -> /mcp
//   'gpt'    - private Custom GPT Actions facade               -> /api/control/*
//   'hermes' - Hermes dashboard Preston Supervisor backend     -> the seven
//              READ routes ONLY (http.ts READ_SURFACES); the write /
//              consequential routes never accept it, so even a compromised
//              dashboard host cannot submit, follow up, decide, or cancel.
// A token minted for one surface's client is refused by the others.
export type ControlSurface = 'mcp' | 'gpt' | 'hermes';

const SURFACE_CLIENT_ID_ENVS: Record<ControlSurface, string> = {
  mcp: PRESTON_CONTROL_CLIENT_ID_ENV,
  gpt: PRESTON_CONTROL_GPT_CLIENT_ID_ENV,
  hermes: PRESTON_CONTROL_HERMES_CLIENT_ID_ENV,
};

export function surfaceClientIdEnv(surface: ControlSurface): string {
  return SURFACE_CLIENT_ID_ENVS[surface];
}

// Every registered Preston Control client id (all surfaces), for the
// consent page, which may approve a grant for one of them and nothing else.
export function registeredClientIds(env: Env): string[] {
  return [
    PRESTON_CONTROL_CLIENT_ID_ENV,
    PRESTON_CONTROL_GPT_CLIENT_ID_ENV,
    PRESTON_CONTROL_HERMES_CLIENT_ID_ENV,
  ]
    .map((k) => String(env[k] ?? '').trim())
    .filter((v) => v.length > 0);
}

export type Env = Record<string, string | undefined>;

export interface VerifiedUser {
  id: string;
  email: string | null;
}

// The minimal client surface the adapter needs: token verification, the
// owner-authority RPC, and the RLS-bound query surface handed to the tools.
export interface ControlClient {
  auth: { getUser(token: string): Promise<{ data: { user: VerifiedUser | null }; error: { message: string } | null }> };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface AuthDeps {
  // Builds a client whose requests carry the presented bearer (RLS-bound).
  clientFor(token: string): ControlClient | null;
}

export type AuthFailure =
  | 'disabled'
  | 'unconfigured'
  | 'missing_token'
  | 'invalid_token'
  | 'wrong_client'
  | 'not_owner';

export type AuthResult =
  | {
      ok: true;
      client: ControlClient;
      ownerEmail: string;
      userId: string;
      // Which surface's client the verified token was minted for. Routes
      // that accept several surfaces get the exact match back; no token
      // is ever accepted without matching exactly one configured surface.
      surface: ControlSurface;
    }
  | { ok: false; reason: AuthFailure; httpStatus: 401 | 403 | 503 };

// Decode a JWT payload WITHOUT trusting it. Only consulted AFTER the token has
// been verified by Supabase Auth (step 5); used to read client_id / aud.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(pad, 'base64').toString('utf8');
    const obj = JSON.parse(json) as unknown;
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function bearerFrom(authorizationHeader: string | null): string {
  const h = authorizationHeader ?? '';
  return h.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : '';
}

export function controlSurfaceEnabled(env: Env, surface: ControlSurface = 'mcp'): boolean {
  return env[PRESTON_CONTROL_ENABLED_ENV] === 'true'
    && remoteSurfaceEnvAllowed(env['SUPABASE_RUNTIME_ENV'])
    && Boolean(env[surfaceClientIdEnv(surface)]);
}

export async function authenticateControlRequest(
  authorizationHeader: string | null,
  env: Env,
  deps: AuthDeps,
  surface: ControlSurface | readonly ControlSurface[] = 'mcp',
): Promise<AuthResult> {
  if (env[PRESTON_CONTROL_ENABLED_ENV] !== 'true') {
    return { ok: false, reason: 'disabled', httpStatus: 503 };
  }
  // A route may accept several surfaces (the read routes take gpt AND
  // hermes). Each candidate surface still requires its OWN env-configured
  // client id - an unconfigured surface is simply not a candidate (fail
  // closed, never a fallback to another surface's client), and with no
  // configured candidate at all the route is unconfigured.
  const surfaces: readonly ControlSurface[] = Array.isArray(surface)
    ? surface
    : [surface as ControlSurface];
  const candidates = surfaces
    .map((s) => ({
      surface: s,
      clientId: String(env[surfaceClientIdEnv(s)] ?? '').trim(),
    }))
    .filter((c) => c.clientId.length > 0);
  if (!remoteSurfaceEnvAllowed(env['SUPABASE_RUNTIME_ENV']) || candidates.length === 0) {
    return { ok: false, reason: 'unconfigured', httpStatus: 503 };
  }

  const token = bearerFrom(authorizationHeader);
  if (!token || token.length > MAX_BEARER_LENGTH) {
    return { ok: false, reason: 'missing_token', httpStatus: 401 };
  }

  const client = deps.clientFor(token);
  if (!client) return { ok: false, reason: 'unconfigured', httpStatus: 503 };

  // 5. Authoritative verification by Supabase Auth (signature + expiry).
  let user: VerifiedUser | null = null;
  try {
    const res = await client.auth.getUser(token);
    if (res.error || !res.data.user) {
      return { ok: false, reason: 'invalid_token', httpStatus: 401 };
    }
    user = res.data.user;
  } catch {
    return { ok: false, reason: 'invalid_token', httpStatus: 401 };
  }

  // 6. Token provenance: must have been minted for one of THIS route's
  //    configured surface clients (exact id match; no wildcard, no
  //    cross-surface acceptance). Claims are read only after verification.
  const claims = decodeJwtPayload(token);
  const clientId = claims ? String(claims['client_id'] ?? '') : '';
  const aud = claims ? claims['aud'] : undefined;
  const audOk = aud === 'authenticated'
    || (Array.isArray(aud) && aud.includes('authenticated'));
  const matched = candidates.find((c) => c.clientId === clientId);
  if (!claims || !audOk || !clientId || !matched) {
    return { ok: false, reason: 'wrong_client', httpStatus: 403 };
  }

  // 7. App-layer owner allowlist (defense in depth; empty list = nobody).
  if (!isOwnerEmail(user.email, env)) {
    return { ok: false, reason: 'not_owner', httpStatus: 403 };
  }

  // 8. DB-layer owner authority: the only thing RLS / decide RPC trust.
  try {
    const res = await client.rpc('is_owner');
    if (res.error || res.data !== true) {
      return { ok: false, reason: 'not_owner', httpStatus: 403 };
    }
  } catch {
    return { ok: false, reason: 'not_owner', httpStatus: 403 };
  }

  return {
    ok: true,
    client,
    ownerEmail: String(user.email),
    userId: user.id,
    surface: matched.surface,
  };
}
