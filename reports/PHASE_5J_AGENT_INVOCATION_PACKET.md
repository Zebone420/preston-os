# Phase 5J - Agent Invocation Packet (Claude implementer + Codex reviewer, owner-run)

OWNER-RUN / EXTERNAL-INTEGRATION PENDING. This packet documents HOW the owner
manually invokes a Claude Code implementer and a Codex reviewer against one
prepared job worktree on the staging host. It enables nothing by itself: no
autonomous server-side invocation exists in this codebase today, and none is
introduced by this document. `system_controls.remote_runner_enabled` stays
`false` throughout (verified default in
`apps/dashboard/src/lib/ai-os/controls.ts` - `DEFAULT_CONTROLS`), and
`apps/dashboard/src/lib/ai-os/runner.ts`'s `runPermitted()` requires
`remote_runner_enabled === true` AND the runtime not halted before a REAL run
would ever be permitted - with it `false`, no automated path can invoke
anything, agent or otherwise.

## 1. Preconditions

- The job's worktree has already been created per
  `reports/PHASE_5J_PROMOTION_CRITERIA_PACKET.md` and
  `scripts/worktree_prepare.sh` (owner-run only; refuses if the canonical
  repo is dirty, refuses if the target directory already exists, refuses a
  malformed job id/branch/commit shape - see script header comments). The
  script's own summary output on success reports `path`, `branch`,
  `base_branch`, `base_commit`, and explicitly `reviewer: read-only (no
  separate write worktree created)`.
- A `JobEnvelope` (`apps/dashboard/src/lib/ai-os/envelope.ts`) exists and
  passes `validateJobEnvelope` for this job, with `assigned_implementer:
  'claude'` and `assigned_reviewer: 'codex'` (the only two literal values the
  validator accepts - any other value is rejected outright, so there is no
  way to assign a third agent through this contract today).
- `execution`, `push`, `deploy` are `false` in the envelope (validator pins
  them to the literal `false`; any envelope violating this is rejected, not
  silently coerced).
- The owner has read `reports/PHASE_5J_CHATGPT_CONNECTOR_PACKET.md` /
  the staging simulation packets so the job's origin (proposal -> enqueue ->
  worktree-plan) is understood before any agent touches the tree.

## 2. Running the Claude implementer (OWNER-RUN)

1. `cd /srv/worktrees/wt-<job-id>` - the SAME path
   `scripts/worktree_prepare.sh` created (`WORKTREES_ROOT = /srv/worktrees/`
   per `apps/dashboard/src/lib/ai-os/worktree.ts`). Never operate from the
   canonical repo (`/srv/preston-os`) for job work - the whole point of the
   worktree isolation model (`worktree.ts` header comment: "Workers NEVER
   auto-push (owner-gated); no force ops; repo state is part of every
   checkpoint").
2. Confirm the worktree is on the expected job branch and commit before
   invoking anything:

       git status --short          # expect clean
       git rev-parse HEAD          # expect the base_commit the envelope names
       git branch --show-current   # expect job/<job-id>

3. Invoke Claude Code in that directory, giving it the job's envelope JSON
   as context (as a file the owner points it at, or pasted directly) plus an
   explicit, bounded instruction restating the envelope's own limits:
   `allowed_operations` only (from the fixed vocabulary in
   `envelope.ts`'s `ALLOWED_OPERATIONS`: `read_repo, edit_docs, edit_code,
   run_tests, run_lint, run_build, secret_scan, boundary_scan` - no shell/
   exec/network verb exists in that list), `prohibited_operations` include
   at minimum the required baseline (`push, deploy, production_access,
   secret_access, network_egress`), and `push`/`deploy` remain `false`. The
   owner should tell Claude explicitly, in the invocation prompt: "do not
   push, do not run `git push` or any deploy command, work only inside this
   worktree, stop and report if a step outside `allowed_operations` seems
   necessary."
4. Bounded scope: the envelope's `scope`/`objective`/`title` fields are the
   ONLY task description Claude should be given for this job - do not expand
   scope ad hoc mid-session without also updating the envelope and re-running
   `validateJobEnvelope`.
5. No push: `apps/dashboard/src/lib/ai-os/worktree.ts`'s
   `workerPushAllowed()` returns `false` unconditionally today - this is a
   hard-coded pin, not a runtime flag, so there is no configuration that
   makes an implementer's worktree push-capable under this codebase as it
   stands. The owner remains the only path by which any change leaves the
   worktree (via the owner's own separate `git push`/PR flow, entirely
   outside this packet).

## 3. Running the Codex reviewer READ-ONLY (OWNER-RUN)

1. The reviewer must never share a live/writable worktree with the
   implementer while work is in progress - `apps/dashboard/src/lib/ai-os/
   worktree.ts`'s `isConcurrentConflict()` models exactly this rule
   (`wt.agent !== agent && wt.status === 'in_use'` is a conflict), and
   `worktreePreparePlan()`'s last planned step is explicitly:
   `"reviewer (<reviewer>) is granted READ-ONLY access to this worktree; no
   separate write worktree is created for review"` - the plan does not
   create a second worktree for the reviewer.
2. Owner-run options, either is acceptable:
   - (a) Point Codex at the SAME `/srv/worktrees/wt-<job-id>` path in a
     strictly read-only invocation (no write tool access granted to Codex
     for that session), once the implementer's session has ended and the
     tree is not concurrently being written; or
   - (b) Make a read-only COPY first (e.g. `cp -r` to a scratch path, or a
     second `git worktree add --detach` at the SAME commit the implementer
     left the branch at) and point Codex at the copy, so there is no chance
     of a concurrent write regardless of session timing.
3. Codex's job is REVIEW ONLY: verify the implementer's diff against the
   envelope's `required_tests` / `required_evidence` and the
   `allowed_operations` boundary, and produce a verdict (section 4) - it must
   not edit, commit, or push anything in the worktree it is reviewing.
4. The same "no shell beyond what the envelope allows" instruction from
   section 2 step 3 applies to the reviewer invocation as well.

## 4. Handoff artifacts

Every invocation cycle for a job should leave behind these three artifacts,
in this order:

1. **Envelope JSON** - the `JobEnvelope` object itself
   (`apps/dashboard/src/lib/ai-os/envelope.ts`), which is the single contract
   both agents were given. Save the exact JSON the owner handed to Claude (and
   later Codex) alongside the job, e.g. `envelope.json` in the job's evidence
   folder - not committed into the job's own worktree branch unless the job's
   `allowed_operations` includes `edit_docs`/`edit_code` and the owner wants
   it tracked as part of the change.
2. **Checkpoint record(s)** - `job_checkpoints` rows written via
   `insertCheckpoint` (`apps/dashboard/src/lib/ai-os/store.ts`). Each
   checkpoint the owner records for this manual cycle should carry, at
   minimum, the same redacted shape `insertCheckpoint` already persists:
   `files_changed`, `tests_run`, `validation`, `blockers`, `owner_actions`,
   `next_action`, `rollback` (all passed through `redactSecrets` before
   storage - "Persist conclusions/evidence only, redacted - never raw
   secrets/reasoning", per the source comment). This is the SAME
   `job_checkpoints` table the automated worker path writes to
   (`RUNTIME_TABLES.checkpoints = 'job_checkpoints'`) - a manually-invoked
   agent cycle should produce evidence in the same shape, not a parallel
   ad hoc format.
3. **Review verdict file** - NOT YET a typed/validated artifact in this
   codebase (there is no `review_verdict` table, column, or TS type as of
   this commit - `job_checkpoints`/`orchestration_decisions`/`os_events` are
   the only append-only evidence surfaces that exist). Until a future gate
   defines one, the owner should have Codex produce a plain-text or Markdown
   verdict file (PASS/FAIL/CHANGES-REQUESTED, findings, and confirmation
   that no `prohibited_operations` were exercised) saved alongside the
   envelope JSON and checkpoint record for that job - not committed to the
   job branch, kept as owner-side evidence only (e.g. under a future
   evidence-binder entry, `docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md`'s
   structure already used by the other 5F/5I/5J drills).

## 5. What stays disabled regardless of this packet

- `system_controls.remote_runner_enabled = false` (default; unchanged by any
  action described here) means no code path in this repository can invoke
  Claude or Codex automatically today - `runner.ts`'s `runPermitted()` is
  the single gate, and it requires this flag `true` before a REAL run is
  even considered permitted. This packet's entire subject matter (owner
  types `claude`/opens Codex by hand, in a terminal, on the staging host) is
  the ONLY invocation path that exists while this flag is `false`.
- No route, script, or module in this codebase spawns a `claude` or `codex`
  process on the owner's behalf. Every invocation described in sections 2-3
  is a literal command the OWNER types.
- This packet, on its own, changes no code, applies no migration, and flips
  no flag. It is a procedure document only.

## 6. Rollback / stopping mid-cycle

- If an implementer or reviewer session needs to stop immediately: the owner
  simply ends the terminal session (Ctrl-C / closes the CLI) - there is no
  running server process to halt, since invocation is a foreground, owner-
  driven command, not a background service.
- If the worktree itself needs to be discarded: `git worktree remove
  /srv/worktrees/wt-<job-id>` (owner-run, from the canonical repo) followed
  by `git branch -D job/<job-id>` if the branch itself should also be
  discarded (only after confirming no work the owner wants to keep is on
  it - use `git log job/<job-id>` first).
- If a job in flight needs a cooperative stop signal recorded in the control
  plane (rather than just closing a terminal), use the per-job cancel path
  documented in `reports/PHASE_5J_CONTROL_ROLLBACK_PACKET.md` (`POST
  /api/os/jobs/cancel`) - this sets `cancel_requested=true` for the worker/
  dispatcher loop to observe; it does not itself terminate a foreground
  Claude/Codex CLI session the owner is running by hand.
