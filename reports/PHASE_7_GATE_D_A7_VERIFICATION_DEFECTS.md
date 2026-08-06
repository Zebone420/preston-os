# GATE D A7 - DRIVER VERIFICATION DEFECTS - DIAGNOSIS + FIXES (CODE CLOSED)

Closed: 2026-08-06 (UTC). Two further live findings behind the fresh-goal
park, diagnosed from the deployed host log (disp-101995, disp-102208) and
the unchanged goal_jobs rows (updated_at frozen at 00:40:56Z).

## Finding 2: approve-before-park ordering (fix 39d2f17)

The unlock loop (driver.ts) only considered jobs already awaiting_approval.
The fresh gated job was approved while still 'pending' (compose -> approve
-> first drive). Cycle 1 skipped it, the engine parked it, the ungated
docs job completed, and driveGoal's blockedOnApproval branch ended the run
- a fully approved goal needed a second oneshot.
FIX: unlock loop also covers 'pending' gated jobs; clearApprovalGate gains
a fromStatus param ('pending'|'awaiting_approval', default unchanged).
Fail-closed preserved: forged/undecided pending jobs park exactly as
before (3 regressions).

## Finding 3: timestamptz round-trip broke the canonical hash (fix 0ecee8b)

Recovery oneshot disp-102208 selected the fresh goal (A7 scan worked),
ran authoritative verification for the first time against the REAL
database, and refused silently; job rows untouched.
ROOT CAUSE: jobApprovalEnvelope hashed created_at/expires_at as RAW
strings. Mint side used toISOString() form (...T00:40:56.506Z); the
driver's rebuild used the PostgREST timestamptz representation
(...T00:40:56.506+00:00). String-unequal -> action_hash_mismatch for
EVERY composer-minted approval verified against real PostgREST, while
string-preserving test fakes passed. Same fake-fidelity class as the
Gate D approval-PK finding (541b578).
FIX: canonicalInstant() normalizes both mint and verify inputs to the
instant's toISOString() form - the bound VALUE is the instant, not its
representation; unparseable input stays raw (still refuses, fail-closed).
RETROACTIVE VALIDITY: mint-time inputs were already toISOString() output,
so the STORED hash of apr-482003a569cae6a392e1bc50 becomes verifiable
without re-approval (pinned by the round-trip regression, which mints
with Z-form, rewrites the record to +00:00 form, and completes).

## Finding 4 (observability): silent refusal (fix 0ecee8b)

verifyAuthoritativeApproval refusals were invisible in the oneshot log -
this cost a full drill cycle. driverStep now returns unlockRefusals
[{job_id, reason}]; driveGoal propagates them; the dispatcher logs them
in the summary line. Observability only - never used for authorization;
the forged-record regression asserts reason action_hash_mismatch surfaces.

## Validation (at 0ecee8b)

Focused 10-suite matrix 215/215 (incl. 5 new regressions: one-oneshot
pre-approved completion, forged pending parks + reason surfaced,
undecided pending parks, timestamptz round-trip completes, A7 starvation
suite intact). tsc 0, eslint 0, next build 0, os-runtime build 0,
secret+RED scans 0/0 x2 commits.

## Deployment requirement

driver.ts + crypto-binding.ts + dispatcher.ts compile into
dist/os-runtime/bin.js: HOST RE-PIN + REBUILD REQUIRED before the
completing oneshot. Correction of record: the prior session note that
"no redeploy is needed" was WRONG - disp-102208 disproved it; this doc
supersedes it.
