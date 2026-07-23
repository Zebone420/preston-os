// Preston AI OS - Phase 7 atomic worktree lock. PURE decision logic.
// The STATE MACHINE for allocating an isolated worktree to exactly one job:
// ownership token, base-commit pin, dirty-tree rejection, branch-collision
// rejection, allowed-path enforcement, always-expiring lease, and stale-lock
// recovery WITH FENCING (a stale successor's higher fence supersedes; a
// revived stale holder cannot act). The DB (existing repository_worktrees row, unique id)
// is the real compare-and-set; this module decides, it does not perform I/O,
// git, or filesystem operations. The actual `git worktree add` runs only via
// the owner-run worktree_prepare.sh at an activation gate.

import { RUNTIME_ID_RE } from '../commands';

export interface WorktreeLock {
  worktree_id: string; // e.g. wt-<jobId>
  repo: string;
  job_id: string;
  owner: string; // agent role/identity currently holding it
  token: string; // ownership token (fencing)
  fence: number; // monotonic fence; higher wins on takeover
  base_commit: string; // pinned base
  branch: string; // wt/<jobId>
  allowed_paths: string[]; // path-scope allowlist (prefixes)
  acquired_at: string;
  expires_at: string;
}

export interface AcquireInput {
  worktree_id: string;
  repo: string;
  job_id: string;
  owner: string;
  token: string;
  base_commit: string;
  branch: string;
  allowed_paths: string[];
  now: string;
  ttlMs?: number;
  // environment facts the caller observed (git status / branch list):
  tree_dirty: boolean;
  branch_exists: boolean;
  // existing lock on this worktree_id, if any (from the DB read):
  existing?: WorktreeLock | null;
}

export type AcquireResult =
  | { ok: true; lock: WorktreeLock }
  | { ok: false; reason: string };

const DEFAULT_TTL = 30 * 60 * 1000;
// A lease must be positive and bounded. A zero/negative TTL would mint an
// already-expired lock (instant stale-takeover churn); an excessive TTL would
// let a crashed holder block a worktree for far too long. 6h hard cap.
const MAX_TTL = 6 * 60 * 60 * 1000;

function validId(s: string): boolean {
  return typeof s === 'string' && RUNTIME_ID_RE.test(s);
}
function isCommit(s: string): boolean {
  return typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s);
}
function isExpired(lock: WorktreeLock, nowMs: number): boolean {
  const exp = Date.parse(lock.expires_at);
  return !Number.isFinite(exp) || exp <= nowMs;
}
function samePaths(a: string[], b: string[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// Decide whether an allocation is permitted. Fail-closed on every invalid or
// unsafe input. On a stale existing lock, allow takeover with a HIGHER fence.
export function decideAcquire(input: AcquireInput): AcquireResult {
  if (!validId(input.worktree_id)) return { ok: false, reason: 'worktree_id_invalid' };
  if (!validId(input.job_id)) return { ok: false, reason: 'job_id_invalid' };
  if (!input.owner?.trim()) return { ok: false, reason: 'owner_required' };
  if (!validId(input.token)) return { ok: false, reason: 'token_invalid' };
  if (!isCommit(input.base_commit)) return { ok: false, reason: 'base_commit_invalid' };
  if (!input.branch?.startsWith('wt/')) return { ok: false, reason: 'branch_must_be_wt_prefixed' };
  if (!Array.isArray(input.allowed_paths) || input.allowed_paths.length === 0) {
    return { ok: false, reason: 'allowed_paths_required' };
  }
  if (input.allowed_paths.some((p) => typeof p !== 'string' || p.includes('..') || p.startsWith('/'))) {
    return { ok: false, reason: 'allowed_path_unsafe' };
  }
  if (input.tree_dirty) return { ok: false, reason: 'dirty_tree' };
  if (input.branch_exists) return { ok: false, reason: 'branch_collision' };

  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'now_invalid' };
  // TTL validation (audit #18): reject zero/negative/non-finite/excessive.
  if (input.ttlMs !== undefined &&
      (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_TTL)) {
    return { ok: false, reason: 'ttl_invalid' };
  }

  const existing = input.existing ?? null;
  let fence = 1;
  if (existing) {
    if (!isExpired(existing, nowMs)) {
      // Live lock held by someone else on this worktree id.
      if (existing.owner !== input.owner || existing.token !== input.token) {
        return { ok: false, reason: 'held_by_another' };
      }
      // Re-entrant refresh by the same holder: ONLY a renewal of the IDENTICAL
      // binding is allowed. Any change to the pinned scope (job/base/branch/
      // paths/repo/worktree_id) is a rebinding attempt and is rejected -
      // no scope widening under a live lock.
      if (
        existing.job_id !== input.job_id ||
        existing.base_commit !== input.base_commit ||
        existing.branch !== input.branch ||
        existing.repo !== input.repo ||
        existing.worktree_id !== input.worktree_id ||
        !samePaths(existing.allowed_paths, input.allowed_paths)
      ) {
        return { ok: false, reason: 'lock_binding_mismatch' };
      }
      // Identical binding: bump fence, extend.
      fence = existing.fence + 1;
    } else {
      // Stale lock: takeover with a strictly higher fence (fencing).
      fence = existing.fence + 1;
    }
  }

  const ttl = input.ttlMs ?? DEFAULT_TTL;
  return {
    ok: true,
    lock: {
      worktree_id: input.worktree_id,
      repo: input.repo,
      job_id: input.job_id,
      owner: input.owner,
      token: input.token,
      fence,
      base_commit: input.base_commit,
      branch: input.branch,
      allowed_paths: [...input.allowed_paths],
      acquired_at: input.now,
      expires_at: new Date(nowMs + ttl).toISOString(),
    },
  };
}

// Fencing check for any action a holder attempts: the action's fence must
// match the CURRENT lock fence. A revived stale holder (lower fence) is
// rejected even if it still has a valid-looking token.
export function fenceValid(current: WorktreeLock, actionFence: number): boolean {
  return Number.isInteger(actionFence) && actionFence === current.fence;
}

// Is a path write permitted under the lock's allowlist? Prefix match; any
// traversal or absolute path is rejected.
export function pathAllowed(lock: WorktreeLock, path: string): boolean {
  if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) return false;
  return lock.allowed_paths.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'));
}

// Release decision: only the current fenced owner+token may release; NO
// destructive cleanup is implied (the owner-run script removes the worktree).
export function canRelease(current: WorktreeLock, owner: string, token: string, actionFence: number): boolean {
  return current.owner === owner && current.token === token && fenceValid(current, actionFence);
}
