// Architect Gate AG-3: pure branch policy and a thin adapter to the existing
// fenced worktree-lock contract. This module never creates a worktree and
// never writes a Git ref.

import { RUNTIME_ID_RE } from '../commands';
import type { AcquireInput } from '../orchestration/worktree-lock';
import type { ArchitectRequest } from './intake';

export type BranchPolicyReason =
  | 'branch_allowed'
  | 'base_branch_not_allowed'
  | 'head_branch_invalid'
  | 'head_branch_protected'
  | 'correlation_id_invalid';

export interface BranchPolicyDecision {
  allowed: boolean;
  reason: BranchPolicyReason;
  base_protected: boolean;
}

export function isProtectedBase(branch: unknown): boolean {
  return typeof branch === 'string' &&
    (branch === 'master' || branch.startsWith('release/'));
}

export function isBranchAllowed(head: unknown, correlationId: unknown): boolean {
  return typeof head === 'string' &&
    typeof correlationId === 'string' &&
    RUNTIME_ID_RE.test(correlationId) &&
    head === `architect/${correlationId}` &&
    !isProtectedBase(head);
}

export function evaluateBranchPolicy(args: {
  base_branch: unknown;
  head_branch: unknown;
  correlation_id: unknown;
  allowed_base_branches: readonly string[] | null | undefined;
}): BranchPolicyDecision {
  if (typeof args.correlation_id !== 'string' ||
      !RUNTIME_ID_RE.test(args.correlation_id)) {
    return { allowed: false, reason: 'correlation_id_invalid', base_protected: false };
  }
  const base = typeof args.base_branch === 'string' ? args.base_branch : '';
  const allowedBases = Array.isArray(args.allowed_base_branches)
    ? args.allowed_base_branches : [];
  if (!base || !allowedBases.includes(base)) {
    return { allowed: false, reason: 'base_branch_not_allowed',
      base_protected: isProtectedBase(base) };
  }
  if (isProtectedBase(args.head_branch)) {
    return { allowed: false, reason: 'head_branch_protected',
      base_protected: isProtectedBase(base) };
  }
  if (!isBranchAllowed(args.head_branch, args.correlation_id)) {
    return { allowed: false, reason: 'head_branch_invalid',
      base_protected: isProtectedBase(base) };
  }
  return { allowed: true, reason: 'branch_allowed',
    base_protected: isProtectedBase(base) };
}

export type ArchitectAcquireResult =
  | { ok: true; input: AcquireInput; github_head_branch: string }
  | { ok: false; reason: BranchPolicyReason };

// The GitHub head and ephemeral worktree branch are intentionally distinct:
// worktree-lock.ts requires its existing wt/<job> namespace, while AG-3
// requires the only remotely addressable head to be architect/<correlation>.
export function buildArchitectAcquireInput(args: {
  request: ArchitectRequest;
  head_branch: string;
  allowed_base_branches: readonly string[];
  worktree_id: string;
  owner: string;
  token: string;
  base_commit: string;
  allowed_paths: string[];
  now: string;
  ttlMs?: number;
  tree_dirty: boolean;
  branch_exists: boolean;
}): ArchitectAcquireResult {
  const policy = evaluateBranchPolicy({
    base_branch: args.request.base_branch,
    head_branch: args.head_branch,
    correlation_id: args.request.correlation_id,
    allowed_base_branches: args.allowed_base_branches,
  });
  if (!policy.allowed) return { ok: false, reason: policy.reason };
  return {
    ok: true,
    github_head_branch: args.head_branch,
    input: {
      worktree_id: args.worktree_id,
      repo: args.request.repo,
      job_id: args.request.source_goal_job_id,
      owner: args.owner,
      token: args.token,
      base_commit: args.base_commit,
      branch: `wt/${args.request.source_goal_job_id}`,
      allowed_paths: [...args.allowed_paths],
      now: args.now,
      ttlMs: args.ttlMs,
      tree_dirty: args.tree_dirty,
      branch_exists: args.branch_exists,
    },
  };
}
