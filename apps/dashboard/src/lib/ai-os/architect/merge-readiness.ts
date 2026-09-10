// Architect Gate AG-9: deterministic, read-only merge readiness advice.
// This module never fetches, merges, pushes, or changes branch protection.

import { createHash } from 'node:crypto';

import { canonicalBindingJson } from '../orchestration/crypto-binding';
import type { ArchitectProposal } from './proposal';

export interface LiveGithubCheck {
  conclusion: string | null;
  name: string;
}

export interface LiveBranchProtection {
  enforced: true;
  required_approving_reviews: number;
  required_checks: string[];
}

export interface LiveGithubMergeState {
  approving_reviews: number;
  base_tip_sha: string;
  branch_protection: LiveBranchProtection;
  checks: LiveGithubCheck[];
  head_sha: string;
  mergeable: boolean | null;
  pr_number: number;
  pr_url: string;
  state: 'open' | 'closed';
}

export interface MergeReadinessVerdict {
  disagreements: string[];
  evidence_ref: string;
  ready: boolean;
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
}

function parseLiveState(raw: unknown): LiveGithubMergeState | null {
  const value = record(raw);
  if (!value || !Number.isInteger(value.pr_number) ||
      typeof value.pr_url !== 'string' ||
      (value.state !== 'open' && value.state !== 'closed') ||
      typeof value.head_sha !== 'string' || typeof value.base_tip_sha !== 'string' ||
      (value.mergeable !== true && value.mergeable !== false && value.mergeable !== null) ||
      !Number.isInteger(value.approving_reviews) || (value.approving_reviews as number) < 0 ||
      !Array.isArray(value.checks)) return null;
  const protection = record(value.branch_protection);
  if (!protection || protection.enforced !== true ||
      !Number.isInteger(protection.required_approving_reviews) ||
      (protection.required_approving_reviews as number) < 0 ||
      !Array.isArray(protection.required_checks) ||
      !protection.required_checks.every((item) =>
        typeof item === 'string' && item.trim().length > 0)) return null;
  const checks = value.checks.map(record);
  if (checks.some((check) => !check || typeof check.name !== 'string' ||
      (check.conclusion !== null && typeof check.conclusion !== 'string'))) return null;
  return {
    approving_reviews: value.approving_reviews as number,
    base_tip_sha: value.base_tip_sha,
    branch_protection: {
      enforced: true,
      required_approving_reviews: protection.required_approving_reviews as number,
      required_checks: [...protection.required_checks] as string[],
    },
    checks: checks as unknown as LiveGithubCheck[],
    head_sha: value.head_sha,
    mergeable: value.mergeable,
    pr_number: value.pr_number as number,
    pr_url: value.pr_url,
    state: value.state,
  };
}

function evidenceRef(headSha: string, ready: boolean, disagreements: string[]): string {
  const digest = createHash('sha256').update(canonicalBindingJson({
    head_sha: headSha, ready: String(ready), disagreements: JSON.stringify(disagreements),
  }), 'utf8').digest('hex');
  return `merge_readiness:${headSha}:${digest}`;
}

export function evaluateMergeReadiness(
  proposal: ArchitectProposal,
  rawLiveState: unknown,
): MergeReadinessVerdict {
  const live = parseLiveState(rawLiveState);
  if (!live) {
    const disagreements = ['live_github_state_invalid'];
    return { ready: false, disagreements,
      evidence_ref: evidenceRef(proposal.change.head_sha, false, disagreements) };
  }

  const disagreements: string[] = [];
  if (!proposal.pr) disagreements.push('recorded_pr_missing');
  if (proposal.pr && proposal.pr.pr_number !== live.pr_number) {
    disagreements.push('pr_number_mismatch');
  }
  if (proposal.pr && proposal.pr.pr_url !== live.pr_url) {
    disagreements.push('pr_url_mismatch');
  }
  if (live.state !== 'open') disagreements.push('pr_not_open');
  if (live.head_sha !== proposal.change.head_sha) disagreements.push('head_sha_mismatch');
  if (live.base_tip_sha !== proposal.change.base_sha) disagreements.push('base_sha_moved');
  if (live.mergeable !== true) disagreements.push(
    live.mergeable === false ? 'pr_not_mergeable' : 'mergeability_unknown',
  );

  const checksByName = new Map(live.checks.map((check) => [check.name, check.conclusion]));
  for (const required of live.branch_protection.required_checks) {
    if (!checksByName.has(required)) disagreements.push(`required_check_missing:${required}`);
    else if (checksByName.get(required) !== 'success') {
      disagreements.push(`required_check_not_successful:${required}`);
    }
  }
  if (live.approving_reviews < live.branch_protection.required_approving_reviews) {
    disagreements.push('required_approving_reviews_missing');
  }

  const ready = disagreements.length === 0;
  return { ready, disagreements,
    evidence_ref: evidenceRef(proposal.change.head_sha, ready, disagreements) };
}
