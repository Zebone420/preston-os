# Bridge B5 staging acceptance - evidence (2026-08-26, session 1)

Build under test: 8fb5fdb (B1-B4 + P0.1) promoted to the staging alias
preston-os-staging.vercel.app (deployment dGDkPUYR4W54vwbQwpVigyDkLiUx,
Production env of project preston-os-staging, promoted from the Ready branch
preview after owner push). Production project untouched.

## Deployment smoke (agent, alias)

- GET /api/control/openapi.json -> 200, NINE operations incl. getPrestonJob,
  cancelPrestonGoal (x-openai-isConsequential true), followUpPrestonGoal
  (false); alias-origin OAuth URLs; no staging->prod refs.
- GET /api/control/status (no token) -> {"ok":false,"status":"missing_token"}
  fail-closed.

## MCP connector catalogue refresh (operational learning)

ChatGPT dev-mode MCP connectors CACHE the tool catalogue. After a server-side
tool addition the working recipe is: connector settings -> Information ->
**Refresh** ("Actions refreshed") -> **Reconnect** -> NEW chat. Reconnect
alone does NOT re-discover; pre-refresh chats keep the old 6-tool list.
(MCP has no <=300-char description limit; that limit is GPT-Actions-only.)

## Drill results (staging MCP connector, chat "Report raw tool result")

| Gate | Result | Evidence |
|---|---|---|
| G1 per-job read | PASS | submit pc-b5-g1-20260826 -> goal 3931e43f-3a4f-4df0-8a4a-97c0bb54c8e5 job 62767a0d-2724-4d73-8618-1cd15cc2c210; preston_get_job -> found, projected job (no run_id leak), run{active:false}, approval null, result_reports [] with read_ok true |
| G4 cancel, no confirmation | PASS | goal da910563-0835-49a8-bf64-3d1ae7a77696 (pc-b5-g4-20260826): error cancel_confirmation_required, decision_made false, restatement + required_confirmation "Cancel goal da910563-..." + instructions; goal stayed decomposed, no os_events row |
| G5 cancel, wrong id | PASS | owner_confirmation named the G1 goal id -> cancel_confirmation_id_mismatch, decision_made false, nothing changed |
| G8 follow-up | PASS | parent 3931e43f -> child 68e76dab-a6ab-407a-9cd4-98f7ba7d793b (pc-b5-g8-20260826), links_recorded 1, parent_status echoed; get_goal(child).parent_goal_id = parent; get_goal(parent).child_goal_ids = [child]; parent row byte-unchanged (updated_at identical) |
| G9 approval regression | PASS (refusal paths; parked per plan) | gated goal 5405e00d-e571-4903-a87a-49440956a28b job af4a09f7 requires_approval TRUE, apr-0249cb2102abbc03e90df2ac YELLOW migration; decide w/o confirmation -> owner_confirmation_required; wrong verb -> owner_confirmation_outcome_mismatch; both decision_made false, decided_at null, approval pending (expires 2026-08-27T05:38Z) |
| G10 idempotency | PASS | follow-up replay same request_id -> status duplicate, replayed true, SAME child/job ids, links_recorded 1 (converged, no duplicate link row) |
| G12 parity (server) | PASS (unit-pinned + live doc) | 9 MCP tools == 9 GPT ops (bridge-acceptance suite) + live openapi doc above. Live GPT-Actions retest deferred to the GPT editor re-import step |

## Pending gates + prerequisites

- G6/G7 (valid cancel + replay): needs the OWNER's exact phrase
  "Cancel goal da910563-0835-49a8-bf64-3d1ae7a77696" (G8-class boundary:
  the phrase is never agent-composed).
- G2/G3/G11 (readable real results + P0.2 residual): needs the STAGING host
  runtime rebuilt at 8fb5fdb, then fresh single-task goals incl. one
  audit-kind. OBSERVATION during the drill: G1/G4/G8 jobs remained `pending`
  for >10 minutes (05:27->05:38Z) - check
  `systemctl status preston-orchestrator.timer` while on the host; the
  routing-drill session (~03:50Z) had it ticking.
- GPT editor schema re-import (staging GPT) for the live GPT-surface parity
  check (optional pre-prod; server enforcement already live).

Residue so far: drill goals 3931e43f (+child 68e76dab), da910563 (cancel
target), 5405e00d (gated, approval expires 24h) - sim-only, documented.

## Addendum (05:46Z status read over the staging MCP surface)

1. P0.1 LIVE-CONFIRMED: preston_status now returns
   hermes.snapshot_counts {as_of_bucket:"202608260541", open_approvals:6,
   failed_jobs:0, dead_lettered_jobs:0} + snapshot_note, distinct from the
   live summary - the disambiguation renders exactly as designed on the
   deployed staging surface.
2. STAGING ORCHESTRATOR STALL ISOLATED: the hermes-observe timer is ALIVE
   (bucket advanced to 05:41Z), controls readable
   (execution_enabled/remote_runner_enabled true since 2026-08-09,
   hermes 'unsafe_controls' = the known deliberate-active branch), yet the
   B5 drill jobs stayed `pending` through 3+ expected orchestrator ticks
   (05:27 -> 05:46Z). The fault is specific to preston-orchestrator
   (timer inactive, or exiting 78/70 every tick). Diagnosis + the 8fb5fdb
   rebuild both need the host session (SSH blocked by the workstation's
   auto-mode permission classifier this session; owner boundary).
