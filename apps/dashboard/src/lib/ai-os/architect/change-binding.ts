// Architect Gate AG-4: exact GitHub commit/diff binding. PURE except for the
// trusted node:crypto primitive. It consumes an already-preserved patch; it
// never runs git and never reads or writes a worktree.

import { createHash } from 'node:crypto';
import { canonicalBindingJson } from '../orchestration/crypto-binding';

export interface GithubChangeEnvelope {
  repo: string;
  base_branch: string;
  head_branch: string;
  base_sha: string;
  head_sha: string;
  diff_hash: string;
}

export type ChangeEnvelopeError =
  | 'repo_invalid'
  | 'base_branch_invalid'
  | 'head_branch_invalid'
  | 'base_sha_invalid'
  | 'head_sha_invalid'
  | 'diff_hash_invalid';

export type ChangeEnvelopeValidation =
  | { ok: true; envelope: GithubChangeEnvelope }
  | { ok: false; errors: ChangeEnvelopeError[] };

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^(?!\/)(?!.*(?:\.\.|\/\/))[A-Za-z0-9._/-]{1,200}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function validateGithubChangeEnvelope(raw: unknown): ChangeEnvelopeValidation {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const errors: ChangeEnvelopeError[] = [];
  if (typeof value.repo !== 'string' || !REPO_RE.test(value.repo)) {
    errors.push('repo_invalid');
  }
  if (typeof value.base_branch !== 'string' || !BRANCH_RE.test(value.base_branch)) {
    errors.push('base_branch_invalid');
  }
  if (typeof value.head_branch !== 'string' || !BRANCH_RE.test(value.head_branch)) {
    errors.push('head_branch_invalid');
  }
  if (typeof value.base_sha !== 'string' || !COMMIT_SHA_RE.test(value.base_sha)) {
    errors.push('base_sha_invalid');
  }
  if (typeof value.head_sha !== 'string' || !COMMIT_SHA_RE.test(value.head_sha)) {
    errors.push('head_sha_invalid');
  }
  if (typeof value.diff_hash !== 'string' || !SHA256_RE.test(value.diff_hash)) {
    errors.push('diff_hash_invalid');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, envelope: value as unknown as GithubChangeEnvelope };
}

export function canonicalGithubChange(envelope: GithubChangeEnvelope): string {
  return canonicalBindingJson({
    repo: envelope.repo,
    base_branch: envelope.base_branch,
    head_branch: envelope.head_branch,
    base_sha: envelope.base_sha,
    head_sha: envelope.head_sha,
    diff_hash: envelope.diff_hash,
  });
}

export function githubChangeDigest(envelope: GithubChangeEnvelope): string {
  return createHash('sha256').update(canonicalGithubChange(envelope), 'utf8').digest('hex');
}

export function diffHash(patchText: string): string {
  return createHash('sha256').update(patchText, 'utf8').digest('hex');
}

export type ChangeStaleness = {
  stale: boolean;
  reasons: Array<'base_sha_moved' | 'diff_changed'>;
};

export function isStale(
  envelope: GithubChangeEnvelope,
  currentBaseSha: unknown,
  currentDiffHash: unknown,
): ChangeStaleness {
  const reasons: ChangeStaleness['reasons'] = [];
  if (currentBaseSha !== envelope.base_sha) reasons.push('base_sha_moved');
  if (currentDiffHash !== envelope.diff_hash) reasons.push('diff_changed');
  return { stale: reasons.length > 0, reasons };
}
