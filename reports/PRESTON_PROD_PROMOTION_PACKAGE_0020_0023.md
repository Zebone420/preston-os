# PRESTON — FINAL PRODUCTION PROMOTION PACKAGE (0020 → 0023)

Status: READY FOR OWNER EXECUTION. Nothing in this package has been applied
to production. Architecture is FROZEN at the staging-proven state; redesign
only if a production preflight/verification step exposes a genuine defect.

Staging proof base (all verified, evidence in reports/p2_evidence/):
- 0020/0021 behavioral matrix PASS; 0022 full staging matrix PASS
  (staging_matrix_out.txt); 0023 full staging matrix PASS
  (staging_matrix_0023_out2.txt: policy installed RESTRICTIVE/authenticated/
  INSERT, RLS on, D-1 denied by RLS, D-2/L-1/L-2 allowed, D-3 denied by 0022
  CHECK, owner decide approved, runtime clear ok:true, ready|f|RED, cleanup 0).
- Bridge = 100% (n8n bracket + ChatGPT live read + full chain, go-live report
  §18–20). Classification-integrity blocker CLOSED.

Targets:
- PROD Supabase: ref hiqsymsiwonmvrbbqhhe, session pooler
  aws-0-us-east-1.pooler.supabase.com:5432, user postgres.hiqsymsiwonmvrbbqhhe.
- PROD host: preston-agent-prod (46.224.68.139), /srv/preston-os,
  currently pinned f55e146, manual-tick posture (only hermes-observe timer).
- PROD web: preston-os-prod.vercel.app.
- STAGING (do not touch further): ref vcqtlmlaxxankxyezlul.

Conventions: `<PROD psql>` below means
`psql "host=aws-0-us-east-1.pooler.supabase.com port=5432 user=postgres.hiqsymsiwonmvrbbqhhe dbname=postgres sslmode=require"`
(prod DB password at the prompt). Output capture pattern (avoids UTF-16
mangling, includes expected-error stderr):
`cmd /c "psql ... -f <file> > <out.txt> 2>&1"`.

---

## 1. EXACT PIN TO PROMOTE

- Git: the commit carrying this package, **tag `promote-0020-0023`**
  (hash recorded in the evidence index at seal time; parent security
  content = 699d0f5, which contains migrations 0020–0023 final,
  store.ts clear-gate RPC delegation, actions.ts audit hardening,
  18/18 migration static tests green).
- DB: migrations 0020, 0021, 0022, 0023 — byte-identical files staging ran.
- Code reaches production two ways, both pinned to the tag:
  (a) Vercel dashboard deploy (actions.ts hardening — defense in depth;
      DB 0021 already guarantees the audit row),
  (b) /srv/preston-os checkout on preston-agent-prod (store.ts RPC
      delegation — REQUIRED with DB 0022: the old direct-CAS clear fails
      closed once the column revoke lands, so gated jobs cannot be cleared
      until the host pin is updated. Manual-tick posture makes the gap
      harmless, but host pin update is part of THIS promotion, not later).

## 2. PRODUCTION PREFLIGHT + PARITY (read-only; abort on any mismatch)

P-1 (owner psql, read-only) — prod must NOT yet have 0020–0023 objects and
must be the production deployment:
```
select environment from public.runtime_deployment where id='self';      -- production
select proname from pg_proc where proname in
  ('is_runtime_service','clear_approval_gate','job_gate_required');     -- 0 rows
select conname from pg_constraint
  where conname='goal_jobs_gate_not_runnable';                          -- 0 rows
select policyname from pg_policies
  where tablename='goal_jobs' and policyname='goal_jobs_runtime_classify'; -- 0 rows
select position('ssot-read' in prosrc)>0
  from pg_proc where proname='read_ssot_status';                        -- t (0019 present: 0019 re-creates read_ssot_status with the 'ssot-read' audit INSERT; it creates no new function)
select count(*) from public.owners;                                     -- >= 1
```
P-2 (host, via jump chain): `git -C /srv/preston-os rev-parse HEAD` =
f55e146; `systemctl list-timers` shows ONLY hermes-observe (manual-tick
posture holds for the whole promotion window).
P-3 (web): preston-os-prod.vercel.app health 200; /api/os/remote/status and
/api/os/ssot/status return 401 without bearer (fail-closed baseline).
P-4 (repo): tag promote-0020-0023 pushed; working tree clean; migration
static tests green at the tag.
Any FAIL here = stop; no production change has occurred yet.

## 3. BACKUP / ROLLBACK CHECKPOINT (before any DDL)

B-1 Supabase dashboard → PROD project → Database → Backups → Create backup;
record the timestamp in the evidence index.
B-2 Schema snapshot (restore-point proof for authz objects):
```
pg_dump -h aws-0-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.hiqsymsiwonmvrbbqhhe -d postgres -s \
  -f reports/p2_evidence/prod_golden/prod_preapply_schema_20260820.sql
```
B-3 Record host pin (f55e146) and current Vercel deployment id (for
instant-rollback targets). Do not proceed until B-1..B-3 are recorded.

## 4. EXACT PRODUCTION MIGRATION ORDER

One owner psql sitting, `-v ON_ERROR_STOP=1`, from C:\dev\preston-os at the
promoted tag:
```
<PROD psql> -v ON_ERROR_STOP=1
\i supabase/migrations/0020_runtime_service_identity.sql
insert into public.runtime_services (user_id, note)
  values ('<PROD_RUNTIME_UID>', 'preston runtime (non-owner, production)')
  on conflict (user_id) do nothing;
\i supabase/migrations/0021_decide_audit_failclosed.sql
\i supabase/migrations/0022_approval_gate_db_enforced.sql
\i supabase/migrations/0023_job_classification_gate.sql
```
Expected tail per file: 0020 CREATE TABLE/FUNCTION + policies; INSERT 0 1;
0021 CREATE FUNCTION; 0022 ALTER TABLE/REVOKE/GRANT/CREATE FUNCTION;
0023 CREATE FUNCTION/REVOKE/GRANT/DROP POLICY/**CREATE POLICY** (the 0023
staging FAIL was this statement erroring — it MUST print CREATE POLICY).
Any error under ON_ERROR_STOP=1 stops the session: run the matching
rollback (§11) for anything already applied, then stop and report.

## 5. PRODUCTION RUNTIME IDENTITY (creation + registration)

R-1 (owner, Supabase PROD dashboard): Auth → Users → Add user
`runtime@service.preston` (strong password, kept off-chat). Do NOT add to
owners. Copy its User UID = `<PROD_RUNTIME_UID>` (used in §4 registration
and as `-v RT=` in §8).
R-2 (owner, prod host, AFTER §4 + §6 host pin): re-seed the runtime session
from the SERVICE user (same mechanism as today): sign in once as the
service user to obtain a refresh token, then on preston-agent-prod
`read -s SUPABASE_RUNTIME_REFRESH_TOKEN` (paste; token-store rewrites on
next tick). Run ONE manual tick (`systemctl start preston-orchestrator`)
and confirm the log shows a normal compose cycle.
R-3 (owner, Supabase PROD dashboard): Auth → sign out ALL sessions of the
human OWNER user (this is the R-2 remediation revocation — it removes
standing owner authority from the host; your dashboard/phone just signs in
again). Do R-3 only AFTER R-2 proves the service session works.

## 6. CODE PROMOTION (pin + dashboard)

C-1 Push master + tag to origin (production-facing: Vercel builds from the
repo) — owner authorizes; then verify the Vercel PROD deployment is
building the promoted commit (if the project does not auto-deploy master,
trigger a manual deploy of the tag; record deployment id).
C-2 Prod host pin (owner-authorized, via jump chain
Zpc26 → preston-n8n → preston-agent-staging → preston-agent-prod):
```
git -C /srv/preston-os fetch origin
git -C /srv/preston-os checkout promote-0020-0023
git -C /srv/preston-os rev-parse HEAD   # record
```
No service restart needed (manual-tick posture); the next tick runs the
new code. Order within the window: §4 DB first, then C-1/C-2, then §5 R-2/R-3.

## 7. POST-MIGRATION SCHEMA/POLICY VERIFICATION (owner psql, read-only)

```
select proname from pg_proc where proname in
 ('is_runtime_service','clear_approval_gate','decide_orchestration_approval','job_gate_required');
                                                          -- all 4
select conname from pg_constraint where conname='goal_jobs_gate_not_runnable';  -- 1 row
select policyname, permissive, roles, cmd from pg_policies
 where tablename='goal_jobs' and policyname='goal_jobs_runtime_classify';
                              -- RESTRICTIVE | {authenticated} | INSERT
select relrowsecurity from pg_class where oid='public.goal_jobs'::regclass;     -- t
select count(*) from public.runtime_services;                                   -- 1
select string_agg(column_name,',' order by column_name)
  from information_schema.column_privileges
 where table_name='goal_jobs' and grantee='authenticated'
   and privilege_type='UPDATE';
   -- must EXCLUDE requires_approval, kind, objective, title, risk_class
```
(§8's matrix re-proves all of this in its S-0 section — running §7
standalone is optional if §8 follows immediately.)

## 8. BOUNDED PRODUCTION SECURITY MATRIX (critical 0020–0023 invariants)

Script: `reports/p2_evidence/prod_matrix_0020_0023.sql.txt` (frozen
staging probes + 0020/0021 spot checks). Fixtures are 'prodmx-' tagged,
carry environment='staging' (structurally unselectable by the production
dispatcher per model.ts environment pinning), run under the manual-tick
posture, and self-clean to remaining=0.
```
cmd /c "psql "host=aws-0-us-east-1.pooler.supabase.com port=5432 user=postgres.hiqsymsiwonmvrbbqhhe dbname=postgres sslmode=require" -v RT=<PROD_RUNTIME_UID> -f reports/p2_evidence/prod_matrix_0020_0023.sql.txt > reports/p2_evidence/prod_golden/prod_matrix_out_20260820.txt 2>&1"
```
Required exact outcomes:
| Probe | Invariant | Required result |
|---|---|---|
| S-0 | installed state | env=production; 4 fns; CHECK; policy RESTRICTIVE/{authenticated}/INSERT; RLS t; runtime_services=1; UPDATE cols exclude gate+action fields; classifier t/f/t/f |
| I-0020a/b | controls read-only | UPDATE 0; readable 1 |
| I-0020c | registry sealed | permission denied |
| I-0020d | runtime cannot decide | owner_required; approval stays pending |
| I-0022n1 | gate column sealed | permission denied for column |
| D-1 | 0023 classification gate | RLS violation goal_jobs_runtime_classify |
| D-2 | honest dangerous path | pending \| t |
| D-3 | 0022 structural gate | CHECK goal_jobs_gate_not_runnable |
| L-1 | benign GREEN liveness | ready \| f |
| L-2 | honest RED liveness | pending \| t |
| L-3a | owner decides | approved |
| I-0021 | fail-closed audit | decide_audit_rows = 1 |
| L-3b | approved clear path | ok:true, then ready \| f \| RED |
| CLEANUP | bounded blast radius | remaining=0 |
Any deviation = FAIL: stop, evaluate §11 rollback, report.

## 9. BRIDGE / SSOT END-TO-END REMOTE-LIVE SMOKE TEST

After §4–§8 all PASS:
S-1 Gateway fail-closed + live read: /api/os/ssot/status and
/api/os/remote/status → 401 without bearer; 200 with an owner-held actor
token; response reports environment=production and posture readable.
S-2 n8n intake bracket (the proven Gate-1 bracket curls) → accepted.
S-3 FRESH fully-instrumented R-2 drill, ids `rops-prod-drill-3`, exactly
per PRESTON_RUNTIME_SERVICE_IDENTITY_OWNER_PACKET.md §"AFTER PROMOTION —
FRESH R-2 DRILL": phone submit → timer consume → goal parks → pending
approval on phone dashboard (screenshot #1) → owner taps Approve on
preston-os-prod.vercel.app (screenshot #2) → hands-off ≥15 min →
timer-driven execution → verification: exactly one
audit_log orchestration_approval_decision row with is_owner=true + owner
auth.uid; the runtime session in the window is the SERVICE user (non-owner);
a Vercel POST at the tap time. This drill is the end-to-end proof that the
whole 0020–0023 posture works with the REAL runtime, not the psql-simulated
identity.

## 10. EVIDENCE CAPTURE + GOLDEN-BASELINE SEAL

All artifacts under `reports/p2_evidence/prod_golden/`:
preapply schema dump (B-2), migration apply transcript, §7/§8 matrix
output, S-1/S-2 responses, R-2 drill evidence (screenshots referenced by
filename, DB captures, orchestrator log excerpt), post-apply schema dump
(`prod_postapply_schema_20260820.sql`) + SHA256 of both dumps.
Seal = one commit: golden evidence index + go-live report addendum
(percentages + verdict) + memory update; tag `prod-golden-0023`. The seal
commit is the golden baseline future drift checks diff against.

## 11. EXPLICIT ROLLBACK PER PRODUCTION-CHANGING STEP

Reverse order of application; DB artifacts in reports/p2_evidence/rollback/
(owner-run; copy body into psql or rename to .sql and \i):
| Step | Rollback |
|---|---|
| §4 0023 | rollback_0023.sql.txt (drop policy, then function). Bounded; restores pre-0023 authz exactly. |
| §4 0022 | rollback_0022.sql.txt — MUST be paired with reverting the host pin to f55e146 (pre-RPC store.ts) if C-2 already ran; DB-only rollback is safe if C-2 has not run yet. |
| §4 0021 | rollback_0021.sql.txt (restores the 0010 decide body verbatim). |
| §4 0020 + registration | rollback_0020.sql.txt; registration alone: `delete from public.runtime_services where user_id='<PROD_RUNTIME_UID>';` |
| §5 R-2 re-seed | re-seed the previous token via the same read -s mechanism (NOT recommended — it restores the standing-owner defect; prefer fix-forward), or leave the service session (harmless without 0020? NO — without 0020 the service user has no policies; restore 0020 or the old token, one of the two). |
| §5 R-3 sign-out | none needed (sign-in restores sessions). |
| §6 C-1 Vercel | Vercel dashboard → Instant Rollback to the recorded pre-promotion deployment id. |
| §6 C-2 host pin | `git -C /srv/preston-os checkout f55e146`. |
| §8 fixtures | self-cleaning; if aborted mid-run, re-run only the CLEANUP block (scoped to :'g1'). |
| Catastrophic | B-1 Supabase backup restore (last resort; loses post-backup data — manual-tick posture makes the window quiet). |

## 12. FINAL PASS CRITERIA — PRODUCTION-LIVE = 100%

ALL of, with captured evidence:
1. §2 preflight exact; §3 checkpoints recorded.
2. §4 migrations applied with zero errors under ON_ERROR_STOP=1.
3. §7/§8 matrix: every required result EXACT (table above), cleanup
   remaining=0.
4. Runtime identity: prod runtime session is the SERVICE user
   (is_owner=false), owner sessions signed out, one normal manual tick
   composes successfully on the new pin.
5. Pins: /srv/preston-os = promote-0020-0023; Vercel prod deployment =
   promoted commit; 401 fail-closed preserved.
6. §9 S-1/S-2 pass; R-2 drill rops-prod-drill-3 = PASS with the full
   attribution chain (both screenshots + audit_log is_owner=true row +
   Vercel request at tap time + timer-driven execution, no manual help).
7. §10 golden baseline sealed and committed; go-live report updated to
   Production-Live = 100 only when 1–6 all hold.

---

## OWNER EXECUTION ORDER (batched to 3 credentialed interventions)

OWNER ACTION A (Supabase dashboard, ~3 min): B-1 backup; create
runtime@service.preston, copy `<PROD_RUNTIME_UID>`.
OWNER ACTION B (one terminal sitting): B-2 pg_dump; P-1 preflight; §4
migrations + registration; §7 verification; §8 matrix with -v RT. Paste
outputs back — the agent verifies every line before you proceed.
OWNER ACTION C (after agent PASS verdict on B): authorize C-1 push;
C-2 host pin (or authorize the agent to run it over the jump chain);
R-2 re-seed + one tick; R-3 owner sign-out. Then §9 smoke + drill
(phone taps are yours; everything else is agent-verified), §10 seal.

FIRST OWNER ACTION: **OWNER ACTION A.**
