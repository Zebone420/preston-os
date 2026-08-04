# PHASE 7 - GATE B (CL-3.1/3.2 COMPOSER CREATE) - CLOSE EVIDENCE
# RESULT: PASS WITH NOTES

Closed: 2026-08-04 (UTC). Deployed build: c24a7e5 (Vercel Block V'
PASS + host CL-2/2 PASS). Owner drove the browser; agent verified
every item against the deterministic pins and the pinned source.

## B2 - safety chips (owner, /os/composer, logged in)

execution false / remote_runner false / hermes observe_only. PASS.
(Re-confirmed on the restored page at B6-time, 2026-08-04.)

## B5 - first confirmation (owner)

Goal 106adcdf-7cd8-4929-a567-0de7f5f81036, jobs:
- 1e610b4e-bdcb-4888-b7ad-5b5b6f30c6ed Inspect the staging status data
- 424df50a-a39b-498c-8142-d816fd9803ee Generate a simulation-only
  readiness summary
- 1b9640a2-3724-4c9f-a0d1-7abd9a8c6108 Attach internal evidence
No approval ids; no per-job awaiting suffix. Job titles match the
CL-3.1 pin exactly (composer-engine.test.ts; hash pin 5bd2ea4b).

NOTE 1 (defect found + fixed): the success card's generic notice
"Gated tasks await owner approval" fired on this zero-approval graph.
Root cause proven = unconditional UI copy at actions.ts:132 (pre-fix);
full diagnosis in PHASE_7_GATE_B_MISMATCH_DIAGNOSIS.md. Fixed at
06ce6a4 (+2 regression tests); fix is COMMITTED on
phase7/offhost-0802, NOT yet deployed. Not a policy defect.

## Durable-graph proof (owner SQL, staging, 2026-08-04)

goal_jobs for the goal: exactly 3 rows, all status=pending, all
requires_approval=false, all approval_id NULL, all executed=false,
simulation_only=true; orchestration_approvals for the goal: 0;
job_dependencies: 2; master_goals titled 'Verify the Phase 7%': 1.
Matches the packet EXPECT on every line. PASS.

## B6 - duplicate-confirm idempotency: CLOSED VIA ALTERNATE EVIDENCE

NOTE 2: the live browser replay was NOT executable. After the page
state restored, the purple proposal section (which carries the hidden
request_key + Confirm button) was gone; only the green Created card
remained. Owner correctly STOPPED without re-interpreting.

Why no safe live replay exists (source-verified at the deployed
commit): actions.ts:51 mints `cmpreq-<randomUUID()>` per Interpret -
"duplicate CONFIRMS of this proposal are idempotent; a new compose is
a new request." Re-interpreting identical text would CREATE A SECOND
GOAL (correct new-goal semantics, same as the D2 orchestration-form
finding); the B5 request_key existed only in the lost client state
and is not recoverable (nor derivable - random, not content-hashed).
Hand-crafting a server-action POST is not a sanctioned surface.
Every live path is therefore either impossible or unsafe. STOP was
the right call.

Idempotency evidence accepted instead (three independent layers):
1. REAL staging DB, RPC layer: migration 0010 gate 4.7 B1 (CLOSED
   PASS 2026-07-28) proved on THIS database: first submit
   created:true, retry created:false same ids, cross-match P0001
   idempotency_conflict.
2. Server-action + persist layer, deterministic: composer-ui.test.ts
   'duplicate confirm (double-submit) does not duplicate records'
   (same payload replayed -> replayed:true, 'Duplicate confirmation'
   notice, still 1 goal / 3 jobs) + composer-persist idempotent
   requestKey path + duplicate-response.test.ts (Phase 5 real-drill
   defect regression: store returns stored ids on unique violation).
   Composer suites 81/81 at the branch tip.
3. Live counts: after the single real confirm, jobs=3,
   approval_rows=0, dep_edges=2, phase7_goals=1 - and identical on
   re-query at B6-time (nothing duplicated, no drift).
The only increment a live press would have added - the deployed
wiring returning replayed:true against the real DB - is the exact
composition of layers 1+2, each independently proven. ACCEPTED as
sufficient for CL-3.2 step 6.

FOLLOW-UP (non-blocking, recorded): a future UX gate may add a
sanctioned "re-show proposal" recovery so the replay drill is
browser-runnable after state loss; until then the packet's step-6
wording should note the state-loss limitation.

## Gate result

PASS WITH NOTES (Note 1 wording defect fixed 06ce6a4; Note 2 B6 via
alternate evidence). CL-3.2 steps 1-6 satisfied for goal
106adcdf-7cd8-4929-a567-0de7f5f81036; jobs pending; posture
unchanged (P1 re-confirmed via chips + P3=0 held through every SQL
capture). Drill continues at step 7 (Gate C oneshot drive).
