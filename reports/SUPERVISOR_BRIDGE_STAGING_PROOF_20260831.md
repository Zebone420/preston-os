# Supervisor Bridge Staging Proof - 2026-08-31 (live, authenticated)

Connector: "Preston Supervisor Bridge - Staging Basic" (ChatGPT MCP,
User-Defined OAuth client c1680204-8846-44b0-aa34-e9af1545c4a1,
token_endpoint_auth_method=client_secret_basic, server
https://preston-os-staging.vercel.app/mcp). Fresh conversation
"List Connector Tools" (chat id 6a95e379-1940-83e9-81c0-3d39de0e6a0d).
Staging web = 36dbcc1 (Vercel deployment H1UHwst7sP66itPBPjHv7NGXzrUC).

## Phase 1 - Authenticated bridge proof (PASS)

- Tool catalogue enumerated live: exactly 11 tools, verbatim, including
  preston_poll_events (annotated read-only/non-consequential in
  MCP + OpenAPI).
- preston_status succeeded: environment "staging", posture "operating",
  controls readable, 10 recent goals, 7 pending approvals (incl. RED
  apr-cb04e953b2388e5961a2a360 - untouched), 0 failures, 0 dead letters,
  needs_attention intact.

## Phase 2 - Event feed proof (PASS)

- Initial poll (limit 5): ok:true, 5 events, deterministic ids
  (sup:job:<id>:<state>:<ms>, sup:goal:..., sup:rej:<request_id>),
  window {goals_covered:20, all states ok, controls_readable:true,
  rejections_readable:true, migration_applied:true}, unmapped_states:0.
- next_cursor v1:1787729797430:sup:job:1cc1f5c3-...:completed:1787729797430
  -> continuation returned 5 NEW events, ZERO overlap with page 1
  (event_id sets disjoint, verified).
- Same cursor repeated -> identical page (same 5 event_ids, same order,
  same next_cursor/window/unmapped_states; only top-level generated_at
  timestamp differs).
- cursor "garbage-cursor-123" -> {"ok":false,"error":"cursor_invalid"} -
  fail-closed, no silent reset.
- Unknown-state handling pinned by unmapped_states counter (0 in window).

## Phase 3 - End-to-end drill

- Positive: preston_submit_goal "Audit the repository."
  (request_id supbridge-e2e-20260831-1) -> accepted, goal
  cc84434a-2b17-40e9-967d-f3fea5abc97c, job
  0c87b3e5-556f-4569-a8eb-aad4e9d7dc06 (audit/GREEN/claude,
  requires_approval false). Feed: queued event
  sup:job:0c87b3e5-...:pending:1788208201673 at 20:30:01Z; running event
  sup:job:0c87b3e5-...:in_progress:1788208237505 at 20:30:37Z (leased by
  the staging worker in ~36s). Cursor advanced across the transition.
- Negative: multi-sentence prose (request_id supbridge-neg-20260831-1)
  -> rejected at submit; supervisor feed event
  sup:rej:supbridge-neg-20260831-1, kind submit_rejected, goal_id null,
  correlation_id submit:supbridge-neg-20260831-1, failure_reason
  "ambiguous_request:goal_1_has_no_tasks" (static codes only). The
  GoalSubmitRejected/runtime-failure distinction is PROVEN live.
- Terminal result: see addendum below.

## Phase 4 - Negative / fail-closed (PASS)

- Unauthenticated: /api/control/status 401; /api/control/events 401
  (also with ?cursor=garbage - auth precedes parsing); /mcp POST 401
  missing_token; /api/health 200 connected.
- Approval/cancel gates unchanged (server-enforced owner_confirmation
  handshake; nothing decided during the drill; the RED approval and 6
  other pending approvals left untouched).
- No direct Claude/Codex route exists on the surface: the 11-op catalogue
  is the entire control plane; the poll feed performs zero writes.
- Authority delta since master: none (slice-1 audit unchanged).

## Phase 5 - Repo / deployment

- Branch feature/supervisor-bridge, HEAD aef3507 (= 36dbcc1 + 2 evidence
  docs); origin/master f9747d7; diff = slice 1 + docs only; untracked:
  packages/guards/src/index.js, scripts/p1/p1_diagnose.local.ps1 (both
  untouched).
- Staging web serves 36dbcc1. Production untouched (master f9747d7 era).
- Production promotion requires CODE DEPLOYMENT ONLY: no env change, no
  migration, no RLS change, no secret change, no host restart/repin (the
  events feed is web-only; the runtime host does not serve it). NOTE for
  the prod ChatGPT surface: the prod MCP connector's stored OAuth secret
  is subject to the same GoTrue behavior seen on staging - if prod calls
  start failing invalid_credentials, the known-good repair is rotate the
  prod client secret + recreate the prod connector with
  client_secret_basic.

## Addendum - drill terminal state + defect SB-1 (found and fixed)

- Job 0c87b3e5 terminal: **completed**, attempts 1, executed true, exit-0
  result report, three evidence_refs (real:goal:...:attempt:1:completed:
  executed:true, real-audit:...paths_ok:clean, real-provider:...role:claude).
  Terminal supervisor event exists: sup:job:0c87b3e5-...:completed:
  1788208237505 with the same evidence_refs.
- **Defect SB-1 (drill-surfaced, real):** the oneshot worker stamps all
  writes of one cycle with a single nowIso, so running and completed for
  this job share updated_at 2026-08-31T20:30:37.505Z. The purely
  lexicographic same-ms cursor tie-break then hid the terminal event from
  the cursor advanced past the running event ('completed' < 'in_progress'):
  polling from the in_progress cursor returned an empty page while
  preston_get_job already showed completed. Verified live from the
  connector (no-cursor poll shows the event; cursor poll did not).
- **Fix (commit 3ea327c):** same-ms events order by lifecycle rank derived
  from the state token embedded in the deterministic event id; afterCursor
  compares (ms, rank, id). v1 cursors stay valid; replay/idempotency
  unchanged; 4 regression pins reproduce the live defect shape. Focused
  suites 47 pass; full suite minus worktree-prep 1737 pass + 1 expected
  fail; tsc/eslint clean.
- Residual gate: 3ea327c is LOCAL (owner pushes); staging still serves
  36dbcc1. Before promotion: push, promote the new preview to
  preston-os-staging, and re-run the one-poll cursor-boundary re-drill
  (poll from a running-event cursor after completion -> completed event
  visible).
