# Hermes Supervisor Dashboard v0 - Slice Report (2026-08-31)

## A. Verdict

HERMES SUPERVISOR DASHBOARD v0: CODE COMPLETE, LOCALLY VALIDATED,
STAGING DEPLOYMENT BLOCKED ON OWNER PUSH (guard H-6 blocks outbound git
from agent shells; the branch is local-only until the owner pushes).

Production untouched. No env, migration, RLS, secret, host, or
worker-authority change is required: this slice is web code only.

## B. Repo state

- Branch: feature/hermes-dashboard (from master 10e54e0)
- HEAD: 9708da8
- origin/master: 10e54e0 (unchanged)
- Commits in this slice:
  - 58fe0f0 feat(hermes): read-only Preston Control adapter, view
    models, feed logic
  - 58c555b feat(hermes): supervisor dashboard v0 surfaces, event
    feed, notification center, nav
  - 9708da8 test(hermes): hard guardrails plus adapter, feed,
    view-model, route suites
- New files:
  - apps/dashboard/src/lib/hermes/{adapter,view-models,feed}.ts
  - apps/dashboard/src/app/hermes/page.tsx
  - apps/dashboard/src/app/hermes/event-feed.tsx
  - apps/dashboard/src/app/hermes/goals/[goal_id]/page.tsx
  - apps/dashboard/src/app/hermes/jobs/[job_id]/page.tsx
  - apps/dashboard/src/app/hermes/artifacts/[artifact_id]/page.tsx
  - apps/dashboard/src/app/api/hermes/events/route.ts
  - apps/dashboard/test/hermes-{guardrails,adapter,view-models,feed,
    events-route}.test.ts
- Modified: apps/dashboard/src/components/nav/nav-config.ts (Hermes
  nav link + non-nav detail routes)
- Pre-existing untracked files left untouched:
  packages/guards/src/index.js, scripts/p1/p1_diagnose.local.ps1

## C. Implemented surfaces

- Header/status: environment, posture, controls readability,
  execution/remote-runner/owner-stop/paused flags, hermes_mode, last
  refresh (generated_at), needs_attention list.
- Metric cards: goals / running / blocked / pending approvals /
  failed / dead-lettered. A metric whose underlying bucket read is not
  ok/empty renders UNKNOWN, never an invented zero.
- Goals: recent goals with status, created time, per-status job
  counts, pending-approval count, evidence availability; goal detail
  page with parent/child continuation links.
- Jobs: aggregate table (role, status, risk, attempts, failure
  summary); job detail page with run liveness, related approval
  (restated, display-only), per-attempt result reports incl.
  provider_model and duration_ms when the platform reports them
  (UNKNOWN otherwise - never inferred).
- Approvals: display-only pending panel (id, goal/job, action,
  reason, risk, environment, expiry, expired marker). NO approve, NO
  reject, NO cancel controls anywhere in Hermes.
- Event feed: preston_poll_events as the authoritative activity
  stream; 15s poll, bounded page drain, opaque cursor persisted in
  localStorage per environment; deterministic event-id dedup;
  same-millisecond ordering is server-authoritative (SB-1 fix relied
  on, not reimplemented); cursor_invalid surfaces a VISIBLE re-anchor
  state and is never rendered as an empty feed; re-anchored/first-load
  history is marked "history" (backfill) and never notified;
  submit_rejected (goal_id null) rendered distinctly from runtime
  failures; window coverage + unmapped_states shown as diagnostics.
- Evidence/artifacts: goal evidence via getPrestonEvidence; artifact
  metadata via getPrestonArtifact with the platform's short-lived
  signed URL (TTL 300s) rendered per request, never persisted; no
  storage credential exposure; no bucket browsing.
- Failures/attention: failed jobs, dead-lettered jobs (the two known
  historical dead letters stay visible), blocked count,
  needs_attention, unreadable-bucket warnings.
- Notification center: in-dashboard only, derived solely from
  supervisor events; classes: completed, failed, timed_out,
  dead_lettered, approval_required, submit_rejected. No external
  delivery (Telegram/SMS/email/push remain a later owner-gated slice).

## D. Data authority (operation per surface)

- Header/metrics/failures/dead-letters/needs_attention:
  getPrestonStatus
- Goal cards + goal detail: getPrestonStatus (recent list) +
  getPrestonGoal (per goal, bounded to 6)
- Jobs table: getPrestonGoal (job rows); job detail: getPrestonJob
- Approvals panel: listPrestonApprovals
- Event feed + notifications: pollPrestonEvents (via owner-gated
  GET /api/hermes/events)
- Evidence: getPrestonEvidence
- Artifacts: getPrestonArtifact

All calls go through apps/dashboard/src/lib/hermes/adapter.ts, which
delegates in-process to the sealed Preston Control service layer
(lib/preston-control/tools.ts) under the owner's RLS-bound session -
the same layer the MCP and GPT surfaces use. Hermes never queries SSOT
tables directly.

## E. Guardrails (pinned in test/hermes-guardrails.test.ts)

- No direct Claude/Codex calls: agent adapters, orchestration engine,
  runner, worker/hermes services, os-runtime are banned imports.
- No SSOT table access: .from('...'), .rpc(, .insert(, .upsert(,
  .delete( banned in all Hermes sources.
- No approval decisions / no cancellation / no goal submission:
  prestonDecideApproval, prestonCancelGoal, prestonSubmitGoal,
  prestonFollowUpGoal and the confirmation evaluators are banned
  names; the adapter's tools import is allowlisted to exactly the 7
  reads + ToolContext; adapter export surface pinned.
- No owner-confirmation phrase composition (literal banned).
- No bypass: only the adapter may reference preston-control modules;
  UI fetch() targets /api/hermes/* only, GET only; no <form>, no
  'use server', no process spawning.
- No second orchestration engine: nothing imported from the
  coordination/completion/driver tree (type-only client type import
  excepted).

## F. Tests and validation matrix (all run at 9708da8)

- Focused Hermes suites: 47 tests, 5 files - PASS
  (guardrails 14, adapter 7, view-models 12, feed 9+, route 5)
- Nav sync: main-nav.test.ts + nav-menu-route-sync.test.ts - PASS
- Full regression: 134 files; 1812 pass, 1 expected fail, 5 fails
  confined to worktree-prep.test.ts bash-ENOENT (documented
  Windows-only env limitation; compensated by owner-run scanners)
- tsc --noEmit: clean
- eslint: clean
- next build: PASS (all /hermes routes dynamic; proxy owner gate
  covers /hermes and /api/hermes by default matcher)
- secret scan: 0 findings; RED boundary scan: 0 findings

## G. Staging

NOT DEPLOYED YET (blocked on owner actions below). Planned flow,
identical to the supervisor-bridge slice:

1. Owner pushes feature/hermes-dashboard (H-6: owner terminal).
2. Promote the Vercel preview of 9708da8 to the preston-os-staging
   project Production target (alias preston-os-staging.vercel.app).
3. Verify: owner signs in, checks /hermes header + metrics vs
   preston_status, goals/jobs/approvals panels, live feed (LIVE
   badge, cursor persistence across reload, garbage-cursor re-anchor
   banner), evidence/artifact pages, the two historical dead letters
   visible, notification center on a fresh event.

Production: DO NOT promote. Hermes v0 is staging-only this slice.

## H. Remaining items / later slices

- Owner: push branch; then staging promotion + visual verification
  (agent can run the Vercel promotion + checks once pushed).
- Later slices (out of scope here): owner-gated external notification
  delivery; any Hermes action surfaces (would be new gates); business
  module integrations; docs/PRESTON_CHATGPT_SUPERVISOR_BRIDGE_DESIGN_
  v1.md line 1 still says "NOT implemented" - stale, worth a one-line
  docs correction in a docs pass.

Production touched: false. Secrets exposed: false. Live messages
sent: false. Live emails sent: false.
