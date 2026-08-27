# Power-Station Foundation - Staging Acceptance Matrix + Owner Gates

Companion to reports/MASTER_GOAL_FOUNDATION_BASELINE_20260827.md and the
final report. Sections 18/19 of the master goal.

## A. Staging acceptance matrix G1-G15

Legend: LOCAL-PROVEN = proven by the committed test suite on this build
(evidence = test file); STAGING = requires the owner-gated staging
deployment/drill; the exact drill command is given.

```text
G1  baseline reconciliation                      PASS (LOCAL-PROVEN)
    reports/MASTER_GOAL_FOUNDATION_BASELINE_20260827.md

G2  provider-free idle performance               PASS (LOCAL-PROVEN) +
    no material regression                       STAGING re-measure
    - structural: capability-isolation.test.ts (idle tick touches zero
      capability/artifact/ledger tables; C1 read set unchanged)
    - staging: compare orchestrate_once idle duration_ms before/after
      deploy (baseline: C1 fast path, 60s timer)

G3  ordinary documentation job unchanged         STAGING
    submit "Create one task to document <marker>." -> real claude
    completion, structured block, no artifact ops while gate off

G4  worker creates real file; artifact persists  STAGING (needs Gate C+D)
    beyond worktree cleanup
    set ORCH_ARTIFACTS_ENABLED=true; run an edit-kind goal; expect
    artifact:<id> evidence refs + artifacts row + object in bucket
    after the worktree is gone

G5  Preston Control retrieves artifact safely    STAGING (after G4)
    ChatGPT: preston_get_artifact <id> -> metadata + short-lived signed
    URL; downloaded bytes hash == recorded sha256

G6  unknown capability fails closed              PASS (LOCAL-PROVEN)
    capability-spine.test.ts (terminal, zero DB touches); STAGING spot:
    capability-dryrun with a hand-edited request is not exposed - the
    registry pin test is the evidence

G7  dry-run side effect requires policy/approval PASS (LOCAL-PROVEN) +
    STAGING: capability-dryrun --scenario gated -> terminal
    approval_required, ledger row refused

G8  duplicate execution prevented                PASS (LOCAL-PROVEN) +
    STAGING: capability-dryrun --scenario duplicate --key <k> ->
    same_row true, one ledger row, one adapter execution

G9  terminal failure does not retry              PASS (LOCAL-PROVEN)
    capability-spine + existing fast-track outcome tests; STAGING:
    --scenario terminal -> row failed, attempt_count 1

G10 retryable failure retries per policy         PASS (LOCAL-PROVEN)
    row returns to authorized; durable 3-attempt cap then refused

G11 uncertain outcome does not blind-retry       PASS (LOCAL-PROVEN)
    --scenario uncertain twice -> awaiting_reconciliation, 1 execution

G12 reconciliation settles uncertain             PASS (LOCAL-PROVEN)
    --scenario reconcile --key <k> -> row succeeded, one-time CAS

G13 executor failure does not affect normal job  PASS (LOCAL-PROVEN)
    capability code is unreachable from the tick path (isolation pins);
    STAGING corroboration = G3 run with dryrun env unset

G14 artifact-storage failure -> artifact_unrecorded  PASS (LOCAL-PROVEN)
    artifact-platform.test.ts (job success stands; condition surfaces
    in evidence + ArtifactRecorded event + attention notifier)

G15 secret scanners zero findings                PASS (run at commit;
    pre-commit scanners + owner-side scan)
```

Production promotion (Gate E) requires the STAGING rows above to be
drilled live and recorded with goal/job/side-effect ids.

## B. Owner gates (exact, bounded)

### Gate A - Hetzner build host
See docs/PRESTON_BUILD_HOST_FOUNDATION_v1.md section 10 (full packet).
Phrase: `OWNER AUTHORIZES GATE A: provision preston-build`

### Gate B - GitHub deploy key / push authority (build host)
```text
repository        Zebone420/preston-os (exact)
branch pattern    worker/** only (push); read for all
scope             deploy key, no admin, no protected-branch bypass
protected         master + release/* remain owner-only
revocation        delete the deploy key in GitHub settings
phrase            OWNER AUTHORIZES GATE B: install the preston-build
                  deploy key as specified
```
Not needed for anything in this goal; required before workers push.

### Gate C - Supabase Storage bucket
```text
bucket            artifacts (private) - per environment, staging first
privacy           no public access; owner + runtime identity via
                  storage RLS policies:
                    policy sel: bucket_id='artifacts' and
                      (public.is_owner() or public.is_runtime_service())
                      for select on storage.objects
                    policy ins: same predicate for insert
                    (no update/delete policy - immutable objects)
retention         retention_state column governs; physical deletion is
                  a future owner action
rollback          delete bucket (empty) + rollback_0027
phrase            OWNER AUTHORIZES ARTIFACT STORAGE: staging bucket +
                  migration 0027
```

### Gate D - migrations 0026 + 0027 (staging)
```text
files             supabase/migrations/0026_side_effect_ledger.sql
                  supabase/migrations/0027_artifacts.sql
tables            side_effects (new), artifacts (new) - nothing altered
RLS               owner + runtime service; anon revoked; no delete
functions         none; no SECURITY DEFINER added
indexes           unique idempotency_key / object_path + status/job
rollback          reports/p2_evidence/rollback/rollback_0026/0027
phrase            OWNER AUTHORIZES GATE D: apply migrations 0026 and
                  0027 to staging
```

### Gate E - production promotion
Only after G2-G12 staging rows are drilled live. Standard packet:
source SHA (this build's final SHA), destination = prod web + host +
migrations 0026/0027 + prod bucket, env changes limited to the two ORCH_*
gates the owner chooses to enable, smoke = FTP-style real job + one
capability-dryrun, rollback = redeploy prior SHA + env unset (tables/
bucket may stay - additive and dormant).

## C. Environment names introduced (values never in repo/chat)

```text
ORCH_ARTIFACTS_ENABLED           artifact persistence gate (host)
ORCH_CAPABILITY_DRYRUN_ENABLED   dry-run drill command gate (host)
ORCH_OWNER_IDENTITY              approval-binding owner email (host)
PRESTON_PROVIDER_<P>_TOKEN_FILE  future provider credential file paths
```
