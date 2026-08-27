# POWER STATION — PRODUCTION SEAL (2026-08-27)

## A. Final verdict

```text
POWER STATION — PRODUCTION SEALED / GOLDEN BASELINE
```

Activation executed under the owner's "COMPLETE PRODUCTION ACTIVATION
AND SEAL" master prompt; master push performed by the owner at the
designated gate; every other step agent-run and verified live.

## B. Source state

```text
promoted SHA        5f15afa2ecbcb0e6274ac33a5636a46aca5478d9
branch              feature/final-build-fast-track (tip == promoted SHA)
master              5f15afa (owner fast-forward b3c0003 -> 5f15afa,
                    clean ff proven pre-push; no force, no merge commit)
origin/master       5f15afa (GitHub-verified)
production web      5f15afa (Vercel preston-os-prod, Ready 32s,
                    auto-deploy from master)
production host     5f15afa (preston-agent-prod repo + rebuilt
                    os-runtime dist; ORCH_BASE_COMMIT repinned)
commit inspection   all 11 commits b3c0003..5f15afa are sealed
                    Power Station work; no Platform v1, no unrelated
                    refactor/cleanup/architecture change
```

## C. Production DB / storage state

```text
highest migration   0027 (0026 side_effects + 0027 artifacts applied
                    this activation; verification exact:
                    se_pol 3 / art_pol 3 / obj_pol 3 / rls_on 2 /
                    anon_grants 0 / delete_grants 0)
artifacts bucket    `artifacts` PRIVATE (created this activation;
                    0 policies at creation, 3 storage.objects policies
                    applied: sel/ins/upd, owner|runtime, bucket-scoped)
side-effect ledger  live; drill rows only (se-8c2bad58/a832699f/
                    bc958057/79a994bd/186ee2b3)
artifact metadata   live; 1 row (the seal drill artifact)
existing RLS        untouched (additive only; production data intact)
```

## D. Control surface (production)

```text
operation count     10 (was 9) on BOTH surfaces:
                    - OpenAPI/GPT Actions: getPrestonArtifact GET
                      /api/control/artifacts/{artifact_id}
                    - MCP: preston_get_artifact
artifact retrieval  read-only, non-consequential, art-[0-9a-f]{32}
                    only, signed URL TTL 300s, no bucket browsing
OAuth/auth          unchanged; live probes: /api/health 200,
                    status 401, /mcp 401, artifact route 401 (no
                    bearer); zero staging refs in the document
consequential ops   exactly decide + cancel (unchanged)
GPT                 schema re-imported from live prod openapi
                    (10 actions verified in editor), published
                    ("GPT Updated"); aip callback UNROTATED
                    (g-ab244b138bb1114d43be55d82a4fc8b76e261b73)
MCP connector       "Preston Control MCP - Prod": Actions refreshed
                    ("Actions refreshed" toast; URL preston-os-prod
                    .vercel.app/mcp)
```

## E. Production smoke evidence

```text
control API healthy      /api/health 200; openapi 10 ops
auth fail-closed         401 on status//mcp/artifact without bearer
first tick at new SHA    exit success, 2s, only known parked residue
                         (goal 5d25fa51) — provider-free path unchanged
unknown-kind intake      composer rejected "create a file ..." with
                         ambiguous_request:task_kind_unresolved:t1
                         (nothing created) — fail-closed live
worker confinement       child_env_keys PATH/HOME/LANG on the real run
gated capability         se-8c2bad58... -> terminal approval_required
duplicate prevention     se-a832699f...: 1 execution + "replayed ...
                         no re-execution", same_row true
terminal no-retry        se-bc958057... -> failed, attempt 1
retryable per policy     se-79a994bd... -> requeued authorized
UNCERTAIN no blind retry se-186ee2b3...: uncertain -> replay
                         awaiting_reconciliation (1 execution total)
reconciliation           same row reconciled:true -> succeeded; later
                         replay returns stored success, no execution
artifact persistence     goal fa9fd6ea / job 283091ef / run ...6be77fc5:
                         artifact_persist ok persisted:1 rejected:0
                         failed:0; 135s wall, one tick, executed:true
dead letters             live summary 3 = exactly the pre-existing
                         historical set (2 pre-B6 + 1 codex-auth);
                         NO new dead letters; failed jobs 0
                         (hermes snapshot shows 6 over its own wider
                         bounded window — the documented P0.1
                         snapshot-vs-summary semantics, not new rows)
Hermes                   observe-only, snapshot bucket fresh
                         (202608270453), approval count 0
approval semantics       unchanged (G8 handshake surfaces intact in
                         the deployed openapi; consequential ops
                         unchanged)
```

## F. ChatGPT production readback (live MCP, new chat, 2026-08-27
## 04:54:45Z)

```text
preston_status        environment production; failed 0;
                      dead_lettered 3 (historical); open approvals 0
preston_get_goal      fa9fd6ea... completed, 1 job
preston_get_job       283091ef... completed, executed:true,
                      files_changed ["apps/dashboard/docs/
                      PSP_SEAL_DRILL.md"], artifact ref
                      artifact:art-944da669fc0d736e3b585bf9de1a2327
preston_get_artifact  found:true; name matches; sha256
                      b912c4419c42fe681f39102d9530dfd8f81bba90594fb7
                      acf10bb912498fd30f EXACT match to the SSOT row;
                      571 bytes; retrieval ok; signed URL minted TTL
                      300s (never printed)
```

## G. Regression totals (promoted code)

```text
vitest (code tree, minus the env-limited file)  121 files / 1633 pass
                                                / 1 xfail / 0 fail
worktree-prep.test.ts                           documented machine-
                                                class bash timeouts
                                                (2-5 under load),
                                                unchanged, compensated
                                                by PowerShell scanners
structural/safety re-run at seal                7 files / 112 pass
tsc / eslint / next build / os-runtime build    all clean
secret scanner / RED boundary scanner           0 / 0 (re-run at seal)
```

(The full suite was verified at 8cf140e; 5f15afa differs only by the
docs-only seal commit.)

## H. Safety posture

```text
RLS                   unchanged or stricter (new tables + bucket
                      policies additive; nothing existing altered)
approvals             unchanged (G8 handshake, one-time decide,
                      DB-enforced gate all intact)
workers               confined (positive child-env allowlist proven
                      live; path allowlist apps/dashboard/ unchanged)
unknown kinds         fail closed (live composer rejection)
execution paths       no new unrestricted path (capability executor
                      reachable only via the env-gated drill command;
                      dry-run provider only; no external provider)
secrets               none exposed; scanners 0/0; signed URLs never
                      printed
```

## I. Dormant / owner-gated capabilities (built, intentionally inert)

```text
side-effect ledger + trusted executor   live schema; ONLY the
                                        preston.dryrun provider exists;
                                        no external provider/credential
capability drill command                gated by ORCH_CAPABILITY_
                                        DRYRUN_ENABLED (currently true
                                        on both hosts for drills; may
                                        be unset without effect)
credential broker                       interface only; no
                                        PRESTON_PROVIDER_* configured
Telegram notifications                  coded, inert (env unset)
build host (preston-build)              Gate A future
worker git/test execution               future gate (commit_sha null)
Gmail/Calendar/Airtable/Business V1     NOT started (by directive)
```

## J. Rollback anchor

```text
prior production SHA   b3c0003
application rollback   redeploy b3c0003 on preston-os-prod (Vercel
                       instant rollback) + host checkout b3c0003 +
                       ORCH_BASE_COMMIT repin + remove the 3 new env
                       lines
DB/storage rollback    reports/p2_evidence/rollback/rollback_0026 /
                       rollback_0027 (.sql.txt) + delete the (near-
                       empty) `artifacts` bucket + drop the 3
                       storage.objects policies — additive and dormant,
                       so rollback is optional even on app rollback
```

## Backlog (non-blocking, recorded only — no action this session)

- 3 historical prod dead letters + parked goal 5d25fa51: owner cleanup
- hermes snapshot-vs-summary window semantics could carry an
  explanatory label in status output
- staging alias at cc06b7f vs sealed 5f15afa (docs-only delta; optional
  re-promote for parity)
- seal-drill artifacts/goals retained as evidence (retention_state
  active)
- prod codex CLI re-auth (pre-existing owner action)

# ARCHITECTURE FREEZE

POWER STATION — PRODUCTION SEALED / GOLDEN BASELINE.
Power Station development STOPS at this baseline. Next session begins
(only on owner direction) with the PRESTON PLATFORMIZATION
ARCHITECTURE REVIEW — not implementation.
