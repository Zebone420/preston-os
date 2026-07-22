// Preston AI OS - Phase 7 store-backed worktree lock. Persists the atomic
// worktree allocation onto the EXISTING repository_worktrees table (migration
// 0004, already applied) - NO new table, no duplicate persistence. The DB
// unique(id) primary key is the real compare-and-set that makes allocation
// atomic; the pure decideAcquire (worktree-lock.ts) computes the decision, and
// a conditional update fenced on lock_id enforces takeover/release. Server-
// side, RLS-bound; never the service-role key. Persists STATE only.

import type { RuntimeClient, WriteOutcome } from '../store';
import { RUNTIME_TABLES } from '../store';
import { decideAcquire, type AcquireInput, type WorktreeLock } from './worktree-lock';

// lock_id encodes the ownership token AND the fence: "<token>#<fence>". The
// fence is what makes a revived stale holder unable to act - its old lock_id
// no longer matches the current row.
function encodeLockId(token: string, fence: number): string {
  return `${token}#${fence}`;
}
export function decodeLockId(lockId: string): { token: string; fence: number } | null {
  if (typeof lockId !== 'string') return null;
  const i = lockId.lastIndexOf('#');
  if (i < 0) return null;
  const token = lockId.slice(0, i);
  const fence = Number(lockId.slice(i + 1));
  if (!token || !Number.isInteger(fence)) return null;
  return { token, fence };
}

// Reconstruct a WorktreeLock from a persisted repository_worktrees row (the
// caller supplies allowed_paths from the job envelope; it is a runtime check,
// not persisted). Returns null if the row is not a lock.
export function lockFromRow(
  row: Record<string, unknown> | undefined,
  allowedPaths: string[],
): WorktreeLock | null {
  if (!row || !row['lock_id']) return null;
  const dec = decodeLockId(String(row['lock_id']));
  if (!dec) return null;
  return {
    worktree_id: String(row['id']),
    repo: String(row['repo'] ?? ''),
    job_id: String(row['job_id'] ?? ''),
    owner: String(row['agent'] ?? ''),
    token: dec.token,
    fence: dec.fence,
    base_commit: String(row['base_commit'] ?? ''),
    branch: String(row['target_branch'] ?? ''),
    allowed_paths: allowedPaths,
    acquired_at: String(row['updated_at'] ?? ''),
    expires_at: String(row['lease_expires_at'] ?? row['expires_at'] ?? ''),
  };
}

async function readWorktreeRow(
  client: RuntimeClient,
  worktreeId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await client.from(RUNTIME_TABLES.worktrees).select('*').eq('id', worktreeId).limit(1);
    if (res.error) return undefined;
    return res.data?.[0];
  } catch {
    return undefined;
  }
}

// Atomically acquire (or take over a stale) worktree lock. Reads the current
// row, runs the pure decision, then either INSERTs (unique id = atomic
// first-writer-wins) or conditionally UPDATEs fenced on the previous lock_id.
export async function acquireWorktreeLock(
  client: RuntimeClient,
  input: Omit<AcquireInput, 'existing'>,
): Promise<{ ok: true; lock: WorktreeLock } | { ok: false; reason: string }> {
  const row = await readWorktreeRow(client, input.worktree_id);
  const existing = lockFromRow(row, input.allowed_paths);
  const decision = decideAcquire({ ...input, existing });
  if (!decision.ok) return decision;

  const lock = decision.lock;
  const patch = {
    id: lock.worktree_id,
    repo: lock.repo,
    job_id: lock.job_id,
    agent: lock.owner,
    base_commit: lock.base_commit,
    target_branch: lock.branch,
    lock_id: encodeLockId(lock.token, lock.fence),
    status: 'assigned',
    lease_expires_at: lock.expires_at, // persist expiry so stale takeover works
    updated_at: lock.acquired_at,
  };

  try {
    if (!row) {
      // First allocation: insert. DB unique(id) rejects a concurrent racer.
      const res = await client.from(RUNTIME_TABLES.worktrees).insert(patch).select('id');
      if (res.error) return { ok: false, reason: 'race_lost' };
      return { ok: true, lock };
    }
    // Takeover/refresh: conditional update fenced on the PREVIOUS lock_id.
    const prevLockId = existing ? encodeLockId(existing.token, existing.fence) : '';
    const upd = await client
      .from(RUNTIME_TABLES.worktrees)
      .update(patch)
      .eq('id', lock.worktree_id)
      .eq('lock_id', prevLockId)
      .select('id');
    if (upd.error) return { ok: false, reason: upd.error.message };
    if (!upd.data || upd.data.length === 0) return { ok: false, reason: 'race_lost' };
    return { ok: true, lock };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'acquire_failed' };
  }
}

// Release: conditional update to unassigned, fenced on the caller's lock_id.
// NO destructive cleanup (the owner-run script removes the worktree dir).
export async function releaseWorktreeLock(
  client: RuntimeClient,
  worktreeId: string,
  token: string,
  fence: number,
  nowIso: string,
): Promise<WriteOutcome> {
  try {
    const res = await client
      .from(RUNTIME_TABLES.worktrees)
      .update({ status: 'unassigned', lock_id: '', updated_at: nowIso })
      .eq('id', worktreeId)
      .eq('lock_id', encodeLockId(token, fence))
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) return { ok: false, error: 'not_holder_or_fenced' };
    return { ok: true, id: worktreeId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'release_failed' };
  }
}
