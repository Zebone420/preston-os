# PHASE 7 - ATOMIC WORKTREE LOCK OWNER PACKET

Date: 2026-07-22. Status: the lock STATE MACHINE is coded + tested
(pure); the real git/filesystem allocation remains an owner-run
script gated at activation-ladder Level 1. This packet defines
how the pure lock becomes a real, atomic, enforced isolation
boundary.

## What is built (verified)

- orchestration/worktree-lock.ts - decideAcquire (ownership
  token, base-commit pin, dirty-tree rejection, branch-collision
  rejection, allowed-path allowlist, always-expiring lease,
  stale-lock takeover with a strictly higher FENCE), fenceValid
  (a revived stale holder is fenced out), pathAllowed (prefix
  allowlist, traversal/absolute rejected), canRelease (current
  fenced owner+token only; no destructive cleanup implied).
- Tests: orchestration-durable.test.ts worktree section - clean
  acquire, dirty/branch collisions, unsafe paths, concurrent
  allocation (second holder refused), stale takeover + fencing,
  path allowlist, release authorization.

## What is NOT built (honest gate)

The pure module DECIDES; it performs no git, no filesystem I/O,
no lock persistence. There is no enforced isolation yet.

## Owner-gated path to enforced isolation (Level 1)

W1 (CLAUDE, simulation-safe): persist the lock via the EXISTING
   `locks` table + locks.ts adapter (unique id = the real CAS) -
   store.ts-style acquire/renew/release wrappers around
   decideAcquire, with the DB unique(id) rejecting concurrent
   acquisition atomically. No new lock system.
W2 (CLAUDE): extend the existing owner-run scripts/worktree_
   prepare.sh to (a) verify a clean tree (fail if dirty), (b)
   reject an existing branch, (c) `git worktree add` at the
   pinned base_commit on branch wt/<jobId>, (d) print the
   ownership token + fence for the driver to record. The script
   stays OWNER-RUN and NON-destructive (no force, no auto-push,
   no worktree removal without an explicit release).
W3 (OWNER, Level 1 activation): run the real allocation for ONE
   bounded job; verify a second concurrent allocation is refused,
   a stale lock is fenced out, and only allowlisted paths are
   writable. Only after this is real isolation "enforced and
   proven".

## Invariants preserved

One worktree per job; base-commit pinned; dirty/branch collisions
rejected; path scope enforced; leases always expire; stale
recovery fences the old holder; no force push; no destructive
cleanup; no auto-push. Reviewer read-only is enforced by giving
the reviewer role (codex/audit) no worktree write lock - it reads
the implementer's branch, never holds the write lock.

## Hard stops

No push, no force, no destructive git, no auto-cleanup of a live
worktree, no execution enablement. Level 1 activation is an owner
decision.
