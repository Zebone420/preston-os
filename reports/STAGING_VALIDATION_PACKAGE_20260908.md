# STAGING VALIDATION PACKAGE (prepared 2026-09-08)

Status: PREPARED, NOT EXECUTED. Every step below runs on the staging
runtime host (preston-agent-staging) or against the staging Supabase
project only. Host SSH steps are owner-run or agent-run inside an
explicit owner-approved window (memory rule). Nothing here touches
production. No live email/SMS/calendar/Drive writes exist in this build.

Source under test: feature/hermes-native at implementation revision
0726b1d (including P0 repair series 599b869..b15f1a3). The
deployed orchestrator executes dist/, so step S0 (rebuild) is mandatory
before any runtime proof.

## S0. Deploy the repair series to the staging host

```text
ssh <staging>  (root, nested ProxyCommand via the n8n jump; see memory)
cd /srv/preston-os && git fetch origin && git checkout <sha>   # owner pushes first
cd apps/dashboard && npm ci && npm run build:os-runtime
sudo -u preston-worker mkdir -p /srv/worktrees/patches           # default ORCH_PATCH_DIR
grep -n '^ORCH_' /etc/preston/worker.env | cut -d= -f1            # names only, never values
```

Expected env names present: ORCH_BASE_COMMIT (repin to <sha>),
ORCH_ALLOWED_PATHS, ORCH_WORKTREES_ROOT=/srv/worktrees,
ORCH_PATCH_DIR (optional; must stay under the unit's ReadWritePaths:
/srv/worktrees or /var/lib/preston/worker), ORCH_REAL_CLAUDE_ENABLED,
ORCH_REAL_CODEX_ENABLED, ORCH_MAX_PARALLEL_JOBS=2, ORCH_MAX_GOALS_PER_TICK=2.

## S1. Scheduler pickup + stalled-goal non-starvation

1. Submit goal G1 (GREEN, one code task) through preston_submit_goal.
2. Park G1 artificially: hold its worktree lock row (repository_worktrees
   status in_use, lease 1h ahead) or leave a prior in_progress lease.
3. Submit goal G2 (GREEN, one documentation task) AFTER G1.
4. `systemctl start preston-orchestrator.service`; read
   /var/log/preston/orchestrator.log.

Expected: one `orchestrate_once` line for G1 with reason
`no_progress:<...>` and `stalledJobs:[{job_id, reason:'lock_refused:held_by_another'}]`,
then a line for G2 with reason `completed` (sim) or a claimed lease
(real), exit 0, `goalsDriven: 2`. G1 iteration advanced by exactly 1.

## S2. Selection-window growth

Seed >50 parked goals in one status is not practical live; the unit
suite pins it (orchestrate-once-selection-window.test.ts). Live check:
`grep -c windowGrown /var/log/preston/orchestrator.log` stays 0 on a
normal queue (no regression in read volume).

## S3. Worker routing: Claude and Codex, then true concurrency

1. Goal GC: `Task 1: implement a note file under apps/dashboard/docs using claude.`
2. Goal GX: `Task 1: implement a note file under apps/dashboard/docs using codex.`
3. Goal GB (concurrency): two tasks with no dependency, one `using claude`
   one `using codex`, ORCH_MAX_PARALLEL_JOBS=2.

Expected per job: evidence refs `real-provider:job:<id>:run:<run>:role:<claude|codex>`,
`real-audit:...:paths_ok:touched:N`, and NEW `patch:job:<id>:run:<run>:sha256:<16hex>`;
`ls /srv/worktrees/patches/<jobId>/` shows `<run>.patch` + `.sha256`;
`sha256sum` of the patch matches the sidecar and the JobResultRecorded
event's `patch_sha256`. For GB: two distinct run_ids, two distinct
`wt-<job>` paths in the log, two overlapping `real_executor_result`
lines, zero `lock_refused`, zero dead letters. Codex requires the
host codex CLI to be authenticated (owner action; see H-3 below).

## S4. Artifact persistence

With ORCH_ARTIFACTS_ENABLED=true on the host: the GC/GX runs show
`artifact_persist` with `persisted >= 2` and the FIRST artifact is
`patch/<run>.patch` (type diff). preston_get_artifact returns it with a
matching sha256 and a 300s signed URL (never printed).

## S5. Event / status / approval truth

1. Create an approval-gated job (RED task, e.g. `Task 1: migrate ...`).
2. Let its approval expire undecided (TTL 15 min) or seed expires_at in
   the past on staging.
3. `preston_status` and the Hermes od-orchstatus row.

Expected: `open_approvals` excludes the expired row; no
`approval_attention` reason; the dashboard lists the row labeled
`(expired)`; preston_status attention has no "approval(s) waiting" line
for it. A live (unexpired) approval still counts 1.

## S6. Composer intake

Submit through ChatGPT/MCP: `Audit the scheduler. Then summarize what you
found in a report.` and `Set up the wizard branch.`

Expected: both accepted; the first composes 2 tasks (audit -> documentation,
t2 depends on t1) with warning `tasks_derived_from_prose:1`; the second
composes one code task. `Zorble the frobnicator.` still rejects with
`task_kind_unresolved`. No supervisor `submit_rejected` events for the
accepted forms.

## S7. Kill / owner stop

While a real run is in flight: `preston_cancel` or set owner_stop=true.

Expected: the executor's post-run control re-check reports
`owner_stop_or_paused`, the run's job is requeued (in_progress -> ready)
under its own run_id, the tick exits 75, the next tick with owner_stop
cleared resumes; process tree SIGKILL evidence in the adapter log when
the timeout path is exercised (set ORCH_REAL_TIMEOUT_MS low on a drill).

## S8. Backup + restore proof (owner-run)

1. `scripts/p0/p0_bootstrap_backup.ps1 -SkipBootstrap` against STAGING
   (adjust -ProdUser guard: the script refuses the staging ref by design,
   so run pg_dump manually for staging or extend the packet).
2. `scripts/p0/p0_restore_drill.ps1 -DumpFile <dump> -TargetHost localhost -TargetUser postgres`
   against a local PostgreSQL.

Expected: evidence file `reports/p0_evidence/restore_drill_evidence_*.txt`
with verdict PASS and restored_public_tables >= toc_tables.

## S9. ConnectorPassport freshness / M9 readiness

1. Owner verifies the staging migration ledger, applies any unapplied
   migrations 0028-0035 in numeric order, then applies 0036 to STAGING only;
   verify `connector_passports` and `soft_launch_assessments` have RLS.
2. Run `connector-passport.test.ts`,
   `connector-passport-migration-0036.test.ts`, and
   `soft-launch-readiness.test.ts` at the deployed revision.
3. Exercise each enabled sandbox capability through the executor and verify
   a missing, stale, wrong-environment, wrong-mode, revoked, or scope-missing
   passport refuses before the side-effect ledger or adapter is touched.
4. Persist an M9 assessment only after S1-S8 evidence is linked. Until S3,
   S7, and S8 have live evidence, the expected status is
   `REPOSITORY_READY`, `staging_ready=false`, `production_ready=false`.
5. Re-run the Hermes token-store drill (rename store -> zero data and zero
   notifications; restore -> live) and read each owner view through the
   `preston_owner_view` / `/api/control/owner-view` read surface.

Expected: every connector refusal has a static reason; no ledger row or
provider call occurs on refusal; every assessment carries evidence refs;
the database constraint makes `production_ready=true` impossible.

## S10. Draft-only behavior (Phase 3)

`capability-dryrun`-style drills for gmail.message.draft / calendar /
drive sandbox providers: every run returns provider_state
`sandbox_only`, one ledger row per idempotency key, replay returns the
stored outcome, `gmail.message.send` refuses with `owner_gate_not_opened`
even with a valid approval.

## Owner actions required before S3/S4

- H-1 push the branch (H-6 rule: pushes are owner-run).
- H-2 repin ORCH_BASE_COMMIT on the host.
- H-3 codex CLI re-auth on the runtime host(s) (pre-existing owner action).
- H-4 approve the SSH window if the agent is to run the host steps.
