# Phase 5J - Synthetic Drill Packet (consolidated drill record + owner replay)

OWNER-RUN replay instructions, plus a factual record of what this phase
actually did LOCALLY (in this worktree/host, no staging DB touched, nothing
committed). Every claim below was independently re-verified against the
worktree at `/srv/worktrees/wt-5j-orchestration` and the companion drill
worktree at `/srv/worktrees/wt-5j-doc-drill-001` before being written down -
where the original phase plan described an artifact that turned out not to
exist under the name expected, section (a) says so explicitly rather than
asserting it.

## (a) What was ACTUALLY EXECUTED locally in this phase

1. **Worktree preparation drill** - `scripts/worktree_prepare.sh` was
   exercised for real: `/srv/worktrees/wt-5j-doc-drill-001` exists, checked
   out on branch `job/5j-doc-drill-001`, cut from base commit
   `f4fd2bce30ea3c6f4ce02b5a791ee5b4568d1201` (`docs(5): staging simulation,
   control/recovery drills, final job drill packets`) - confirmed via
   `git worktree list` and `git rev-parse` inside that worktree. This
   matches the script's own preconditions: it refuses a dirty canonical
   checkout, refuses an existing target path, and validates the job-id/
   branch/commit shapes before calling `git worktree add`.
2. **Documentation deliverable staged (uncommitted)** -
   `docs/PHASE_5_REMOTE_LIVE_STAGING_ARCHITECTURE.md` exists in the
   `wt-5j-doc-drill-001` worktree, `git status --short` shows it as `A`
   (staged, added, NOT committed); 241 lines after independent-review
   corrections. It is a DESCRIPTIVE, staging-baseline document (its own
   header: "records what is verifiably built and deployed as of this
   commit... authorizes nothing, changes nothing, grants no new
   capability"). An independent internal reviewer (Codex-reviewer stand-in)
   first returned REQUEST-CHANGES with four findings (one critical
   honesty-labeling defect, one completeness gap, one wrong migration
   citation, one stale cardinality claim); all four were corrected and the
   reviewer re-verified each fix and returned APPROVE with no remaining
   findings — a complete find -> fix -> re-verify review cycle.
3. **Secret scan** - `scripts/secret_scan.sh`, run against the
   `wt-5j-orchestration` worktree in this session, reported
   `== secret scan: 0 finding(s) ==` (exit 0).
4. **Red-boundary scan** - `scripts/red_boundary_scan.sh`, run the same way,
   reported `== RED boundary scan: 0 finding(s) ==` (exit 0).
5. **Test coverage of the intake -> ... -> halt flow** - the dedicated
   end-to-end harness `apps/dashboard/test/synthetic-drill.test.ts` (added
   after this packet's first draft; 14 ordered tests over one shared
   in-memory table store) walks the complete drill: ChatGPT intake ->
   idempotent replay -> enqueue -> queue visibility -> Hermes observe-only
   routing decision (all four `route:*` reasons; zero job/lease writes) ->
   simulated worker cycle (queued -> leased -> checkpointed, `executed:false`)
   -> envelope validation (plus production/push/reviewer/traversal
   rejections) -> worktree plan (argv-only, reviewer read-only) ->
   owner_stop/kill/cancel halts -> approval_state stays `pending_owner`
   throughout. Additional unit-level coverage lives in FOUR further test
   files added/expanded in this phase:
   - `apps/dashboard/test/chatgpt-route.test.ts` (328 lines) - intake and
     idempotent replay (`processChatGptIntake`'s duplicate-key path, the
     `chatgpt-route.test.ts` "happy path + idempotency" describe block).
   - `apps/dashboard/test/envelope.test.ts` (318 lines) - the `JobEnvelope`
     contract (`validateJobEnvelope`'s fail-closed invariants).
   - `apps/dashboard/test/hermes-routing.test.ts` (358 lines) - Hermes
     observe-only routing recommendation (`classifyTask`/`routingReasons`
     wired through `runHermesObserveOnce`).
   - `apps/dashboard/test/worktree-prep.test.ts` (279 lines) - the
     worktree-plan step (`worktreePreparePlan`/`validateWorktreePath`/
     `validateBaseRef`).
   Running these four files together in this session:
   `npx vitest run test/chatgpt-route.test.ts test/envelope.test.ts
   test/hermes-routing.test.ts test/worktree-prep.test.ts` ->
   **4 test files passed, 99 tests passed**.
   Enqueue/replay, simulated-worker, and halt/pause behavior for THIS same
   phase's control-plane additions (`kill`, `cancelJob`) are covered in the
   MODIFIED `apps/dashboard/test/controlplane.test.ts` (+132 lines this
   phase - new `describe` blocks: "owner controls" kill sub-cases, "cancelJob
   (Phase 5J)") and `apps/dashboard/test/orchestrator.test.ts` (+24/-8 lines
   this phase). Running the FULL suite after the post-audit fix batch -
   `npx vitest run` from `apps/dashboard` - produced **35 test files passed,
   504 tests passed**, zero failures, in this worktree.
6. Nothing in this list touched the live staging Supabase project, sent any
   message, or wrote to any business table. All of it ran locally against
   this worktree's filesystem and an in-memory/fake `RuntimeClient`
   (vitest's own test doubles) - never a real network call.

## (b) What was SIMULATED (in-memory, not the live staging Supabase)

- Every one of the 99 (and, in the wider suite, 486) passing tests above
  runs against an in-process fake `RuntimeClient`/`AuditSink` (the same
  test-double idiom `controlplane.test.ts`'s `deps()` and
  `chatgpt-route.test.ts`'s `fakeDeps()` use) - no network call, no Postgres
  connection, no RLS policy evaluation, and no real `system_controls`/
  `os_jobs`/`orchestration_decisions` row is ever created by running these
  tests. "Passing" here proves the PURE logic (validators, decision
  functions, planners) behaves as specified against a chosen set of inputs -
  it does not by itself prove the live staging schema, RLS policies, or
  migration 0008's columns (not yet applied - see below) behave identically
  under a real Supabase connection.
- Migration `supabase/migrations/0008_phase5j_orchestration_envelope.sql`
  (the `os_jobs` envelope columns backing `envelope.ts`) is, per its own
  header comment, "FILES ONLY; NOT applied by the AI; staging-only; owner
  applies later at an explicit gate" - `validateJobEnvelope`'s invariants
  have been exercised only against the pure TS type in these tests, never
  against the live staging schema (this exact gap is also called out as an
  open precondition in `reports/PHASE_5J_PROMOTION_CRITERIA_PACKET.md`
  section 1).
- The worktree-prepare "drill" in (a)(1)/(a)(2) exercised the REAL
  `scripts/worktree_prepare.sh` against the REAL local git repository (not a
  simulation of the script) - but it ran on this development host, not on
  `preston-agent-staging`, and produced no `os_jobs`/envelope row anywhere.

## (c) What is OWNER-RUN / EXTERNAL-INTEGRATION PENDING

- Real DB submission via `/api/os/command` or `/api/os/chatgpt` against the
  live staging Supabase project - not performed in this phase. See
  `reports/PHASE_5J_CHATGPT_CONNECTOR_PACKET.md` section 9 for the exact
  owner-run curl sequence once the owner has set the required env vars on
  the staging host.
- Live Hermes timer observation of a real job on staging (the `hermes_loop`
  systemd cadence actually firing against a queued job and writing a real
  `orchestration_decisions` row with `route:*` reasons) - not performed in
  this phase. See `reports/PHASE_5J_HERMES_VERIFICATION_PACKET.md` for the
  full read-only verification query set once a live job exists.
- Actual Claude/Codex external invocation against a staging job worktree
  (an owner literally running `claude`/opening Codex in a terminal against
  `/srv/worktrees/wt-<job-id>` on `preston-agent-staging`) - not performed in
  this phase; see `reports/PHASE_5J_AGENT_INVOCATION_PACKET.md`.
- Commit of the doc deliverable staged in `wt-5j-doc-drill-001`
  (`docs/PHASE_5_REMOTE_LIVE_STAGING_ARCHITECTURE.md`) - it remains staged
  and uncommitted as of this packet; see the approval request in (e).
- Migration 0008 has not been applied to staging (confirmed by its own
  header comment - see (b)).

## (d) Owner replay steps against live staging

1. Confirm the staging deploy is at or past this commit (repeat
   `reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md` section 2).
2. Repeat the worktree-prepare drill FOR REAL on `preston-agent-staging`
   under `/srv/worktrees/` using `scripts/worktree_prepare.sh` with a fresh
   job id (never reuse `5j-doc-drill-001` - the script refuses an existing
   target path by design). Capture the script's own PASS summary block
   (`path`, `branch`, `base_branch`, `base_commit`).
3. Run the full test suite on the staging host the same way this packet's
   (a)(5) ran it locally: `cd apps/dashboard && npx vitest run` - expect the
   same "all test files passed" outcome (486 tests as of this commit; a
   different total on a later commit is expected and fine, a red run is
   not).
4. Run `scripts/secret_scan.sh` and `scripts/red_boundary_scan.sh` on the
   staging host's checkout at the SAME commit being promoted - expect
   `0 finding(s)` from both, exactly as reproduced locally in (a)(3)/(a)(4).
5. Submit one real ChatGPT-connector proposal and one real staging job
   enqueue, following
   `reports/PHASE_5J_CHATGPT_CONNECTOR_PACKET.md` section 9 end to end.
6. Let the worker and Hermes timers fire and run the FULL query set in
   `reports/PHASE_5J_HERMES_VERIFICATION_PACKET.md` section 3 plus the
   evidence-chain queries in
   `reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md` section 5.
7. Only once all of the above are PASS, follow
   `reports/PHASE_5J_AGENT_INVOCATION_PACKET.md` to run one real, owner-
   invoked Claude implementer + Codex reviewer cycle against the FRESH
   staging worktree from step 2 - never the local `wt-5j-doc-drill-001`
   worktree, which was a local-only doc drill.
8. Record every result using
   `docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md`'s structure, exactly as the
   5F/5I/5J reboot-recovery packets already do.

## (e) Approval request block

**What the owner is being asked to approve:** committing the Phase 5J
orchestration branch's changes (the `wt-5j-orchestration` worktree's working
tree - `apps/dashboard/src/app/api/os/chatgpt/`, `apps/dashboard/src/app/api/
os/jobs/`, `apps/dashboard/src/lib/ai-os/envelope.ts`, the `kill`/`cancelJob`
control-plane additions, the four new test files plus the modified
`controlplane.test.ts`/`orchestrator.test.ts`, `scripts/worktree_prepare.sh`,
`scripts/secret_scan.sh`, `scripts/red_boundary_scan.sh`, and migration file
`supabase/migrations/0008_phase5j_orchestration_envelope.sql` - FILES ONLY,
not applied), AND separately the doc deliverable staged in the
`wt-5j-doc-drill-001` worktree
(`docs/PHASE_5_REMOTE_LIVE_STAGING_ARCHITECTURE.md`). This request covers
COMMITTING CODE/DOCS ONLY - it does not request or imply approval of
anything RED (no migration is applied, no env var is set, no flag is
flipped, by approving these commits).

Exact git commands the OWNER would run (representative; the owner should
review `git status`/`git diff` in each worktree first and adjust paths/
messages as needed):

    # In /srv/worktrees/wt-5j-orchestration:
    cd /srv/worktrees/wt-5j-orchestration
    git status --short
    git add apps/dashboard/src/app/api/os/chatgpt \
            apps/dashboard/src/app/api/os/jobs \
            apps/dashboard/src/lib/ai-os/envelope.ts \
            apps/dashboard/src/app/api/os/control/route.ts \
            apps/dashboard/src/lib/ai-os/controlplane.ts \
            apps/dashboard/src/lib/ai-os/hermes.ts \
            apps/dashboard/src/lib/ai-os/orchestrator.ts \
            apps/dashboard/src/lib/ai-os/staging-sim.ts \
            apps/dashboard/src/lib/ai-os/store.ts \
            apps/dashboard/src/lib/ai-os/worktree.ts \
            apps/dashboard/src/proxy.ts \
            apps/dashboard/test/chatgpt-route.test.ts \
            apps/dashboard/test/envelope.test.ts \
            apps/dashboard/test/hermes-routing.test.ts \
            apps/dashboard/test/worktree-prep.test.ts \
            apps/dashboard/test/controlplane.test.ts \
            apps/dashboard/test/orchestrator.test.ts \
            githooks/pre-commit scripts/README.md scripts/worktree_prepare.sh \
            scripts/secret_scan.sh scripts/red_boundary_scan.sh \
            supabase/migrations/0008_phase5j_orchestration_envelope.sql \
            reports/PHASE_5J_PROMOTION_CRITERIA_PACKET.md \
            reports/PHASE_5J_REBOOT_RECOVERY_PACKET.md \
            reports/PHASE_5J_CHATGPT_CONNECTOR_PACKET.md \
            reports/PHASE_5J_AGENT_INVOCATION_PACKET.md \
            reports/PHASE_5J_HERMES_VERIFICATION_PACKET.md \
            reports/PHASE_5J_SYNTHETIC_DRILL_PACKET.md \
            reports/PHASE_5J_CONTROL_ROLLBACK_PACKET.md
    git commit -m "feat(5j): chatgpt connector, orchestration envelope, kill/cancel, hermes routing, owner packets"

    # In /srv/worktrees/wt-5j-doc-drill-001 (separate commit, separate worktree):
    cd /srv/worktrees/wt-5j-doc-drill-001
    git status --short
    git commit -m "docs(5j): verified remote-live staging architecture baseline"
    # (the file is already staged/added in this worktree; only the commit
    # itself remains, per section (a)(2))

**Rollback:**

    # Discard the doc-drill worktree entirely (owner-run, from the
    # canonical repo) if the owner decides NOT to commit it:
    git -C /srv/preston-os worktree remove /srv/worktrees/wt-5j-doc-drill-001
    git -C /srv/preston-os branch -D job/5j-doc-drill-001   # only if the
                                                             # branch itself
                                                             # should also go

    # Discard uncommitted changes in wt-5j-orchestration if the owner
    # decides NOT to commit them (run git status first; this is
    # destructive to anything not yet committed):
    git -C /srv/worktrees/wt-5j-orchestration checkout -- <path>   # one file
    git -C /srv/worktrees/wt-5j-orchestration restore --staged --worktree <path>  # equivalent, newer git

No rollback here touches `system_controls`, applies or reverts a migration,
or affects the staging host - both rollback paths operate purely on local
git state in these two worktrees.
