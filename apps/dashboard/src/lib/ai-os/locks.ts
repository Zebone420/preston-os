import type { LockRecord, LockScope } from './types';

// Preston AI OS - distributed locking decisions (Phase 2 foundation).
// PURE and deterministic given an injected `now`. Locks always expire (no
// permanent locks), support safe recovery of a stale lock, are re-entrant for
// the same owner, and record ownership + timestamps. The actual compare-and-set
// is enforced by the DB (conditional update / RLS); this module computes the
// decision so it is unit-testable without any network.

export function isExpired(lock: LockRecord, now: string): boolean {
  return Date.parse(lock.expires_at) <= Date.parse(now);
}

// Can `who` take the lock given the current holder (or none)? Free or expired
// locks are acquirable; a live lock is only re-acquirable by its own owner.
export function canAcquire(
  current: LockRecord | null,
  who: string,
  now: string,
): boolean {
  if (!current) return true;
  if (isExpired(current, now)) return true; // safe recovery of a stale lock
  return current.owner === who; // re-entrant for the same owner
}

export interface AcquireRequest {
  scope: LockScope;
  resource: string;
  owner: string;
  ttlMs: number; // lock lifetime; must be > 0
}

// Returns the new lock record, or null if the lock cannot be taken.
export function acquire(
  current: LockRecord | null,
  req: AcquireRequest,
  now: string,
): LockRecord | null {
  if (req.ttlMs <= 0) return null; // no permanent/invalid locks
  if (!canAcquire(current, req.owner, now)) return null;
  const expires = new Date(Date.parse(now) + req.ttlMs).toISOString();
  return {
    id: req.scope + ':' + req.resource,
    scope: req.scope,
    resource: req.resource,
    owner: req.owner,
    acquired_at: now,
    expires_at: expires,
  };
}

// Only the current owner may release; expired locks need no release.
export function canRelease(current: LockRecord | null, who: string): boolean {
  return current !== null && current.owner === who;
}
