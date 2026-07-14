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
