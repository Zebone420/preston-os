import { describe, expect, it } from 'vitest';
import {
  canonicalGithubChange,
  diffHash,
  githubChangeDigest,
  isStale,
  validateGithubChangeEnvelope,
  type GithubChangeEnvelope,
} from '../src/lib/ai-os/architect/change-binding';

const PATCH = 'diff --git a/a.ts b/a.ts\n+safe change\n';
const BASE: GithubChangeEnvelope = {
  repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
  head_branch: 'architect/corr-architect-0004',
  base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), diff_hash: diffHash(PATCH),
};

describe('AG-4 exact commit and diff binding', () => {
  it('is deterministic and canonical regardless of object insertion order', () => {
    expect(githubChangeDigest(BASE)).toBe(githubChangeDigest({ ...BASE }));
    expect(githubChangeDigest(BASE)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(canonicalGithubChange(BASE))).toEqual({
      base_branch: BASE.base_branch, base_sha: BASE.base_sha,
      diff_hash: BASE.diff_hash, head_branch: BASE.head_branch,
      head_sha: BASE.head_sha, repo: BASE.repo,
    });
  });

  it('changes the digest when any single bound field changes', () => {
    for (const [key, value] of Object.entries({
      repo: 'Other/repo', base_branch: 'master',
      head_branch: 'architect/corr-other-0004', base_sha: '3'.repeat(40),
      head_sha: '4'.repeat(40), diff_hash: '5'.repeat(64),
    })) {
      const changed = { ...BASE, [key]: value } as GithubChangeEnvelope;
      expect(githubChangeDigest(changed), key).not.toBe(githubChangeDigest(BASE));
    }
  });

  it('hashes exact patch bytes and detects post-approval edits', () => {
    expect(diffHash(PATCH)).toBe(BASE.diff_hash);
    const edited = diffHash(PATCH + '+different\n');
    expect(edited).not.toBe(BASE.diff_hash);
    expect(isStale(BASE, BASE.base_sha, edited))
      .toEqual({ stale: true, reasons: ['diff_changed'] });
  });

  it('detects a moved base and accepts an unchanged current state', () => {
    expect(isStale(BASE, '9'.repeat(40), BASE.diff_hash))
      .toEqual({ stale: true, reasons: ['base_sha_moved'] });
    expect(isStale(BASE, BASE.base_sha, BASE.diff_hash))
      .toEqual({ stale: false, reasons: [] });
  });

  it('fails closed on arbitrary or malformed envelopes', () => {
    expect(validateGithubChangeEnvelope(null)).toMatchObject({ ok: false });
    const bad = validateGithubChangeEnvelope({ ...BASE, head_sha: 'short' });
    expect(bad).toEqual({ ok: false, errors: ['head_sha_invalid'] });
    expect(validateGithubChangeEnvelope(BASE)).toEqual({ ok: true, envelope: BASE });
  });
});
