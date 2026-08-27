# Power-Station Staging Seal + Production Promotion Packet

Date: 2026-08-27 (activation session). Staging activation executed under:
"OWNER AUTHORIZES POWER STATION STAGING ACTIVATION" (steps 4-5 agent;
steps 2-3 agent under the follow-up owner authorization; step 1 owner).

## A. POWER STATION STAGING ACCEPTANCE - ALL PASS

```text
G3  PASS  ordinary documentation job unchanged
          goal 7a528014-2ba5-4eef-8cd2-5f7b8264c9f5
          job 2f95bfb3-41a2-4e32-8a7b-cc7044e08d1d
          run ...:39844237-5bef-4c81-92be-82d1b05841bf
          timer pickup <=60s, ONE tick, 97.1s wall, executed:true,
          child env = PATH/HOME/LANG only, artifact ops = 0 (gate off)

G4  PASS  worker real file -> artifact persists beyond worktree cleanup
          goal 694bf97f-d445-4187-9329-1b85ffda0585
          job a0494b1f-ce9f-44bb-a512-e087ab576a35
          run ...:acf504cd-e663-4873-9660-8865b8887f59
          artifact_persist condition:ok persisted:1 rejected:0 failed:0
          artifact art-980051c4d76b5849409147a1efb8b9a8
          sha256 b25dd6a9...694f56 (64-hex recorded), 758 bytes
          object goal/<goal>/job/<job>/run/<run>/apps__dashboard__docs__
          PS_G4_ARTIFACT_DRILL.md; worktree wt-a0494b1f REMOVED (proven)

G5  PASS  Preston Control retrieves artifact safely
          live MCP preston_get_artifact (staging connector, ChatGPT):
          found:true, name/sha256/size/goal_id EXACTLY match the SSOT
          row, retrieval:ok, signed URL minted TTL 300s (never printed).
          Reconnect ran the full OAuth chain against the new build.

G7  PASS  gated dry-run side effect requires approval
          se-789461c3112d0fb29298ba5374d21ebe -> terminal
          approval_required; ledger row refused; 0 adapter executions

G8  PASS  duplicate execution prevented
          se-b370b3b694d9ff481746792f8b051c94: first executed once,
          second "replayed ... (no re-execution)", same_row:true

G9  PASS  terminal failure does not retry
          se-57ef96383c0bbd34f6a079a09f53709e -> failed, attempt 1

G10 PASS  retryable failure follows existing policy
          se-7f6c7295ab89b83245c703142b950897 -> requeued authorized

G11 PASS  uncertain parks without blind retry
          se-5bb4b36c47886ef1612c660179ed8552: uncertain, replay ->
          awaiting_reconciliation, executions stayed 1

G12 PASS  reconciliation settles the ORIGINAL side effect
          same row reconciled:true -> succeeded; post-reconcile replay
          returns stored success without execution; second reconcile
          impossible (one-time CAS proven locally)
```

Corroborating live checks: unknown-kind intake fails closed (composer
rejected `create a file...` as task_kind_unresolved); provider-free
overhead zero (artifact ops count 0 pre-gate; ledger untouched on
normal ticks); worker secret isolation live (child_env_keys); Hermes
observe-only ticking + snapshot bucket advancing (202608270408); status
at 04:09Z: failed 0, dead_lettered 0 (NO new dead letters), 9 completed
goals, residue = 1 parked goal + 6 expired-undecided approvals
(pre-existing backlog, unchanged).

## B. Defect found + fixed during acceptance (failure policy section 8)

Live finding (goal cee1f143 first G4 attempt): `git status --porcelain`
collapses a NEW untracked directory to `dir/`, so artifact persistence
received a directory entry and rightly rejected it (path_segment_
invalid) - the created file was never persisted. Also surfaced: the
worker's path-confinement contract held perfectly on the earlier
mis-scoped drill (goal 0bfc9d78 - refused repo-root docs/, zero edits,
honest STOPPED report). FIX 8cf140e: status runs with `-uall` (per-file
enumeration; enforcement unchanged-or-stricter) + regression pin.
No test, RLS, approval gate, idempotency, or fail-closed behavior was
weakened.

## C. Staging state at seal

```text
web alias   preston-os-staging.vercel.app @ cc06b7f
            (C7Bb4w2w6...; health 200, 10 ops incl getPrestonArtifact,
             status/mcp/artifact 401 fail-closed)
host        preston-agent-staging @ 8cf140e (runtime rebuilt), timer 60s
            worker env adds: ORCH_BASE_COMMIT=8cf140e...,
            ORCH_CAPABILITY_DRYRUN_ENABLED=true,
            ORCH_OWNER_IDENTITY=info@preston.nyc,
            ORCH_ARTIFACTS_ENABLED=true
            (alias vs host delta = the -uall runtime fix + docs; the
             web tier contains no changed code path - parity restored
             at promotion, both at the promoted SHA)
Supabase    bucket `artifacts` private + 3 storage.objects policies;
            migrations 0026 + 0027 applied; verification: RLS true/true,
            9 policies, authenticated S/I/U only, anon zero, no delete
production  UNTOUCHED (web+host b3c0003; DB at 0025; no bucket)
master      UNTOUCHED (b3c0003)
```

## D. Full regression at 8cf140e (workstation, seal time)

```text
vitest (full, loaded)   1662 pass + 1 xfail; 4 fails ALL inside
                        test/worktree-prep.test.ts (documented
                        machine-class bash timeouts, vary 2-5,
                        run concurrently with builds)
vitest minus that file  121/121 files, 1633 pass + 1 xfail, ZERO fails
tsc                     0 errors
eslint                  clean
next build              clean (all routes dynamic)
os-runtime build        clean
secret + RED scanners   0 / 0 (every commit; pre-commit hook enforced)
```

staging stable / no unrelated regression / production untouched /
master untouched: CONFIRMED.

## E. PRODUCTION PROMOTION PREFLIGHT (section 10)

```text
source feature SHA     branch tip at ruling (8cf140e + seal docs commit)
proposed master        fast-forward b3c0003 -> tip (CLEAN FF verified:
                       branch is built directly on b3c0003; no force)
current production     web+host b3c0003; DB 0025; no bucket
migration 0026 impact  NEW side_effects table only; additive; dormant
migration 0027 impact  NEW artifacts table only; additive; dormant
storage                prod bucket `artifacts` (private) + the same 3
                       storage.objects policies (prod project
                       hiqsymsiwonmvrbbqhhe)
env/config adds        prod /etc/preston/worker.env:
                         ORCH_BASE_COMMIT=<promoted tip>
                         ORCH_ARTIFACTS_ENABLED=true
                         ORCH_CAPABILITY_DRYRUN_ENABLED=true (drill
                           gate; may be removed after smoke)
                         ORCH_OWNER_IDENTITY=info@preston.nyc
                       NO Vercel env change; NO timer change
build-host impact      none (Gate A remains future)
Preston Control ops    9 -> 10 (getPrestonArtifact, read-only,
                       non-consequential); MCP connector needs
                       Actions Refresh; prod GPT needs schema re-import
                       (+ aip-callback check after any publish)
OpenAPI                one added GET path; everything else unchanged
RLS                    additive only (new tables + bucket policies);
                       nothing existing altered
expected downtime      none (atomic alias deploy; oneshot ticks)
smoke plan             section 13 of the activation master prompt:
                       health/status/auth-401s; doc goal real run;
                       artifact goal + preston_get_artifact readback;
                       capability-dryrun success/gated/duplicate/
                       uncertain/reconcile; provider-free tick timing;
                       no new dead letters; Hermes observe-only
rollback SHA           b3c0003 (web redeploy + host checkout + repin;
                       env lines removed)
DB rollback            reports/p2_evidence/rollback/rollback_0026/0027
                       (tables additive+dormant; may also stay)
storage rollback       delete prod bucket (empty) + drop 3 policies
```

## F. Owner authorization (exact; nothing runs without it)

```text
OWNER AUTHORIZES POWER STATION PRODUCTION ACTIVATION:
1. create the private `artifacts` bucket + the 3 storage.objects
   policies in PRODUCTION Supabase (hiqsymsiwonmvrbbqhhe)
2. apply migrations 0026 and 0027 to PRODUCTION + verification queries
3. fast-forward master to the feature branch tip (no force) so prod
   web auto-deploys
4. rebuild the prod host runtime at the promoted SHA and set the four
   worker.env lines listed in the packet
5. run the production smoke plan and report results
```

Steps 1-2 and 3 (the push) are owner-run unless you direct agent
execution as on staging; steps 4-5 the agent runs via the prod SSH
path on this same authorization.
