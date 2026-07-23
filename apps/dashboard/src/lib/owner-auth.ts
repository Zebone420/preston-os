// Owner-only auth gate decision logic - Phase 1B owner-login gate.
// Pure and env-injectable so the proxy stays a thin adapter and every
// fail-closed rule is unit-testable (test/owner-auth.test.ts).
//
// Fail-closed on all axes:
// - Supabase auth env missing      -> 'setup': only /login renders (it
//   shows a safe setup notice and never any data, mock or otherwise)
// - unauthenticated visitor        -> 'login' (redirect to /login)
// - OWNER_EMAIL_ALLOWLIST missing,
//   empty, or email not on it      -> 'deny' (nobody is owner by default)
//
// This module reads no secrets: it checks only the PRESENCE of the
// Supabase URL/anon key and compares email strings. It never logs or
// returns env values.

type Env = Record<string, string | undefined>;

export type OwnerGateAction =
  | 'allow' // render the requested page
  | 'login' // unauthenticated -> redirect to /login
  | 'home' // signed-in owner on /login -> redirect to /
  | 'setup' // auth env not configured -> safe setup surface only
  | 'deny'; // authenticated but not an allowlisted owner

export interface OwnerGateInput {
  path: string;
  // Email of the authenticated Supabase user; null OR undefined when
  // unauthenticated. Both are treated identically (fail-closed to 'login'),
  // matching isOwnerEmail - callers with an optional-chained user need not
  // normalize, and the sign-out regression suite pins the undefined shape.
  userEmail: string | null | undefined;
  env: Env;
}

// True only when both Supabase auth values are present. Presence check
// only; values are never inspected or returned.
export function isAuthConfigured(env: Env): boolean {
  return Boolean(
    env['NEXT_PUBLIC_SUPABASE_URL'] && env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

// Comma-separated owner emails, trimmed and lowercased. Missing or
// empty variable yields an empty list (fail-closed: nobody is owner).
export function ownerAllowlist(env: Env): string[] {
  const raw = env['OWNER_EMAIL_ALLOWLIST'] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function isOwnerEmail(
  email: string | null | undefined,
  env: Env,
): boolean {
  if (!email) return false;
  const list = ownerAllowlist(env);
  if (list.length === 0) return false; // fail closed: no allowlist, no owner
  return list.includes(email.trim().toLowerCase());
}

// Single decision point used by src/proxy.ts for every matched request.
export function evaluateOwnerGate(input: OwnerGateInput): OwnerGateAction {
  const { path, userEmail, env } = input;
  const onLogin = path === '/login';

  if (!isAuthConfigured(env)) {
    // SETUP MODE, fail closed: only the login surface renders. It shows
    // a safe setup notice; no dashboard page (even mock) is reachable.
    return onLogin ? 'allow' : 'setup';
  }
  if (!userEmail) {
    return onLogin ? 'allow' : 'login';
  }
  if (!isOwnerEmail(userEmail, env)) {
    // Authenticated but not the owner: blocked everywhere; the login
    // page itself stays reachable so the owner can re-authenticate.
    return onLogin ? 'allow' : 'deny';
  }
  return onLogin ? 'home' : 'allow';
}
