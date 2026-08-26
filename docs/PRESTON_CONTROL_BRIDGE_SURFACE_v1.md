# Preston Control Bridge Surface v1 (B1-B4)

Status: implemented on feature/preston-control (2026-08-26), staging-pending.
Baseline: extends the G8 Preston Control surface (6 tools) to 9 tools/operations.
Authority: `apps/dashboard/src/lib/preston-control/{schemas,tools,server,openapi}.ts`
is the single service layer; MCP (`/mcp`) and GPT Actions (`/api/control/*`)
are transports over it and cannot drift (shared shapes, parity-pinned tests).

## Tool <-> operation map

| MCP tool | GPT operationId | Kind | Consequential |
|---|---|---|---|
| preston_status | getPrestonStatus | read | no |
| preston_submit_goal | submitPrestonGoal | write, idempotent | no |
| preston_follow_up_goal (NEW B4) | followUpPrestonGoal | write, idempotent | no |
| preston_get_goal | getPrestonGoal | read | no |
| preston_get_job (NEW B1) | getPrestonJob | read | no |
| preston_list_approvals | listPrestonApprovals | read | no |
| preston_decide_approval | decidePrestonApproval | consequential write | yes |
| preston_cancel_goal (NEW B3) | cancelPrestonGoal | consequential write | yes |
| preston_get_evidence | getPrestonEvidence | read | no |

## B1 - per-job read contract

`preston_get_job { job_id: uuid }` returns:
- `job` - the standard projected job (allowlist projection, secret-screened;
  run_id/runtime ids deliberately not exposed on the projection).
- `run { active, lease_expires_at }` - liveness: a non-null run lease in the
  future means a runtime run currently owns the job. Progress resolution is
  PER ATTEMPT (one orchestrator tick, ~5 min); there is no intra-job stream
  by design (headless bounded CLI run).
- `approval` - restatement of the linked approval (never nonce/action_hash).
- `result_reports[]` - see B2. Empty until the host runtime runs the B2 build.
- Errors: `job_id_invalid | read_failed | not_found`.

## B2 - readable result summary contract

Emitter: `orchestration/driver.ts`, immediately after the run-owned terminal
CAS wins (sole writer, once per attempt). Append-only `os_events` row:
- id `ev-result-<job_id>-<attempt>` (deterministic, PK-idempotent on replay)
- type `JobResultRecorded`, correlation_id `result:job:<job_id>`
- payload: `goal_id, job_id, run_id, attempt, outcome, executed, mode
  (real|simulation), provider_role, summary (<=400), failure_reason,
  result_excerpt (<=2000, adapter-sanitized; claude CLI json `result` field
  when parseable, else raw sanitized text), files_changed (<=50, from the
  post-run worktree audit; EMPTY on a path violation - the output of a
  confinement-violating run is not surfaced), evidence_refs (<=10)`.
Safety: makeEnvelope key-redaction + insertEvent secret-payload rejection +
adapter value-level sanitizer + read-side safeText (defense in depth).
A failed append NEVER fails the job; it is surfaced in the drive reason as
`:result_event_unrecorded` (visible in the orchestrator tick log).
Requires the host runtime rebuilt at this commit; older hosts simply emit
nothing (readers treat absence as a normal empty state).

## B3 - cancellation contract

`preston_cancel_goal { goal_id, reason?, owner_confirmation? }`.
Server-enforced handshake identical in spirit to G8: the phrase must be
`Cancel goal <goal_id>` (case-insensitive, "goal" optional, trailing ./!
tolerated, EXACT id required). Anything else - including "cancel that" -
performs NOTHING and returns `restatement + required_confirmation +
instructions`.

Semantics by state:
- goal `proposed|decomposed|running|blocked`: cancellable. Non-terminal jobs
  (`pending|ready|assigned|in_progress|awaiting_review|awaiting_approval|failed`)
  CAS to `cancelled` (run lease cleared), then the goal CAS to `cancelled`.
- goal `cancelled`: idempotent no-op (`already_cancelled`, decision_made
  false, no writes, no duplicate audit).
- goal `completed|failed|dead_lettered`: refused (`goal_terminal`).
- jobs already `completed|cancelled|dead_lettered`: left untouched, counted.
- Lost CAS races: one re-read + retry, then reported (`cancel_partial`);
  re-running the same cancel converges.
HONEST LIMIT: cancellation prevents future orchestration ticks. It does NOT
kill an in-flight bounded attempt; that run's result is dropped by the
run-owned persistence CAS (the documented out-of-band-cancel path). A pending
approval on a cancelled job stays pending until its 24h TTL; it can no longer
gate anything (the job is terminal; the gate-clear RPC re-verifies scope).
Audit: append-only `GoalCancelRequested` os_events row `ev-cancel-<goal_id>`
(idempotent) with requested_by, reason, before-status, and counts.

## B4 - continuation contract

`preston_follow_up_goal { parent_goal_id, instruction, context?, priority?,
request_id? }`. The parent must exist (any status; its status is reported).
The instruction is submitted through the UNCHANGED composer path - normal
grammar ("Create one task to ..."), normal classification, normal approval
gates, normal request_id idempotency. NOTHING is inherited from the parent:
no permissions, no cleared gates, not even its text - only the parent UUID is
recorded, OUTSIDE the composed text, so parent wording can never alter the
child's classification. Terminal parents are never reopened.
Linkage: append-only `GoalLinked` os_events row `ev-goal-link-<child_goal_id>`
with correlation `link:parent:<parent_goal_id>` (deterministic; duplicate
replay converges). `preston_get_goal` reports `parent_goal_id` (child side)
and `child_goal_ids` (parent side, bounded 20).

## P0.1 - status telemetry disambiguation

`preston_status.hermes` now carries `snapshot_counts { as_of_bucket,
open_approvals, failed_jobs, dead_lettered_jobs }` parsed from the newest
`od-orchstatus-*` decision row: a HISTORICAL snapshot at that minute bucket
over the then-current bounded window. `summary.*` are LIVE per-read counts
over the current bounded recent-goals window (lower bounds, not global
totals). The two may legitimately disagree (stale bucket and/or window
drift); distinct names + `snapshot_note` prevent conflation. Absent counts
parse as null, never 0. The hermes-loop log line now includes
`orchestration_recorded` so a silently-failing status-row append is visible.

## Approval implications

- decide path (0021 RPC, one-time nonce, in-transaction audit): UNCHANGED.
- clear-gate path (0022 RPC): UNCHANGED.
- New consequential surface: cancel only, with its own exact-id handshake and
  `x-openai-isConsequential: true` / MCP `destructiveHint: true`.
- Follow-up and job read add no approval surface; follow-up creates approvals
  exactly as a new submit would.

## Failure taxonomy (new operations)

- Retryable: `read_failed`, `jobs_read_failed`, `cancel_partial` (idempotent
  re-run), `result_event_unrecorded` (runtime side).
- Non-retryable input: `*_invalid`, `not_found`, `parent_not_found`,
  `secret_in_reason`, `request_too_long`.
- Owner-gated: `cancel_confirmation_*` (needs the owner's exact phrase),
  everything behind decide.
- Policy-denied: composer rejections (unchanged).
- Terminal: `goal_terminal`, `already_cancelled` (benign).

## Deployment note

Vercel app deploy activates B1/B3/B4 and the P0.1 status fields. B2 result
EMISSION additionally requires the host runtime (preston-orchestrator)
rebuilt at this commit (`npm run build:os-runtime` at the pinned SHA);
until then result_reports read empty. GPT Actions needs an owner schema
re-import in the GPT editor to SEE the new operations (server enforcement is
live regardless; re-check the aip callback after any editor OAuth edit).
MCP discovers the new tools live - no re-import.
