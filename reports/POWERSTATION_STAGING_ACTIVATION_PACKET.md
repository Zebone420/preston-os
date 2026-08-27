# Power-Station Staging Activation Packet (owner gate)

Feature SHA: cf96346be73fd1a302b8f1810237e789b386fdd7 (9 commits atop
b3c0003; full matrix green at this SHA; scanners 0/0). Preflight:
reports/POWERSTATION_FOUNDATION_ACCEPTANCE_AND_GATES.md + the migration
preflight PASS recorded in the activation session.

Steps 1-3 are owner-run. Steps 4-5 the agent executes on your
authorization (staging-scoped, precedented: agent-driven Vercel staging
promote; owner-approved SSH window).

## STEP 1 - push the feature branch (owner terminal; H-6 blocks agent)

```text
git -C C:\dev\preston-os push origin feature/final-build-fast-track
```

WHAT: publish commits 0b46e67..cf96346 to the existing remote branch.
WHY: durable git state; Vercel builds the staging preview from it.
RISK: none to any deployment (feature branch only; master untouched).
ROLLBACK: branch reset on remote (nothing consumes it until step 4).
EXPECTED: origin/feature/final-build-fast-track == cf96346.

## STEP 2 - staging artifact bucket + storage policies (Supabase
## dashboard, STAGING project vcqtlmlaxxankxyezlul)

2a. Storage -> New bucket: name `artifacts`, PRIVATE (public OFF).
2b. SQL editor (policies; bucket must exist first):

```text
create policy "artifacts_objects_sel" on storage.objects
  for select to authenticated
  using (bucket_id = 'artifacts'
         and (public.is_owner() or public.is_runtime_service()));
create policy "artifacts_objects_ins" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artifacts'
              and (public.is_owner() or public.is_runtime_service()));
create policy "artifacts_objects_upd" on storage.objects
  for update to authenticated
  using (bucket_id = 'artifacts'
         and (public.is_owner() or public.is_runtime_service()))
  with check (bucket_id = 'artifacts'
              and (public.is_owner() or public.is_runtime_service()));
```

WHAT: private bucket + select/insert/update for owner + runtime service
  ONLY on this bucket (update = idempotent same-path re-put; upload uses
  upsert). No delete policy: objects cannot be removed by any client.
WHY: durable artifact storage (design doc v1; path
  goal/<goal_id>/job/<job_id>/run/<run_id>/<file>).
RISK: additive policies scoped to bucket_id='artifacts'; other buckets
  (none exist) and tables untouched. Secrets: none involved.
ROLLBACK: drop the three policies; delete the (empty) bucket.
EXPECTED: bucket listed private; 3 policies on storage.objects.

## STEP 3 - apply migrations 0026 + 0027 (SQL editor, staging)

Paste, in order, the full contents of:
  supabase/migrations/0026_side_effect_ledger.sql
  supabase/migrations/0027_artifacts.sql
Then verification:

```text
select relname, relrowsecurity from pg_class
 where relname in ('side_effects','artifacts');          -- both true
select tablename, policyname from pg_policies
 where tablename in ('side_effects','artifacts');        -- 3 + 3 rows
select grantee, privilege_type from information_schema.role_table_grants
 where table_name in ('side_effects','artifacts')
   and grantee in ('anon','authenticated');
   -- anon: zero rows; authenticated: SELECT/INSERT/UPDATE only
```

WHAT: two NEW tables (ledger + artifact metadata), indexes, RLS.
WHY: idempotency ledger + artifact SSOT metadata.
RISK: purely additive; no existing table/policy/function touched; no
  SECURITY DEFINER; no data.
ROLLBACK: reports/p2_evidence/rollback/rollback_0026/0027.sql.txt.
EXPECTED: verification rows exactly as annotated.

## STEP 4 - staging web promote (AGENT-RUN on your authorization)

Agent drives the Vercel STAGING project via your Chrome session:
promote the Ready preview of cf96346 to the staging alias, then probe
read-only: /api/health 200, openapi.json shows 10 ops incl.
getPrestonArtifact, /mcp + status 401 fail-closed.
ROLLBACK: re-promote the current alias deployment (0c14f63 build).
No Vercel env changes are needed for the web tier.

## STEP 5 - staging host rebuild + env + drills (AGENT-RUN via
## owner-approved SSH window; staging host only)

```text
a. repo:   runuser -u grann -- git -C /srv/preston-os fetch origin
           runuser -u grann -- git -C /srv/preston-os checkout cf96346be73fd1a302b8f1810237e789b386fdd7
           runuser -u grann -- npm --prefix /srv/preston-os/apps/dashboard ci
           runuser -u grann -- npm --prefix /srv/preston-os/apps/dashboard run build:os-runtime
b. env (/etc/preston/worker.env - 4 lines):
           ORCH_BASE_COMMIT=cf96346be73fd1a302b8f1810237e789b386fdd7
           ORCH_CAPABILITY_DRYRUN_ENABLED=true
           ORCH_OWNER_IDENTITY=info@preston.nyc
           (ORCH_ARTIFACTS_ENABLED=true is added ONLY after drill G3,
            so G3 proves the ordinary job path with artifacts still off)
c. drills: G3 (doc goal via Preston Control, timer-driven), then
           G7-G12 (capability-dryrun scenarios: gated, duplicate,
           terminal, retryable, uncertain, reconcile), then enable
           ORCH_ARTIFACTS_ENABLED=true and run G4 (edit goal ->
           artifact persists) and G5 (preston_get_artifact readback).
ROLLBACK: checkout 0c14f63 + rebuild; remove the three env lines.
```

RISK: staging appliance only; production untouched throughout; every
  new code path is fail-closed without its gate.
EXPECTED: acceptance rows G3-G5, G7-G12 PASS with recorded ids.

## Authorization phrase (covers steps 4 + 5 agent execution only;
## steps 1-3 are your own actions)

```text
OWNER AUTHORIZES POWER STATION STAGING ACTIVATION: steps 4 and 5
(staging web promote at cf96346; staging host rebuild, env lines,
and acceptance drills via SSH window)
```
