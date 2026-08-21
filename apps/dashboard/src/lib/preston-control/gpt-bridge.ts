// Preston Control - PKCE bridge for the Custom GPT Actions surface. PURE.
//
// Why it exists: ChatGPT GPT Actions performs a plain OAuth authorization-code
// flow (client id + secret, no PKCE), while the Supabase Auth OAuth 2.1 server
// documents code_challenge as REQUIRED on every /oauth/authorize request. The
// bridge sits between them, STATELESS, and adds PKCE:
//
//   ChatGPT ──authorize──► /oauth/gpt/authorize ──► Supabase /oauth/authorize
//                                                    (code_challenge = S256(verifier))
//           ◄─ code* ──── /oauth/gpt/callback  ◄──── redirect (code, state)
//   ChatGPT ──token(code*)─► /oauth/gpt/token ────► Supabase /oauth/token
//           ◄─ access/refresh token JSON ◄────────── (code, code_verifier, client creds)
//
// No server-side storage: verifier = HMAC(bridge key, nonce); the nonce rides
// in the state we hand Supabase and comes back in the callback, where it is
// folded into the composite code* = "<supabase_code>.<nonce>" given to ChatGPT.
// The token endpoint unfolds code* and re-derives the verifier. The bridge
// never mints or stores tokens; the access token that reaches ChatGPT is the
// OWNER's ordinary Supabase JWT (client_id = the GPT surface's client), which
// auth.ts validates exactly as for the MCP surface.
//
// Security properties:
//   - redirect_uri to ChatGPT must EQUAL the configured
//     PRESTON_CONTROL_GPT_CALLBACK_URL (the exact URL the GPT editor shows);
//     no host/id/path/query pattern matching, so the callback can never
//     become an open redirect and no other GPT can reuse the bridge;
//   - state is HMAC-signed; a tampered/forged callback is refused;
//   - client_id must equal the GPT surface's registered client; the presented
//     client secret is compared in constant time against the configured one
//     before anything is forwarded;
//   - id_token (if any) is stripped from the response; only access/refresh/
//     expires/token_type pass through; errors are tag-only.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GPT_BRIDGE_KEY_ENV = 'PRESTON_CONTROL_GPT_BRIDGE_KEY';
export const GPT_CLIENT_SECRET_ENV = 'PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET';
export const GPT_CLIENT_ID_ENV = 'PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID';
// Non-secret configuration: the exact OAuth callback URL the GPT editor
// displays for the Preston Control GPT (e.g. https://chat.openai.com/aip/g-<id>/oauth/callback).
export const GPT_CALLBACK_URL_ENV = 'PRESTON_CONTROL_GPT_CALLBACK_URL';

// The configured callback, normalised only by trimming whitespace. It must be
// an absolute https URL with no fragment; otherwise the bridge is unconfigured.
export function configuredCallback(env: Env): string | null {
  const raw = String(env[GPT_CALLBACK_URL_ENV] ?? '').trim();
  if (!raw || raw.length > 512) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.hash || u.username || u.password) return null;
  return raw;
}

// Exact string equality - no host, GPT-id, path or query variation.
export function callbackMatches(env: Env, presented: string | undefined): boolean {
  const cfg = configuredCallback(env);
  return cfg !== null && typeof presented === 'string' && safeEq(presented, cfg);
}
// Exactly base64url(32 random bytes) = 43 chars; anything else is tampering.
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^[A-Za-z0-9._~-]{8,512}$/;
const STATE_MAX = 1024;
export const ALLOWED_SCOPES = new Set(['email', 'openid', 'profile']);

type Env = Record<string, string | undefined>;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function hmac(key: string, data: string): string {
  return b64url(createHmac('sha256', key).update(data, 'utf8').digest());
}
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bridgeConfigured(env: Env): boolean {
  return Boolean(
    env[GPT_BRIDGE_KEY_ENV] && env[GPT_BRIDGE_KEY_ENV]!.length >= 32
    && env[GPT_CLIENT_ID_ENV] && env[GPT_CLIENT_SECRET_ENV] && env['NEXT_PUBLIC_SUPABASE_URL']
    && configuredCallback(env) !== null,
  );
}

export function supabaseAuthBase(env: Env): string {
  return String(env['NEXT_PUBLIC_SUPABASE_URL'] ?? '').replace(/\/+$/, '') + '/auth/v1';
}

export function newNonce(): string {
  return b64url(randomBytes(32));
}

// verifier: 43..128 chars of [A-Za-z0-9-._~]; base64url of 32 HMAC bytes = 43 chars.
export function deriveVerifier(env: Env, nonce: string): string {
  return hmac(String(env[GPT_BRIDGE_KEY_ENV]), 'verifier:' + nonce);
}
export function challengeFor(verifier: string): string {
  return b64url(createHash('sha256').update(verifier, 'ascii').digest());
}

// ---- state (bridge -> Supabase -> bridge) ----------------------------------
export interface BridgeState {
  nonce: string;
  chatgptRedirect: string;
  chatgptState: string;
}

export function packState(env: Env, s: BridgeState): string {
  const body = b64url(Buffer.from(JSON.stringify([s.nonce, s.chatgptRedirect, s.chatgptState]), 'utf8'));
  return body + '.' + hmac(String(env[GPT_BRIDGE_KEY_ENV]), 'state:' + body);
}

export function unpackState(env: Env, packed: string): BridgeState | null {
  if (typeof packed !== 'string' || packed.length > STATE_MAX * 2) return null;
  const i = packed.lastIndexOf('.');
  if (i <= 0) return null;
  const body = packed.slice(0, i);
  const sig = packed.slice(i + 1);
  if (!safeEq(sig, hmac(String(env[GPT_BRIDGE_KEY_ENV]), 'state:' + body))) return null;
  try {
    const arr = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(arr) || arr.length !== 3 || !arr.every((x) => typeof x === 'string')) return null;
    const [nonce, chatgptRedirect, chatgptState] = arr as string[];
    // The redirect inside the state must STILL equal the current configuration
    // (a state minted before a config change cannot redirect elsewhere).
    if (!NONCE_RE.test(nonce) || !callbackMatches(env, chatgptRedirect) || chatgptState.length > STATE_MAX) return null;
    return { nonce, chatgptRedirect, chatgptState };
  } catch {
    return null;
  }
}

// ---- /oauth/gpt/authorize ----------------------------------------------------
export type AuthorizeOutcome =
  | { ok: true; location: string }
  | { ok: false; error: 'unconfigured' | 'invalid_request' | 'unauthorized_client' | 'invalid_scope' | 'invalid_redirect' };

export function buildAuthorizeRedirect(
  env: Env,
  q: Record<string, string | undefined>,
  origin: string,
  nonce: string = newNonce(),
): AuthorizeOutcome {
  if (!bridgeConfigured(env)) return { ok: false, error: 'unconfigured' };
  if ((q.response_type ?? 'code') !== 'code') return { ok: false, error: 'invalid_request' };
  if ((q.client_id ?? '') !== env[GPT_CLIENT_ID_ENV]) return { ok: false, error: 'unauthorized_client' };
  const redirect = q.redirect_uri ?? '';
  if (!callbackMatches(env, redirect)) return { ok: false, error: 'invalid_redirect' };
  const state = q.state ?? '';
  if (!state || state.length > STATE_MAX) return { ok: false, error: 'invalid_request' };
  const scopes = (q.scope ?? 'email').split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((s) => !ALLOWED_SCOPES.has(s))) return { ok: false, error: 'invalid_scope' };

  const verifier = deriveVerifier(env, nonce);
  const url = new URL(supabaseAuthBase(env) + '/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', String(env[GPT_CLIENT_ID_ENV]));
  url.searchParams.set('redirect_uri', origin.replace(/\/+$/, '') + '/oauth/gpt/callback');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('code_challenge', challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', packState(env, { nonce, chatgptRedirect: redirect, chatgptState: state }));
  return { ok: true, location: url.toString() };
}

// ---- /oauth/gpt/callback -----------------------------------------------------
export type CallbackOutcome =
  | { ok: true; location: string }
  | { ok: false; error: 'unconfigured' | 'invalid_state' | 'invalid_code' | 'upstream_error'; location?: string };

export function buildCallbackRedirect(env: Env, q: Record<string, string | undefined>): CallbackOutcome {
  if (!bridgeConfigured(env)) return { ok: false, error: 'unconfigured' };
  const st = unpackState(env, q.state ?? '');
  if (!st) return { ok: false, error: 'invalid_state' };
  const back = new URL(st.chatgptRedirect);
  back.searchParams.set('state', st.chatgptState);
  if (q.error) {
    // Propagate a denial/upstream error to ChatGPT (no code is issued).
    back.searchParams.set('error', /^[a-z_]{1,40}$/.test(q.error) ? q.error : 'server_error');
    return { ok: false, error: 'upstream_error', location: back.toString() };
  }
  const code = q.code ?? '';
  if (!CODE_RE.test(code)) return { ok: false, error: 'invalid_code' };
  back.searchParams.set('code', code + '.' + st.nonce);
  return { ok: true, location: back.toString() };
}

// ---- /oauth/gpt/token --------------------------------------------------------
export interface TokenForward {
  url: string;
  body: URLSearchParams;
}
export type TokenOutcome =
  | { ok: true; forward: TokenForward }
  | { ok: false; error: 'unconfigured' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type'; status: 400 | 401 | 503 };

// Accepts client credentials either in the POST body (client_secret_post,
// what the ChatGPT docs show) or as HTTP Basic; both are verified here in
// constant time and re-sent to Supabase as client_secret_post.
export function buildTokenForward(
  env: Env,
  form: Record<string, string | undefined>,
  basicAuthHeader: string | null,
  origin: string,
): TokenOutcome {
  if (!bridgeConfigured(env)) return { ok: false, error: 'unconfigured', status: 503 };
  let cid = form.client_id ?? '';
  let secret = form.client_secret ?? '';
  if (basicAuthHeader?.startsWith('Basic ')) {
    try {
      const [u, p] = Buffer.from(basicAuthHeader.slice(6), 'base64').toString('utf8').split(':');
      cid = decodeURIComponent(u ?? '');
      secret = decodeURIComponent(p ?? '');
    } catch {
      return { ok: false, error: 'invalid_client', status: 401 };
    }
  }
  if (!safeEq(cid, String(env[GPT_CLIENT_ID_ENV])) || !secret || !safeEq(secret, String(env[GPT_CLIENT_SECRET_ENV]))) {
    return { ok: false, error: 'invalid_client', status: 401 };
  }
  const body = new URLSearchParams();
  body.set('client_id', cid);
  body.set('client_secret', secret);
  const grant = form.grant_type ?? '';
  if (grant === 'authorization_code') {
    const composite = form.code ?? '';
    const i = composite.lastIndexOf('.');
    if (i <= 0) return { ok: false, error: 'invalid_grant', status: 400 };
    const code = composite.slice(0, i);
    const nonce = composite.slice(i + 1);
    if (!CODE_RE.test(code) || !NONCE_RE.test(nonce)) return { ok: false, error: 'invalid_grant', status: 400 };
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('code_verifier', deriveVerifier(env, nonce));
    body.set('redirect_uri', origin.replace(/\/+$/, '') + '/oauth/gpt/callback');
  } else if (grant === 'refresh_token') {
    const rt = form.refresh_token ?? '';
    if (!rt || rt.length > 2048) return { ok: false, error: 'invalid_grant', status: 400 };
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', rt);
  } else {
    return { ok: false, error: 'unsupported_grant_type', status: 400 };
  }
  return { ok: true, forward: { url: supabaseAuthBase(env) + '/oauth/token', body } };
}

// Upstream (Supabase Auth) error bodies come in two shapes: OAuth
// `{error}` and GoTrue `{error_code, msg}`. Reduce either to a sanitized tag;
// never forward `msg`/`error_description` or any other body content.
export function upstreamErrorTag(upstream: unknown): string {
  if (upstream && typeof upstream === 'object') {
    const u = upstream as Record<string, unknown>;
    const raw = typeof u.error === 'string' ? u.error
      : typeof u.error_code === 'string' ? u.error_code : '';
    if (/^[a-z_]{1,40}$/.test(raw)) return raw;
  }
  return 'invalid_grant';
}

// Owner-facing diagnostic (see app/oauth/gpt/diag): does the configured client
// id/secret pair authenticate at the Supabase token endpoint? Sends a bogus
// refresh token on purpose; the answer distinguishes "credentials refused"
// (invalid_credentials) from "credentials accepted, grant refused"
// (invalid_grant / other). No secret leaves the server.
export function buildCredentialProbe(env: Env): TokenForward | null {
  if (!bridgeConfigured(env)) return null;
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', 'preston-control-credential-probe');
  body.set('client_id', String(env[GPT_CLIENT_ID_ENV]));
  body.set('client_secret', String(env[GPT_CLIENT_SECRET_ENV]));
  return { url: supabaseAuthBase(env) + '/oauth/token', body };
}

export function classifyCredentialProbe(status: number, upstream: unknown): 'valid' | 'invalid' | 'unknown' {
  const tag = upstreamErrorTag(upstream);
  if (status === 200) return 'valid';
  if (tag === 'invalid_credentials' || tag === 'invalid_client') return 'invalid';
  if (status === 400 || status === 401) return 'valid'; // credentials passed; bogus grant refused
  return 'unknown';
}

// Only the fields ChatGPT needs pass through; nothing else (id_token, user
// objects, provider tokens) is forwarded into ChatGPT's token store.
export function filterTokenResponse(upstream: unknown): Record<string, unknown> | null {
  if (!upstream || typeof upstream !== 'object') return null;
  const u = upstream as Record<string, unknown>;
  if (typeof u.access_token !== 'string') return null;
  const out: Record<string, unknown> = {
    access_token: u.access_token,
    token_type: typeof u.token_type === 'string' ? u.token_type : 'bearer',
  };
  if (typeof u.refresh_token === 'string') out.refresh_token = u.refresh_token;
  if (typeof u.expires_in === 'number') out.expires_in = u.expires_in;
  if (typeof u.scope === 'string') out.scope = u.scope;
  return out;
}
