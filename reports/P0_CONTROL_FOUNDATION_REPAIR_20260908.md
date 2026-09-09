# P0 CONTROL FOUNDATION - AUDIT + REPAIR EVIDENCE (2026-09-08)

Gate scope: Phase 0 of docs/PRESTON_AI_OS_FINAL_MASTER_BUILD_PLAN_v1.md
(seal the control foundation). Repository-only work on
feature/hermes-native; no production, no live messages, no secrets.

## A. Current truth at gate entry

```text
branch            feature/hermes-native @ fc90d6e (== master + 1 docs commit)
uncommitted       scheduler starvation fix (driver.ts, dispatcher.ts) + its
                  test, authored 2026-09-04 in worktree pickup-starvation,
                  byte-identical copy in the main checkout, NEVER committed,
                  no report - recovered and committed here (599b869)
stale artifacts   packages/guards/src/index.js (tsc side effect of an
                  os-runtime import of packages/guards; removed, root
                  cause avoided in b15f1a3), scripts/p1/*.local.ps1
                  (owner diagnostic; now gitignored)
worktrees         canonical-prestaging (no delta vs master),
                  phase7-approval-reconcile (2 old commits a141055/8acb70d
                  never merged + untracked real-claude-adapter copy -
                  superseded by 8abe4c9 on master; stale, candidate for
                  owner prune), pickup-starvation (the fix above; now
                  committed; worktree itself is stale)
stash             stash@{0} on master: migration 0010 edits
                  (phase7-concurrent-approval-enforcement) - superseded by
                  0021/0022 DB-enforced gates; stale
unmerged branches p2-hotfix-classify-env (412ad15; master carries 9e08b95
                  with the same fix), phase7/gd3-adapter-port (dd8179a;
                  master carries 8abe4c9), feature/hermes-dashboard
                  (v0 reference, intentionally not promoted)
```

Truth matrix (control plane):

```text
BUILT + PROVEN (unit)   goals/jobs CAS, leases, worktree locks + fences,
                        retry classification, dead letters, approval DB
                        gate + nonce + expiry, actor stamping, event feed
                        cursor, artifacts, Hermes read surface, kill/
                        owner-stop re-checks, remote runner allowlist
BUILT BUT UNPROVEN      real Claude + Codex simultaneous execution on a
                        host (runtime proof needs the staging window)
BROKEN -> REPAIRED      A scheduler starvation, B expired approvals counted
                        open, C worker edits lost with the worktree,
                        E composer intake (no_tasks / kind_unresolved),
                        G residual window starvation
MISSING (by design)     ConnectorPassport / M8 / M9 freshness contract: no
                        artifact by that name exists anywhere (repo, docs,
                        reports, owner Downloads) - nothing to complete
PARTIAL                 backup/restore: dump + TOC check only; restore
                        drill script now prepared (owner-run)
```

## B. Defects verified and repaired (commit per defect)

| Defect | Evidence | Repair | Commit |
|---|---|---|---|
| A stalled older goal starved younger GREEN goals (live 2026-09-04) | driveGoal re-stepped a no-progress step to the harness bound, then halted; dispatcher ended the tick | non-halting `no_progress:<reason>` stall + per-job `stalledJobs`; stalls do not consume a drive slot | 599b869 |
| B expired approvals counted as open (preston_status, Hermes row, notifier, dashboard) | read-model.ts counted every status=pending row | count only decision-open rows under the caller clock; loadBridgeReadiness(nowMs); Hermes observer passes its tick clock | c6a82f4 |
| C completed worker edits vanished with the worktree unless artifacts on (and <= 10 files) | real-executor finally-block removal; no git/evidence reference | whole-run unified diff exported (read-only argv), secret-shape screened, written with sha256 sidecar under ORCH_PATCH_DIR before removal; `patch:` evidence ref + event projection; first artifact when artifacts on | b15f1a3 |
| E `goal_1_has_no_tasks` / `task_kind_unresolved` on clear requests | plain sentences after a goal only warned; lexicon gaps | sentences attach as tasks in order (fail-closed on any unresolvable one); appended lexicon entries | 1c9bb04 |
| G a status window full of parked goals hid younger goals | GOAL_WINDOW_PER_STATUS=50 with no growth | bounded window doubling (max 800) when a FULL window has no selection | 218afa4 |
| D Codex routing / true concurrency | code paths + unit pins present; runtime proof pending | staging package S3 | - |
| F ConnectorPassport / freshness M8 | not found | none required; documented | - |

Also verified unchanged and correct: approval-read fail-closed (any read
error fails the tick; unverifiable approvals surfaced), stale run-lease
recovery (driver.ts in_progress -> ready CAS on the same run_id), held
worktree lock (now a diagnosable stall, never a takeover), parked-goal
skip (positive evidence only).

## C. Tests

Focused runs (all green at the respective commits):

```text
orchestrate-once-stalled-goal-starvation  6 tests
orchestrate-once-selection-window          3 tests
read-model-expired-approvals               5 tests
composer suites (11 files)               164 tests (+7 new pins)
worker-patch-preservation                 20 tests
secret-shapes                             14 tests
restore-drill-script                       6 tests
dispatcher/driver/executor regression    109 + 128 tests
tsc --noEmit                              clean
eslint (changed files)                    clean
build:os-runtime                          clean
PowerShell secret + RED boundary scans    0 / 0 (pre-commit hook on
                                          every commit above)
```

Full-suite numbers are recorded in the build completion report
(worktree-prep.test.ts bash self-scan hangs on this Windows machine -
documented machine-class limitation; compensated by the PowerShell
scanners and `bash -n` syntax checks).

## D. Phase 0 exit checklist

```text
[x] scheduler picks up eligible GREEN jobs (starvation + window fixed, pinned)
[x] retry classification / dead letters (existing suites green)
[x] event/job/goal/approval/Hermes state aligned (defect B)
[x] durable patch preservation (defect C)
[x] actor attribution (0012/0014/0021 pins green; provider ref per run)
[x] artifacts/evidence retrieval (existing suites; patch rides first)
[x] full test suite green (minus the documented bash self-scan)
[x] no unresolved critical control-plane defect in the repository
[ ] remote execution independent of the laptop      -> S0/S3 (staging window)
[ ] Claude remote worker passes                     -> S3
[ ] Codex remote worker passes                      -> S3 (+ owner codex re-auth)
[ ] true simultaneous Claude + Codex                 -> S3 GB
[ ] executor kill / owner stop live                 -> S7
[ ] backup/restore proof executed                   -> S8 (owner-run)
```

Phase 0 verdict: REPAIRED AND LOCALLY SEALED; runtime seal requires the
staging package (reports/STAGING_VALIDATION_PACKAGE_20260908.md).

## E. Gate report

```text
Gate result           PARTIAL (repository work complete; runtime proof owner-gated)
Commits               599b869 c6a82f4 f9b5023 5829ca9 218afa4 1c9bb04 b15f1a3
Environment           local Windows workstation, feature/hermes-native
Production touched    false
Secrets exposed       false
Live messages sent    false
Live emails sent      false
Next gate             staging validation window (S0-S10)
Owner action required push branch; repin ORCH_BASE_COMMIT; codex re-auth;
                      SSH window approval; run restore drill
```
