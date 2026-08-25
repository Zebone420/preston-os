# Galaxy G1-G8 device drill - evidence + adjudication (2026-08-25)

Surface: Preston Control GPT (Actions, client B) on the physical Galaxy,
against the staging alias (RC 4cd20d3 artifact). Vercel log times EDT.

## Server-side verification (request trail matches the device report 1:1)

- 17:25:39 POST /oauth/gpt/token 200 (Galaxy sign-in token leg)
- 17:25:40 GET /api/control/status 200 -> G1 readout (fresh generated_at)
- 17:25:46 / 17:25:52 / 17:25:56 POST /api/control/goals 200 (G2 attempts;
  HTTP 200 with body status rejected: ambiguous_request:goal_1_has_no_tasks)
- 17:26:01 / 17:26:03 / 17:26:08 POST /api/control/goals 200 (G3 resubmits;
  the accepted G4 migration submission is in this series)
- 17:26:10 GET /api/control/approvals 200
- 17:26:37 POST .../decision 200 (G5 no-confirmation refusal)
- 17:27:09 POST .../decision 200 (G6 "Approve that." refusal)
- 17:27:34.16 POST .../decision 200 (G7 valid decision - matches
  decided_at 2026-08-25T21:27:34.323Z to the second)
- 17:28:17 / 17:28:36 POST .../decision 200 (G8 replay -> not_pending)
- 17:28:39 GET /api/control/goals/deb... , 17:28:41 GET /api/control/evidence,
  17:28:43 GET /api/control/status (closing reads)

SSOT end-state (read-model + hermes tick 202608252132): open approvals =
exactly the 3 pre-existing EXPIRED artifacts (apr-6cb23084 absent = decided);
goal deb529db decomposed; FAILED 0; jobs attempts 0, evidence_refs [];
no downstream execution. G4-G8 VERIFIED PASS.

## G1 adjudication: PASS (device report of FAIL was over-strict)

Authoritative requirement, spec 6.5 step 3 (docs/PRESTON_CONTROL_SPEC_v1.md
line 131): expected = sign-in -> getPrestonStatus card -> status summary;
"Proof: status JSON shows generated_at within the last minute; Vercel logs
show GET /api/control/status 200." BOTH proofs met (fresh JSON; GET 200 at
17:25:40). The spec imposes NO requirement on hermes tag, needs_attention,
waiting approvals, or blocked goals. The reported items are CORRECT
reporting of known state: hermes "unsafe_controls" is the deliberate-active
branch (read-model.ts:221-240 - reachable only when controls readable +
migration applied + read model readable + not halted; it means controls are
NOT in conservative simulation posture, i.e. the Golden-Seal
execution_enabled=true posture); the 3 waiting approvals + blocked goals are
pre-existing expired drill residue. failed 0 / dead-letter residue only.

## G2/G3 diagnosis: verdict (A) input formulation, NOT a regression

- ambiguous_request:goal_1_has_no_tasks is the composer's DESIGNED
  fail-closed rejection of task-less prose (proven live 2026-08-24 where the
  same tag preceded the accepted wording "Submit this goal: Create one task
  to document the golden baseline." -> goal 988123ca).
- The identical harmless-goal contract passed TWICE today: live MCP Test B
  ("Create one task to document the MCP acceptance drill marker
  MCPTESTB-20260825 in a simulation-only note." -> accepted + duplicate via
  request_id pc-mcp-testb-20260825) and the regression suites. No code
  change warranted or made.
- G3 note: dedup keys on request_id (normalizeRequestId mints a fresh key
  when absent), so a byte-identical resubmission WITHOUT the same
  request_id would create a new goal - the retest prompt pins request_id.

## Rerun scope

Spec 6.5/7 contains no full-sequence-repeat requirement after a step
failure. G1 adjudicated PASS (no rerun). G4-G8 verified PASS (no rerun).
Rerun = G2 + G3 only, with the canonical prompt pinned in the closing
section of this report.

## G2/G3 RETEST: PASS, VERIFIED (2026-08-25 ~22:27Z)

Device: first submission accepted, goal 311277a5-fa5b-4bbe-8795-aabe79762128,
approvals_required 0; exact resubmission (same request_id
pc-galaxy-g2-20260825) -> duplicate, SAME goal id, no second goal.
Server-side: Vercel shows POST /oauth/gpt/token 200 at 18:27:47.96 EDT then
exactly TWO POST /api/control/goals 200 (18:27:49.08, 18:27:52.68); the
read-model shows exactly ONE "Document the Galaxy acceptance drill marker
GALAXYG2-20260825..." goal row (decomposed), FAILED 0. Two calls, one row =
request_id idempotency proven on the Galaxy path.

## FINAL: Galaxy gate (spec 6.5) = PASS in full

G1 PASS (adjudicated per the spec's proof clause), G2/G3 PASS (retest),
G4-G8 PASS (verified server-side). Phase H prerequisite 2 met.
