// Preston Control - OAuth consent decision logic. PURE and unit-testable.
// The Supabase Auth OAuth 2.1 server redirects the browser to OUR consent
// page with ?authorization_id=...; this module decides whether the page may
// proceed. Fail-closed on every axis:
//   - the authorization id must be a bounded, plain token
//   - the requesting OAuth client must be one of the registered Preston
//     Control clients (MCP or GPT Actions surface); any other client is denied,
//     so even a mistakenly enabled dynamic-registration client cannot obtain
//     an owner grant through this page
//   - the requested scope must be a subset of the small allowlist
//   - the consenting user must be an allowlisted owner (checked by the page
//     through resolveOwner(); this module re-checks the email it is handed)

import { isOwnerEmail } from '@/lib/owner-auth';
import { registeredClientIds } from './auth';

export const ALLOWED_SCOPES = new Set(['email', 'openid', 'profile', 'offline_access']);
export const AUTHORIZATION_ID_RE = /^[A-Za-z0-9._:-]{8,256}$/;

export interface ConsentDetails {
  authorization_id: string;
  client: { id: string; name: string };
  scope: string;
  user: { id: string; email: string };
}

export type ConsentGate =
  | { ok: true; scopes: string[] }
  | { ok: false; reason: 'authorization_id_invalid' | 'client_not_allowed' | 'scope_not_allowed' | 'user_not_owner' | 'user_mismatch' | 'unconfigured' };

export function validAuthorizationId(v: unknown): v is string {
  return typeof v === 'string' && AUTHORIZATION_ID_RE.test(v);
}

export function evaluateConsent(
  details: ConsentDetails,
  sessionEmail: string,
  env: Record<string, string | undefined>,
): ConsentGate {
  const registered = registeredClientIds(env);
  if (registered.length === 0) return { ok: false, reason: 'unconfigured' };
  if (!validAuthorizationId(details.authorization_id)) return { ok: false, reason: 'authorization_id_invalid' };
  if (!registered.includes(String(details.client?.id ?? ''))) return { ok: false, reason: 'client_not_allowed' };
  const scopes = String(details.scope ?? '').split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (scopes.some((s) => !ALLOWED_SCOPES.has(s))) return { ok: false, reason: 'scope_not_allowed' };
  if (!isOwnerEmail(sessionEmail, env)) return { ok: false, reason: 'user_not_owner' };
  // The authorization must belong to the signed-in owner, not another user.
  if (String(details.user?.email ?? '').trim().toLowerCase() !== sessionEmail.trim().toLowerCase()) {
    return { ok: false, reason: 'user_mismatch' };
  }
  return { ok: true, scopes: scopes.length ? scopes : ['email'] };
}

// Only a same-origin consent path may be used as a post-login continuation.
export function safeConsentNext(next: unknown): string | null {
  if (typeof next !== 'string') return null;
  if (!next.startsWith('/oauth/consent?')) return null;
  if (next.length > 512 || /[\r\n\\]/.test(next) || next.startsWith('//')) return null;
  return next;
}
