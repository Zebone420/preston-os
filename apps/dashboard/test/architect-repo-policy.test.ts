import { describe, expect, it } from 'vitest';
import {
  canonicalizeRepo,
  evaluateArchitectRequestRepo,
  evaluateRepoAllowlist,
} from '../src/lib/ai-os/architect/repo-policy';
import type { ArchitectRequest } from '../src/lib/ai-os/architect/intake';

const ALLOWLIST = 'Zebone420/preston-os';

describe('canonicalizeRepo', () => {
  it('accepts owner/repo shorthand', () => {
    const r = canonicalizeRepo('Zebone420/preston-os');
    expect(r).toEqual({ ok: true, repo: { owner: 'Zebone420', name: 'preston-os', canonical: 'zebone420/preston-os' } });
  });

  it('accepts an https URL with an embedded username and .git suffix, deterministically', () => {
    const r = canonicalizeRepo('https://Zebone420@github.com/Zebone420/preston-os.git');
    expect(r).toEqual({ ok: true, repo: { owner: 'Zebone420', name: 'preston-os', canonical: 'zebone420/preston-os' } });
  });

  it('accepts an ssh URL', () => {
    const r = canonicalizeRepo('git@github.com:Zebone420/preston-os.git');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repo.canonical).toBe('zebone420/preston-os');
  });

  it('normalizes case deterministically to the same canonical key', () => {
    const lower = canonicalizeRepo('zebone420/PRESTON-OS');
    const upper = canonicalizeRepo('ZEBONE420/preston-os');
    expect(lower.ok && upper.ok).toBe(true);
    if (lower.ok && upper.ok) expect(lower.repo.canonical).toBe(upper.repo.canonical);
  });

  it('rejects empty input', () => {
    expect(canonicalizeRepo('')).toEqual({ ok: false, reason: 'repository_identity_invalid' });
    expect(canonicalizeRepo('   ')).toEqual({ ok: false, reason: 'repository_identity_invalid' });
  });

  it('rejects a malformed value', () => {
    expect(canonicalizeRepo('not a repo at all!! ??')).toEqual({ ok: false, reason: 'repository_identity_ambiguous' });
    expect(canonicalizeRepo('owner-only')).toEqual({ ok: false, reason: 'repository_identity_invalid' });
    expect(canonicalizeRepo('https://gitlab.com/owner/repo')).toEqual({ ok: false, reason: 'repository_identity_invalid' });
    expect(canonicalizeRepo('owner/..')).toEqual({ ok: false, reason: 'repository_identity_invalid' });
  });

  it('rejects ambiguous multi-token input rather than guessing', () => {
    expect(canonicalizeRepo('owner/repo other/repo')).toEqual({ ok: false, reason: 'repository_identity_ambiguous' });
    expect(canonicalizeRepo('use the preston repo')).toEqual({ ok: false, reason: 'repository_identity_ambiguous' });
  });

  it('rejects a non-string input without throwing', () => {
    expect(canonicalizeRepo(undefined)).toEqual({ ok: false, reason: 'repository_identity_invalid' });
    expect(canonicalizeRepo(null)).toEqual({ ok: false, reason: 'repository_identity_invalid' });
  });
});

describe('evaluateRepoAllowlist', () => {
  it('allows an explicitly listed repo', () => {
    const d = evaluateRepoAllowlist('Zebone420/preston-os', ALLOWLIST);
    expect(d).toEqual({ allowed: true, reason: 'repository_allowed', canonical: 'zebone420/preston-os' });
  });

  it('denies a different owner with the same repo name', () => {
    const d = evaluateRepoAllowlist('someoneelse/preston-os', ALLOWLIST);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('repository_not_allowed');
  });

  it('denies the same owner with a different repo name', () => {
    const d = evaluateRepoAllowlist('Zebone420/other-repo', ALLOWLIST);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('repository_not_allowed');
  });

  it('denies everything when the allowlist is empty or unset', () => {
    expect(evaluateRepoAllowlist('Zebone420/preston-os', '')).toEqual(
      { allowed: false, reason: 'repository_allowlist_empty', canonical: 'zebone420/preston-os' },
    );
    expect(evaluateRepoAllowlist('Zebone420/preston-os', undefined)).toEqual(
      { allowed: false, reason: 'repository_allowlist_empty', canonical: 'zebone420/preston-os' },
    );
  });

  it('denies a malformed repo even with a non-empty allowlist', () => {
    const d = evaluateRepoAllowlist('not valid!!', ALLOWLIST);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('repository_identity_ambiguous');
    expect(d.canonical).toBeNull();
  });

  it('supports more than one allowlisted repo, exact match only', () => {
    const list = 'owner-a/repo-a, Zebone420/preston-os , owner-b/repo-b';
    expect(evaluateRepoAllowlist('Zebone420/preston-os', list).allowed).toBe(true);
    expect(evaluateRepoAllowlist('owner-a/repo-a', list).allowed).toBe(true);
    expect(evaluateRepoAllowlist('owner-c/repo-c', list).allowed).toBe(false);
  });

  it('does not support wildcards - a literal "*" entry never matches a real repo', () => {
    const d = evaluateRepoAllowlist('Zebone420/preston-os', '*');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('repository_not_allowed');
  });

  it('never falls back to a default repo when the request omits one', () => {
    expect(evaluateRepoAllowlist(undefined, ALLOWLIST)).toEqual(
      { allowed: false, reason: 'repository_identity_invalid', canonical: null },
    );
  });
});

describe('evaluateArchitectRequestRepo', () => {
  function request(repo: string): ArchitectRequest {
    return {
      repo,
      base_branch: 'feature/hermes-native',
      objective: 'test',
      correlation_id: 'corr-architect-0002',
      requested_by: 'owner',
      source_goal_job_id: 'goal-job-0002',
      environment: 'staging',
    };
  }

  it('reads the repo from the ArchitectRequest and the allowlist from the injected env', () => {
    const d = evaluateArchitectRequestRepo(request('Zebone420/preston-os'), {
      ARCHITECT_REPO_ALLOWLIST: ALLOWLIST,
    });
    expect(d.allowed).toBe(true);
  });

  it('denies when ARCHITECT_REPO_ALLOWLIST is absent from the injected env', () => {
    const d = evaluateArchitectRequestRepo(request('Zebone420/preston-os'), {});
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('repository_allowlist_empty');
  });
});
