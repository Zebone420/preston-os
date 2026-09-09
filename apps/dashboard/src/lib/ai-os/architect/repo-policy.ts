// Preston AI OS - Architect Gate AG-2: repository identity + allowlist.
// PURE. GitHub is not an authority source (see the Architect/GitHub Gate
// contract, ADR-2): a repository is addressable ONLY if the owner has put
// it, verbatim, on ARCHITECT_REPO_ALLOWLIST. An empty/unset allowlist
// denies every repository - there is no default, no CWD fallback, no
// environment-derived guess, and no wildcard. GitHub owner/repo routing is
// case-insensitive, so canonicalization lowercases owner+name before
// comparison; this only NARROWS what a single allowlist entry can match,
// it never widens acceptance.

import type { ArchitectRequest } from './intake';

export type RepoIdentityReason =
  | 'repository_allowed'
  | 'repository_not_allowed'
  | 'repository_identity_invalid'
  | 'repository_identity_ambiguous'
  | 'repository_allowlist_empty';

export interface CanonicalRepo {
  owner: string; // as-cased in the input
  name: string; // as-cased in the input
  canonical: string; // `${lowerOwner}/${lowerName}` - comparison key only
}

export type CanonicalizeResult =
  | { ok: true; repo: CanonicalRepo }
  | {
      ok: false;
      reason: 'repository_identity_invalid' | 'repository_identity_ambiguous';
    };

export interface RepoAllowlistDecision {
  allowed: boolean;
  reason: RepoIdentityReason;
  canonical: string | null; // null when identity could not even be established
}

// GitHub login rules, intentionally conservative (not an exhaustive
// validator): 1-39 chars, alphanumeric, hyphen allowed only in the
// middle, must start and end alphanumeric.
const OWNER_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// GitHub repo name rules, conservative: 1-100 chars of the allowed set.
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

// Exactly three accepted input shapes - nothing else is parsed, so nothing
// is ever guessed:
//   owner/repo
//   https://[user@]github.com/owner/repo[.git][/]
//   git@github.com:owner/repo[.git]
const SHORTHAND_RE = /^([^\s/]+)\/([^\s/]+)$/;
const HTTPS_RE = /^https:\/\/(?:[^@/\s]+@)?github\.com\/([^\s/]+)\/([^\s/]+?)(?:\.git)?\/?$/i;
const SSH_RE = /^git@github\.com:([^\s/]+)\/([^\s/]+?)(?:\.git)?$/i;

function validPart(re: RegExp, s: string): boolean {
  return re.test(s) && s !== '.' && s !== '..';
}

export function canonicalizeRepo(raw: unknown): CanonicalizeResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'repository_identity_invalid' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'repository_identity_invalid' };
  // Whitespace inside the value means more than one candidate identity is
  // present (e.g. free text, or two repos). Never pick one - refuse.
  if (/\s/.test(trimmed)) return { ok: false, reason: 'repository_identity_ambiguous' };

  const match = HTTPS_RE.exec(trimmed) ?? SSH_RE.exec(trimmed) ?? SHORTHAND_RE.exec(trimmed);
  if (!match) return { ok: false, reason: 'repository_identity_invalid' };

  const [, owner, name] = match;
  if (!validPart(OWNER_RE, owner) || !validPart(REPO_RE, name)) {
    return { ok: false, reason: 'repository_identity_invalid' };
  }

  return {
    ok: true,
    repo: { owner, name, canonical: `${owner.toLowerCase()}/${name.toLowerCase()}` },
  };
}

function parseAllowlist(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

// Pure evaluation: the caller supplies both the requested repo and the
// allowlist value - no environment reads happen here.
export function evaluateRepoAllowlist(
  rawRepo: unknown,
  allowlistEnvValue: string | undefined,
): RepoAllowlistDecision {
  const canon = canonicalizeRepo(rawRepo);
  if (!canon.ok) return { allowed: false, reason: canon.reason, canonical: null };

  const allowlist = parseAllowlist(allowlistEnvValue);
  if (allowlist.length === 0) {
    return { allowed: false, reason: 'repository_allowlist_empty', canonical: canon.repo.canonical };
  }

  const allowed = allowlist.includes(canon.repo.canonical);
  return {
    allowed,
    reason: allowed ? 'repository_allowed' : 'repository_not_allowed',
    canonical: canon.repo.canonical,
  };
}

// Convenience wrapper binding AG-2 to the AG-1 ArchitectRequest. The env
// map defaults to process.env but is caller-injectable for tests, same
// pattern as deploymentEnvironment().
export function evaluateArchitectRequestRepo(
  request: ArchitectRequest,
  env: Record<string, string | undefined> = process.env,
): RepoAllowlistDecision {
  return evaluateRepoAllowlist(request.repo, env['ARCHITECT_REPO_ALLOWLIST']);
}
