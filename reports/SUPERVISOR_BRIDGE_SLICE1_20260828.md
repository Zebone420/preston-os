# ChatGPT Supervisor Bridge — Slice 1 — Implementation Evidence

Date: 2026-08-28. Branch: `feature/supervisor-bridge` (from master `f9747d7`).
NOT deployed, NOT promoted. Production untouched.

## Architecture implemented (exactly the committed design, slice 1)

Pull-based, read-model supervisor feed. Preston stays the authoritative
control plane/SSOT; ChatGPT observes and can act ONLY through the existing
gated tools. Two additions:

1. **`preston_poll_events` / `pollPrestonEvents`** — the 11th (deliberate)
   read-only operation on both transports (MCP tool + GPT Actions REST at
   `/api/control/events`). Same owner auth as every other op
   (`controlRoute` / auth.ts); zero writes on the poll path (test-pinned
   with a write-counting client).
2. **Idempotent submit-rejection records** — `prestonSubmitGoal`'s
   rejection paths now best-effort append ONE `GoalSubmitRejected` row to
   the existing `os_events` table (deterministic id `ev-submit-rej-<request
   id>`; replays dedupe as duplicates). Payload carries static error codes
   + request id ONLY — never the request text (which may be the very thing
   that was rejected, e.g. secret_in_request). A write failure never
   changes the rejection response; the feed reports
   `rejections_readable: false` instead of guessing.

No migration, no new table, no new write authority, no RLS change: events
derive from rows the owner surface already reads (read model over
`master_goals`/`goal_jobs`, `orchestration_approvals` annotations,
`system_controls`, `os_events` — the last already owner-read by
`readJobResultReports` and follow-up linkage).

## Event schema (`SupervisorEvent`)

`event_id` (deterministic: `sup:job:<id>:<status>:<ms>` / `sup:goal:…` /
`sup:ctl:…` / `sup:rej:<request_id>`), `kind`, `occurred_at` (the state's
own row timestamp), `goal_id`, `job_id`, `job_kind`, `prior_state` (set
only where the lifecycle guarantees it — terminal results come from the
run that owned `in_progress` → 'running'; otherwise null, never invented),
`new_state`, `provider_role`, `risk_class`, `requires_approval`,
`approval_id`, `failure_reason` (static codes, bounded), `evidence_refs`
(bounded), `correlation_id`.

**Vocabulary → source mapping:** queued (pending/ready), running
(in_progress), approval_required (awaiting_approval + approval_id),
completed, stopped (cancelled + controls owner_stop), failed,
timed_out (timeout-class failure_reason on failed/dead_lettered),
kind_not_eligible (dead_lettered + that reason — the finer kind wins),
dead_lettered (other terminal reasons), blocked (goal status), paused
(controls), task_kind_unresolved (rejection records with that code),
submit_rejected (other rejection codes, codes in failure_reason). Unknown
status → NO event + `unmapped_states` counter (fail closed, never an
invented kind).

## Dedupe strategy

Deterministic ids + opaque cursor `v1:<ms>:<event_id>` over ascending
(occurred_at, event_id). Repeating a cursor returns the byte-identical
page; advancing never re-emits; past-the-end returns an empty page with a
null cursor. A malformed cursor is `cursor_invalid` (an ERROR — never a
silent reset, which would replay history as duplicates). A retry that
re-enters a status later has a new updated_at → a NEW event id, so
transitions are never collapsed. Window honesty: the feed derives from
the bounded read model (20 most recent goals + jobs); the response's
`window` block states coverage (`goals_covered`, bucket states,
`rejections_readable`, `migration_applied`).

## Submit-rejection handling

All four rejection paths (request_required/too_long, secret_in_request,
composer errors incl. task_kind_unresolved and ambiguous_request:*,
persistence-confirm failures) record the idempotent event. Feed events
carry `goal_id: null` — the definitive "never entered the runtime" marker
distinguishing them from runtime failures.

## Files changed

- `src/lib/preston-control/supervisor-events.ts` (NEW — pure normalization,
  cursor, dedupe)
- `src/lib/preston-control/tools.ts` (`prestonPollEvents`,
  `recordSubmitRejection`, typed rejected/accepted union)
- `src/lib/preston-control/schemas.ts` (POLL_EVENTS_SHAPE + query variant)
- `src/lib/preston-control/server.ts` (11th MCP tool, read-only hints)
- `src/lib/preston-control/openapi.ts` (11th REST op, ≤300-char description)
- `src/app/api/control/events/route.ts` (NEW — GET route via controlRoute)
- `src/lib/ai-os/types.ts` (EventType + 'GoalSubmitRejected', additive)
- Tests: `test/preston-control-supervisor.test.ts` (NEW, 17 tests);
  op-count pins updated 10→11 in `preston-control-bridge-acceptance` and
  `preston-control-gpt` (deliberate surface addition).

## Tests and validation

| Check | Result |
|---|---|
| New supervisor suite (normalization for every vocabulary kind, provenance, deterministic ids, cursor idempotency/no-duplicates, invalid-cursor error, e2e queued→running→completed via the tool, kind_not_eligible mapping, rejection durability+idempotency+no-request-text, approval_required visible with approvals rows untouched, ZERO writes on poll) | **17/17 PASS** |
| Control-surface + composer suites (13 files incl. gpt/audit/route/auth/bridge-acceptance with the 11-op pins) | **176/176 PASS** (after pin updates) |
| `tsc --noEmit` / `eslint` (changed dirs) / `build:os-runtime` | PASS / PASS / PASS |
| Full Vitest suite (129 files, full log captured) | **1,764 pass + 1 expected fail**; only failures = the two known environmental bash-scanner timeouts in `worktree-prep.test.ts` (identical to the promoted baseline; +17 = exactly the new supervisor pins) |

## End-to-end STAGING proof procedure (to run AFTER owner-gated deploy)

Prereq (owner-gated, NOT done): merge/promote this branch so the staging
Vercel app serves the new op; ChatGPT staging connector re-imports the
OpenAPI (11 ops).

1. **Benign GREEN goal:** submit "Audit the repository." via
   preston_submit_goal. Poll `pollPrestonEvents` (no cursor) → `queued`
   event for the new job; store next_cursor. Trigger one staging tick;
   poll with the cursor DURING the run → `running`; after completion →
   `completed` with prior_state 'running' and evidence refs. Each event
   appears exactly once across the advancing cursors.
2. **Approval-gated goal:** submit "Fix the deploy script for the
   dashboard." After the next tick parks it, poll → `approval_required`
   with the approval_id; verify via preston_list_approvals that the
   approval is still pending (no bypass); DENY it afterward.
3. **Submit rejection:** submit "Zorble the frobnicator." → rejected
   synchronously; poll → `task_kind_unresolved` with goal_id null and
   `window.rejections_readable: true` (this also live-proves the os_events
   RLS write/read for the owner surface — if unwritable/unreadable the
   response says so honestly; record it).
4. **Dedupe:** repeat the same cursor twice → identical pages; advance to
   the end → empty page; re-poll → still empty.
5. **No write authority:** confirm the op is absent from the consequential
   list in the imported schema and that repeated polling changes nothing
   (re-read a job before/after: identical).

## Deferred (later slices, per design note)

- Runtime-side event emission at claim time (would need host repin) — the
  snapshot feed already surfaces `running` while a run is live.
- Owner push notifications to phone (Telegram Stage 2 / outbound provider)
  — explicitly owner-gated; not added.
- `blocked`-goal detail enrichment and event-sourced prior_state.

## Confirmations

No production deploy; no migration; no secret writes; no RLS/policy
change; no force push; no external service activation; no customer
messaging; no payments; no destructive actions; no unrestricted
execution; no allowed-path expansion; H-6 untouched and honored; ChatGPT
gained ZERO write authority (one read-only op; recovery still flows
natural-language → composer → risk/policy → approvals → runtime).
