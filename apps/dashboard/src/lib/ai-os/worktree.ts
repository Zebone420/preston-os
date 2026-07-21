// Preston AI OS - shared repository / worktree coordination (Phase 3). PURE.
// Hybrid model: GitHub owns code; per-job/per-agent worktrees are isolated and
// lock-guarded so Claude and Codex never edit the same tree concurrently.
// Workers NEVER auto-push (owner-gated); no force ops; repo state is part of
// every checkpoint. This module plans/validates; it runs no git.

export type WorktreeStatus =
  | 'unassigned'
  | 'allocated'
  | 'in_use'
  | 'dirty'
  | 'verified'
  | 'cleanup_pending';

export interface Worktree {
  id: string;
  repo: string; // canonical repository name
  path: string; // isolated worktree path (relative)
  agent: string | null; // owning agent id
  job_id: string | null;
  base_commit: string;
  target_branch: string;
  status: WorktreeStatus;
  dirty: boolean;
  staged: boolean;
  untracked: boolean;
  lock_id: string | null; // must hold a lock to be allocated
  updated_at: string;
}

export interface AllocationRequest {
  repo: string;
  agent: string;
  job_id: string;
  base_commit: string;
  target_branch: string;
  now: string;
}

export interface AllocationCheck {
  ok: boolean;
  reason?: string;
}

// A worktree is allocatable only if it holds no other live owner and a lock is
// held. Free/verified/cleanup_pending trees are reusable; in_use/dirty by
// another agent are not.
export function canAllocate(
  wt: Worktree | null,
  req: AllocationRequest,
  lockHeld: boolean,
): AllocationCheck {
  if (!lockHeld) return { ok: false, reason: 'worktree allocation requires a lock' };
  if (!wt) return { ok: true };
  if (wt.agent && wt.agent !== req.agent && (wt.status === 'in_use' || wt.status === 'dirty')) {
    return { ok: false, reason: 'worktree in use by another agent' };
  }
  return { ok: true };
}

// Two agents may not share a worktree concurrently.
export function isConcurrentConflict(wt: Worktree, agent: string): boolean {
  return wt.agent !== null && wt.agent !== agent && wt.status === 'in_use';
}

// Cleanup only AFTER verification (never discard unverified work).
export function canCleanup(wt: Worktree): boolean {
  return wt.status === 'verified' || wt.status === 'cleanup_pending';
}

// Workers never push. Push stays owner-gated until a later activation gate.
export function workerPushAllowed(): boolean {
  return false;
}

// Plan an isolated worktree for a job. Path is namespaced by job to guarantee
// isolation; allocation still requires a lock (see canAllocate).
export function planWorktree(req: AllocationRequest): Worktree {
  return {
    id: 'wt-' + req.job_id,
    repo: req.repo,
    path: 'worktrees/' + req.job_id,
    agent: req.agent,
    job_id: req.job_id,
    base_commit: req.base_commit,
    target_branch: req.target_branch,
    status: 'allocated',
    dirty: false,
    staged: false,
    untracked: false,
    lock_id: 'repository:' + req.repo,
    updated_at: req.now,
  };
}

// A worktree with uncommitted changes must not be reused/handed off silently.
export function refusesDirtyReuse(wt: Worktree): boolean {
  return wt.dirty || wt.staged || wt.untracked;
}

// --- Phase 5j: worktree-prepare planning (pure; no git is run here) -------

export const WORKTREES_ROOT = '/srv/worktrees/';

// A single path segment: no separators, no leading dot-dot, bounded length.
const JOB_DIR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface PathCheck {
  ok: boolean;
  reason?: string;
}

// Validate a worktree path is an absolute, single-segment directory under
// /srv/worktrees/ with a safe name. Fails closed on anything ambiguous:
// traversal, backslashes, whitespace, null bytes, doubled slashes, or a
// trailing slash (which can mask an extra empty/traversal segment).
export function validateWorktreePath(path: string): PathCheck {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'path must be a non-empty string' };
  }
  if (path.includes('\u0000')) {
    return { ok: false, reason: 'path contains a null byte' };
  }
  if (/\s/.test(path)) {
    return { ok: false, reason: 'path contains whitespace' };
  }
  if (path.includes('\\')) {
    return { ok: false, reason: 'path contains a backslash' };
  }
  if (!path.startsWith('/')) {
    return { ok: false, reason: 'path must be absolute' };
  }
  if (path.includes('//')) {
    return { ok: false, reason: 'path contains a doubled slash' };
  }
  if (path.endsWith('/')) {
    return { ok: false, reason: 'path must not have a trailing slash' };
  }
  if (!path.startsWith(WORKTREES_ROOT)) {
    return { ok: false, reason: 'path must be under ' + WORKTREES_ROOT };
  }
  const rest = path.slice(WORKTREES_ROOT.length);
  if (rest.includes('..')) {
    return { ok: false, reason: 'path contains a traversal segment' };
  }
  const segments = rest.split('/');
  if (segments.length !== 1) {
    return { ok: false, reason: 'path must be a single segment under ' + WORKTREES_ROOT };
  }
  const jobDir = segments[0];
  if (!JOB_DIR_RE.test(jobDir)) {
    return { ok: false, reason: 'job directory name has an invalid shape' };
  }
  return { ok: true };
}

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

export interface RefCheck {
  ok: boolean;
  reason?: string;
}

// Validate a base branch name and base commit hash used to seed a worktree.
export function validateBaseRef(branch: string, commit: string): RefCheck {
  if (typeof branch !== 'string' || branch.length === 0) {
    return { ok: false, reason: 'branch must be a non-empty string' };
  }
  if (branch.includes('\u0000') || /\s/.test(branch)) {
    return { ok: false, reason: 'branch contains whitespace or a null byte' };
  }
  if (branch.startsWith('-')) {
    return { ok: false, reason: 'branch must not start with a dash' };
  }
  if (branch.includes('..')) {
    return { ok: false, reason: 'branch contains a traversal segment' };
  }
  if (!BRANCH_RE.test(branch)) {
    return { ok: false, reason: 'branch has an invalid shape' };
  }
  if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) {
    return { ok: false, reason: 'commit must be a 40-character hex sha' };
  }
  return { ok: true };
}

export interface WorktreePrepareRequest {
  jobId: string;
  baseBranch: string;
  baseCommit: string;
  implementer: string;
  reviewer: string;
}

export interface PreparedCommandStep {
  description: string;
  // Argv array, never a shell string - no shell is invoked with these.
  argv: string[];
}

export interface WorktreePreparePlan {
  ok: boolean;
  reason?: string;
  worktreePath?: string;
  branch?: string;
  steps?: PreparedCommandStep[];
}

// Build an ordered, bounded plan of commands for the OWNER-RUN prepare
// script to execute. This function runs no git itself; it only describes
// what the script must do, so the plan can be unit-tested without a
// filesystem or repository. Refuses (ok:false) on any invalid input,
// including implementer === reviewer (reviewer access must stay
// read-only and distinct from the writer's worktree).
export function worktreePreparePlan(req: WorktreePrepareRequest): WorktreePreparePlan {
  if (
    typeof req.implementer !== 'string' ||
    typeof req.reviewer !== 'string' ||
    req.implementer.length === 0 ||
    req.reviewer.length === 0
  ) {
    return { ok: false, reason: 'implementer and reviewer are required' };
  }
  if (req.implementer === req.reviewer) {
    return { ok: false, reason: 'implementer and reviewer must be distinct agents' };
  }
  if (typeof req.jobId !== 'string' || !JOB_DIR_RE.test(req.jobId)) {
    return { ok: false, reason: 'job id has an invalid shape' };
  }
  const refCheck = validateBaseRef(req.baseBranch, req.baseCommit);
  if (!refCheck.ok) {
    return { ok: false, reason: refCheck.reason };
  }
  const worktreePath = WORKTREES_ROOT + 'wt-' + req.jobId;
  const pathCheck = validateWorktreePath(worktreePath);
  if (!pathCheck.ok) {
    return { ok: false, reason: pathCheck.reason };
  }
  const branch = 'job/' + req.jobId;
  const branchCheck = validateBaseRef(branch, req.baseCommit);
  if (!branchCheck.ok) {
    return { ok: false, reason: branchCheck.reason };
  }

  const steps: PreparedCommandStep[] = [
    {
      description: 'verify the canonical repository has a clean working tree',
      argv: ['git', 'status', '--porcelain'],
    },
    {
      description: 'verify the base commit exists in the canonical repository',
      argv: ['git', 'cat-file', '-e', req.baseCommit + '^{commit}'],
    },
    {
      description:
        'acquire the repository lock (repository:canonical) before allocating a worktree',
      argv: ['echo', 'acquire-lock', 'repository:canonical'],
    },
    {
      description: 'create the isolated worktree on a new job branch from the base commit',
      argv: ['git', 'worktree', 'add', worktreePath, '-b', branch, req.baseCommit],
    },
    {
      description: 'verify the new worktree is clean immediately after creation',
      argv: ['git', '-C', worktreePath, 'status', '--porcelain'],
    },
    {
      description:
        'record an allocation checkpoint (path, branch, base commit, implementer, lock)',
      argv: ['echo', 'checkpoint', worktreePath, branch, req.baseCommit, req.implementer],
    },
    {
      description:
        'reviewer (' +
        req.reviewer +
        ') is granted READ-ONLY access to this worktree; no separate write worktree is created for review',
      argv: ['echo', 'reviewer-read-only', req.reviewer, worktreePath],
    },
  ];

  return { ok: true, worktreePath, branch, steps };
}
