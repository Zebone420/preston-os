# GATE D A7 - SCHEDULER STARVATION - DIAGNOSIS + FIX (CODE CLOSED)

Opened/closed: 2026-08-05/06 (UTC). Live finding on the deployed staging
host during the Gate D approve-path rerun.

## Live symptom (owner evidence)

Fresh goal 5db7d3af (decomposed, gated job 6d5408ca approved via
apr-482003a5..., nonce recorded, hash bound) was never selected. The
oneshot exited 0 having selected OLD goal 379ecb65 (blocked) and logged
stoppedReason=awaiting_owner_approval, skipped=true. Executed remained
false everywhere; posture unchanged.

## Root cause (read-only diagnosis)

apps/dashboard/src/os-runtime/dispatcher.ts (orchestrate-once):

1. DRIVEABLE_GOAL_STATUSES = [decomposed, running, blocked] -
   INTENTIONAL: a blocked goal must stay driveable so a later owner
   approval can unblock it. Not the defect.
2. Selection merged the per-status windows, sorted oldest-first, and
   took index [0] - exactly ONE goal per oneshot.
3. The "parked fast path" then ENDED THE RUN when every non-terminal
   job of that one goal was awaiting_approval with no linked record
   claiming approved.

Combination = permanent head-of-line starvation: an older goal parked
on a pending/expired-undecided approval is selected on EVERY oneshot
and ends every run. The oldest-first order (added to stop NEW goals
starving OLD ones, Codex MAJOR #4) made the opposite starvation
unreachable-younger-goal case inevitable. Expiry does not terminate
the stale approval (status stays pending; expiry is decision-time
enforced per CL-3c), so the head never clears on its own.

## Fix chosen (smallest bounded option 2: continue scanning)

- NOT option 1 (exclude blocked): blocked goals must remain driveable
  for the approve-unblock path - excluding them breaks Gate D itself.
- NOT option 3 (expire stale approvals pre-selection): a write during
  selection, larger blast radius, and CL-3c semantics (decision-time
  enforcement) are already proven live - not touched.
- CHOSEN: the selector scans the merged, already-bounded window
  (<= 50 x 3 statuses) oldest-first; each provably-parked goal is
  logged (skipped=true) and skipped; the FIRST goal that can progress
  is driven. Skip needs POSITIVE evidence (jobs readable, all
  non-terminal jobs awaiting_approval, no record claiming approved);
  any read failure still fails the whole run. If ALL candidates are
  parked, exit 0 with skippedParked[] naming each. Approval
  enforcement untouched: driver verifyAuthoritativeApproval remains
  the only unlock authority; no statuses mutated; no residue deleted.

## Changes

- fix ba54ccc: dispatcher.ts selection loop + skippedParked in log/
  summary; orchestrate-once.test.ts new suite "parked goals do not
  starve younger goals (Gate D A7)" reproducing the live scenario
  end-to-end (old parked goal with pending undecided record; younger
  approved goal completes executed=false; old rows byte-untouched;
  both-parked exit 0 lists both).
- fix 1a9b053: approval rows render approval_id + goal/job binding
  visibly (wrong-row root cause: ids lived only in aria-labels).

## Validation

orchestrate-once 28/28 (incl. new regression). Full vitest 1052 pass /
1 env-class fail (worktree-prep bash scanner spawn on Windows, known
baseline, ps1 scanners compensate 0/0) / 1 expected fail (D2-L1).
tsc 0, eslint 0, next build 0, os-runtime build 0, secret+RED scans
0/0 both commits.

## Deployment requirement

dispatcher.ts is compiled into dist/os-runtime/bin.js - THE HOST MUST
BE RE-PINNED AND REBUILT before the Gate D oneshot rerun. Vercel
redeploy also required for the row-binding UI. Same owner E-block
shape as the 15085cf re-pin.
