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

// Sentinel "already expired" instant used to model a released-but-present row
// as a takeover-able existing lock (keeps the fence monotonic across release).
const EPOCH = '1970-01-01T00:00:00.000Z';

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

// Reconstruct a WorktreeLock from a persisted repository_worktrees row. The
// lock binding (allowed_paths, fence) is PERSISTED on the row (columns added in
// migration 0010), so re-entry can COMPARE the stored binding rather than
// reconstruct it (audit #11). allowedPaths is only a fallback for legacy rows
// written before the column existed. Returns null if the row is not a lock.
export function lockFromRow(
  row: Record<string, unknown> | undefined,
  allowedPaths: string[],
): WorktreeLock | null {
  if (!row || !row['lock_id']) return null;
  const dec = decodeLockId(String(row['lock_id']));
  if (!dec) return null;
  const persisted = Array.isArray(row['allowed_paths'])
    ? (row['allowed_paths'] as string[])
    : null;
  const fenceCol = Number(row['fence']);
  return {
    worktree_id: String(row['id']),
    repo: String(row['repo'] ?? ''),
    job_id: String(row['job_id'] ?? ''),
    owner: String(row['agent'] ?? ''),
    token: dec.token,
    // Observed generation = max(persisted column, generation encoded in
    // lock_id). A migrated/legacy row may carry a 0-defaulted column while its
    // lock_id already encodes a higher generation; taking the max prevents that
    // encoded generation from recurring (ABA).
    fence: Math.max(Number.isInteger(fenceCol) ? fenceCol : 0, dec.fence),
    base_commit: String(row['base_commit'] ?? ''),
    branch: String(row['target_branch'] ?? ''),
    allowed_paths: persisted ?? allowedPaths,
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
  const heldLock = lockFromRow(row, input.allowed_paths);
  // Monotonic generation (audit BLOCKER / ABA fix): the fence NEVER resets. It
  // survives release, so a released slot is re-acquired at generation + 1 - a
  // previously-released ownership generation (token#fence) can never recur and
  // let a revived holder release a new lock.
  //
  // Two distinct values are needed:
  //  - columnFence: the ACTUAL persisted fence column value; the CAS must match
  //    it exactly (it may be 0 on a legacy/migrated row).
  //  - observedGeneration: max(columnFence, generation encoded in lock_id) - the
  //    true current generation even when a migrated row's column lags its
  //    lock_id. The next fence is observedGeneration + 1.
  const columnFence = row && Number.isInteger(Number(row['fence'])) ? Number(row['fence']) : 0;
  const decodedFence = decodeLockId(String(row?.['lock_id'] ?? ''))?.fence ?? 0;
  const observedGeneration = Math.max(columnFence, decodedFence);
  const prevLockId = String(row?.['lock_id'] ?? '');
  // A released row (exists, lock_id empty) is available, but must keep the
  // fence monotonic: model it as an EXPIRED existing lock carrying the observed
  // generation so decideAcquire takes over at generation + 1, not 1.
  const existing: WorktreeLock | null = heldLock ?? (row
    ? {
        worktree_id: input.worktree_id, repo: input.repo, job_id: '', owner: '',
        token: '', fence: observedGeneration, base_commit: '', branch: '',
        allowed_paths: [], acquired_at: '', expires_at: EPOCH,
      }
    : null);
  const decision = decideAcquire({ ...input, existing });
  if (!decision.ok) return decision;

  const lock = decision.lock;
  // Map onto the REAL repository_worktrees schema (migration 0004 + the 0010
  // additive fencing columns). `path` is NOT NULL and required; `status` must
  // be one of the 0004 CHECK values ('in_use' while held, 'unassigned' when
  // released) - NEVER 'assigned' (not a valid status). fence/allowed_paths/
  // lease_expires_at are the 0010 additive columns that persist the full lock
  // binding so stale takeover and re-entry comparison work.
  const patch = {
    id: lock.worktree_id,
    repo: lock.repo,
    path: `/srv/worktrees/${lock.worktree_id}`,
    job_id: lock.job_id,
    agent: lock.owner,
    base_commit: lock.base_commit,
    target_branch: lock.branch,
    lock_id: encodeLockId(lock.token, lock.fence),
    fence: lock.fence,
    allowed_paths: lock.allowed_paths,
    status: 'in_use',
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
    // Takeover / refresh / re-acquire: CAS on BOTH the prior lock_id AND the
    // prior fence (audit BLOCKER) so only the exact observed generation is
    // replaced. prevLockId is the row's current lock_id ('' when released).
    const upd = await client
      .from(RUNTIME_TABLES.worktrees)
      .update(patch)
      .eq('id', lock.worktree_id)
      .eq('lock_id', prevLockId)
      .eq('fence', String(columnFence))
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
    // Relinquish ownership: clear lock_id and EXPIRE the lease (so the slot is
    // immediately re-acquirable) but LEAVE the fence column at its current
    // generation so the next acquire increments from it (ABA fix). CAS on the
    // caller's encoded lock_id AND fence so only the true holder can release.
    const res = await client
      .from(RUNTIME_TABLES.worktrees)
      .update({ status: 'unassigned', lock_id: '', lease_expires_at: nowIso, updated_at: nowIso })
      .eq('id', worktreeId)
      .eq('lock_id', encodeLockId(token, fence))
      .eq('fence', String(fence))
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) return { ok: false, error: 'not_holder_or_fenced' };
    return { ok: true, id: worktreeId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'release_failed' };
  }
}
