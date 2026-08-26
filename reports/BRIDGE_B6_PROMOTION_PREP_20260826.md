# Bridge B6 production promotion prep (2026-08-26)

Goal: make the production promotion boring and owner-controlled. Promotion
happens ONLY after B5 staging acceptance passes and the owner rules.

## Exact commits (feature/preston-control, on top of prod 994b7fd)

| Commit | Content |
|---|---|
| b805e9d | docs: bridge architecture audit |
| 6c3774d | P0.1 hermes snapshot vs live summary disambiguation + hermes-loop recorded logging |
| 82c9d15 | B1 per-job read (preston_get_job / getPrestonJob) |
| 5e5ee03 | B2 readable result summaries (driver emitter + adapter excerpt + executor report) |
| 934974b | B3 owner-confirmed goal cancellation |
| f59e9e0 | B4 linked goal continuation |
| 379f768 | bridge acceptance coverage + orchestrate-once containment pin update |
| (this)  | docs: contracts + P0 baseline + B5 plan + B6 prep |

## Diff summary

- `lib/preston-control/*`: 3 new tools/operations (get_job, cancel_goal,
  follow_up_goal) + status snapshot_counts; shared-layer only, both
  transports; 2 new route files + 1 (jobs) = 3 new /api/control routes.
- `lib/ai-os`: EventType +3 (JobResultRecorded, GoalCancelRequested,
  GoalLinked); driver emits result events post-terminal-CAS and surfaces
  append failures; real adapters expose result_excerpt; real-executor
  attaches report (excerpt + touched files); dispatcher hermes-loop logs
  orchestration_recorded. NO change to: approval/decide/clear-gate paths,
  execution gates (all 8 layers), risk policy, composer prohibitions,
  eligible kinds, contracts, system_controls handling, leases/fencing.
- Tests: +5 files (~+40 cases) + parity/containment pin updates.

## Test results (this workstation, 2026-08-26)

- vitest: 1552 total = 1548 pass + 1 expected fail + 2 known-env timeouts
  (worktree-prep full-tree bash scans, 120s wall on Windows; compensated by
  the pre-commit scanners running 0/0 on every commit above) + orchestrate-
  once pin updated and green. Focused suites all green.
- tsc 0 errors; eslint 0 warnings; next build clean (all routes dynamic);
  os-runtime build clean + dispatcher startup proven.
- Secret scan + RED boundary scan: 0/0 on every commit.

## Confirmations

- Migration required: NO (os_events reused; no schema/RLS/policy change).
- Secret/env change required: NO (no new env names anywhere).
- New identities: NONE. New services: NONE. New polling: NONE.
- GPT editor: schema RE-IMPORT required to expose the 3 new operations
  (owner action; server enforcement live regardless; re-check aip callback).
- Host runtime rebuild at the promoted SHA required for B2 result emission
  (same standing procedure as any runtime deploy; app-only promotion is safe
  but leaves result_reports empty).

## Owner-only actions (in order)

1. `git push` (H-6; one command, from the repo).
2. Staging: promote preview to staging alias; rebuild staging host runtime;
   run B5 (agent drives the drill through the staging connector + browser
   where permitted; owner runs the two G8-handshake phrases + any step the
   prod/staging classifier reserves).
3. Rule on B6: "OWNER AUTHORIZES: promote bridge build <sha> to production"
   -> fast-forward master -> preston-os-prod auto-deploys.
4. Prod host runtime rebuild at the promoted SHA (B2 emission).
5. Prod GPT editor schema re-import + aip callback check.

## Production smoke plan (post-promotion, agent-drivable except classifier-
reserved steps)

1. GET /api/control/openapi.json -> 9 operations, prod origin URLs.
2. status/mcp 401 fail-closed; PRM 200 (unchanged posture checks).
3. preston_status via prod MCP -> snapshot_counts present, summary sane.
4. preston_get_job on a known historical prod job -> projected, empty
   result_reports (expected until first post-rebuild completion).
5. Harmless single-task goal -> next tick -> get_job shows a real
   result_report (repeat of staging G2 in prod, one goal of residue).
6. Cancel drill on that fresh goal's FOLLOW-UP (G4/G6/G7 compressed).
7. Verify hermes_loop log line carries orchestration_recorded:true.

## Rollback

- App: redeploy previous prod deployment (994b7fd known-good) - removed
  tools vanish from both surfaces fail-closed (MCP discovers live; GPT
  unknown ops 404). No data rollback needed: all new writes are append-only
  os_events rows or legal status transitions.
- Host: rebuild at 994b7fd (stops result emission; readers degrade to empty).
- Global kill unchanged: PRESTON_CONTROL_ENABLED=false + disable clients A'/B'.

## Readiness impact

Bridge capability coverage (handoff section 8): 7/8 full + notify-by-read
after B6; remaining: push notification channel (separate RED gate) and Codex
live enablement (owner env gate, zero code). The owner copy/paste loop is
eliminated for GREEN/YELLOW work in eligible kinds once B6 lands.
