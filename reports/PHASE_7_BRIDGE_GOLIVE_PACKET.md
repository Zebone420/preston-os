# PHASE 7 - BRIDGE GO-LIVE PACKET (FINAL, owner-run)

Date: 2026-07-23. Status: AUTHORITATIVE. Supersedes the 2026-07-22 draft of
this file and the migration block of
`reports/PHASE_7_MIGRATION_0010_FINAL_OWNER_PACKET.md`. A read-only Codex
audit of this packet ran before finalization; all 11 substantive findings
were reconciled in this version (section 11).

This is the exact, dependency-ordered owner path from "locally complete and
tested" to "staging deployed, activated in simulation, remotely verified".
Every live-boundary step is OWNER-ONLY. Claude performs none of them. All
SQL runs in the Supabase STAGING SQL editor as the owner. Nothing in this
packet enables execution, sending, production writes, or Hermes activity.

EXECUTION ORDER (dependency-correct; the section numbers keep the standard
packet layout, the ORDER is this):

1. Section 3 steps 3.1-3.4 (verify + branch backup to remote).
2. Section 4 (staging migration 0010 - BEFORE the master push, because the
   master push auto-triggers the Vercel dashboard deployment).
3. Section 3 steps 3.5-3.6 (fast-forward merge + master push -> Vercel).
4. Section 5 (host deployment, everything stays disabled).
5. Section 6 (activation gates) -> section 7 (drill) only if gates pass.

`$TIP` below = the tip commit of `phase7/reconcile-approval-enforcement`
(the finalization commit that contains THIS packet - confirm with 3.2).
After the fast-forward merge, `master` == `$TIP`; the deployed pin is the
same hash.

---

## 1. VERIFIED LOCAL COMPLETION (re-verified 2026-07-23 on this machine)

Repository: `C:\dev\preston-os` (primary worktree, branch `master`, clean).
Feature worktree: `C:\dev\preston-os-worktrees\phase7-approval-reconcile`,
branch `phase7/reconcile-approval-enforcement`, clean after the
finalization commit of this packet.

Commit topology (verified via merge-base):

- `master` = `b3f18b0`, ahead of `origin/master` by 2 commits
  (`cdc98b7` migration finalization + final migration packet,
  `b3f18b0` migration schema-reconciliation checkpoint).
- The branch is strictly ahead of `master` (merge-base is exactly
  `b3f18b0`), so master can FAST-FORWARD to it. No divergence anywhere.

Branch commits in dependency order (exact files per commit verified by
`git log --stat`; every file is orchestration/migration/test/deploy-doc
scoped - no unrelated files in any commit):

| Commit | Content | Files |
|---|---|---|
| 291d050 | migration 0010 approval-enforcement hardening (atomic decomposition RPC, decision RPC, constrained INSERT policy) | migration-0010.test, orchestration-security-regressions.test, 0010 SQL |
| 4742929 | worktree-lock store adapted to real repository_worktrees schema + monotonic fence | worktree-lock-store.ts, worktree-lock.ts, worktree-lock-store.test |
| ad41e00 | durable driver: run_id execution lease, worker claim, restart recovery, fenced results | driver.ts, model.ts, store.ts, transitions.ts, drills+driver tests, 0010 SQL |
| 2478a4f | canonical SHA-256 approval->execution binding, execution-time expiry, atomic clearance | crypto-binding.ts, driver.ts, store.ts, 4 test files, 0010 SQL |
| 7a53210 | bridge end-to-end gate + gated-job parking | completion-engine.ts, driver.ts, store.ts, orchestration-bridge-e2e.test |
| a01bb4e | durable evidence persistence + bridge readiness/health read model | driver.ts, read-model.ts, orchestration-bridge-e2e.test |
| ca71300 | draft go-live packet | this file (draft) |
| `$TIP` | THIS finalized packet (docs only) | this file |

Validation matrix, re-run 2026-07-23 at the branch head on this machine:

| Check | Result |
|---|---|
| Full vitest suite | 846 tests: 841 pass, 5 fail - ALL 5 are `worktree-prep.test.ts` shelling to `bash` (Windows PATH env limitation, documented since Phase 5; compensated below). Owner-environment runs show 846/846. |
| Compensating Git Bash checks | `bash -n` on worktree_prepare.sh / secret_scan.sh / red_boundary_scan.sh: 3/3 OK |
| Bridge end-to-end tests | 9/9 pass (orchestration-bridge-e2e.test.ts) |
| Orchestration/migration/driver/durable/drills/security-regression suites | pass (inside the 841) |
| os-runtime build (`npm run build:os-runtime`, tsc strict) | PASS |
| Lint (`npm run lint`) | PASS |
| Next.js production build (`npm run build`) | PASS on `master` (`b3f18b0`) in the primary repo. NOT runnable inside the feature worktree (Turbopack rejects the node_modules junction - environment limitation, not code). The branch adds NO `src/app` files, so the app surface is identical; owner CI/Vercel is the authoritative build check at `$TIP`. |
| App-graph `tsc --noEmit` (includes test files) | 2 errors, BOTH in test files only: `business-signout.test.ts:80` (pre-exists on master) and `orchestration-read-model.test.ts:26` (branch store typing gained lte/gt; the older test fake lags). EMPIRICALLY EXCLUDED from `next build` (master build passes with the same tsc failure) and invisible to vitest. Recorded as hygiene debt for the follow-up local gate. NOT a go-live blocker. |
| secret_scan.sh (worktree root) | 0 findings |
| red_boundary_scan.sh (worktree root) | 0 findings |

Codex disposition: the P7-CX-01 adversarial package (23 security-regression
tests) is integrated at `e1a6467` (in master ancestry); its two
expected-fail defects (forged approval_id unlock; re-entrant worktree
rebind) were reproduced, FIXED, and pinned by now-passing tests. Branch
commits were Codex-reviewed during the build sessions. The final packet
audit findings and dispositions are in section 11 - zero unreconciled
blocker/critical/major findings remain.

TWO VERIFIED GAPS (material, honest; they gate sections 6-7, NOT
push/merge/migration/deployment):

- The durable goal driver (`driveGoal`) is exported library code exercised
  by tests only. The deployed dispatcher supports exactly
  `health | db-health | worker-loop | hermes-loop`; there is NO
  `orchestrate-once` command and no route invokes the driver. On a deployed
  host, Phase-7 goals cannot be DRIVEN yet.
- The bridge readiness read model (`loadBridgeReadiness`) is likewise
  library-only - no endpoint or page invokes it yet. Readiness must be
  verified via the `/os/orchestration` page summary + owner SQL until it is
  wired.

Both belong to ONE small follow-up LOCAL gate ("orchestrate-once wiring"):
add the dispatcher command + readiness surfacing + refresh the two lagging
test fakes. Goal submission, decomposition persistence, approval
issuance/decision, and all read models already work via the dashboard
action + SQL RPCs.

## 2. MIGRATION 0010 REVIEW (read-only inspection; H-3 respected)

File: `supabase/migrations/0010_phase7_orchestration.sql` - the BRANCH
version, git blob `e513bb14269778999b1c65915e9c717305e9996d`, which
strictly extends the master version. Working-file SHA-256:
`5099AF8120CE3099304B1D8C113FF6FE799BD80ECC17A5AAE335C961C5CD9970`

Schema objects created (all guarded `if not exists` / do-block):

- Tables: `master_goals` (with `iteration` counter, unique
  `correlation_id`), `goal_jobs` (with `run_id` + `run_lease_expires_at`
  execution-lease columns, composite `(id, goal_id)` key), `job_dependencies`
  (composite FKs force SAME-GOAL edges), `agent_contracts` (default-deny,
  `can_approve` CHECK-pinned false), `orchestration_approvals` (hash-bound,
  expiring, nullable decision `nonce` + PARTIAL unique index on non-null
  nonces so pending rows are insertable and decided nonces are one-time).
- Additive columns on existing `repository_worktrees` (0004): `fence`,
  `allowed_paths`, `lease_expires_at`.
- Deferred FK `goal_jobs_approval_fk` -> `orchestration_approvals`.
- DB-level simulation pins (CHECK): `simulation_only=true`,
  `environment='staging'`, `executed=false`, `can_approve=false`.

Functions:

- `public.submit_goal_decomposition(jsonb,jsonb,jsonb)` - SECURITY INVOKER
  (caller RLS applies; adds atomicity, not privilege), fixed
  `search_path=public, pg_temp`, internal `is_owner()` re-check,
  per-correlation advisory xact lock (operational idempotency under
  concurrency), deterministic id+correlation match else
  `idempotency_conflict`, whole-graph single transaction (goal + jobs +
  deps or nothing), 1000-job bound, malformed deps fail closed.
- `public.decide_orchestration_approval(text,text,text)` - SECURITY
  DEFINER, REQUIRED because `authenticated` holds no UPDATE grant on
  approvals; risk contained by: fixed `search_path`, schema-qualified
  statements, no dynamic SQL, execute revoked from `public`/`anon`
  (granted to `authenticated` only), internal `is_owner()` enforcement,
  `FOR UPDATE` row lock, pending-only, one-time nonce,
  `clock_timestamp()` expiry taken AFTER the lock (a decider that waited
  on the lock cannot approve an expired row), `decided_at` stamped from
  that same clock. This RPC is the ONLY decision path.

Policies and grants: owner-only RLS (`public.is_owner()`) on all five
tables; `anon` fully revoked; DELETE revoked everywhere;
`job_dependencies` insert+select only; `orchestration_approvals` INSERT
policy CONSTRAINED to `status='pending' AND nonce is null AND decided_at
is null` (a pre-approved row can never be inserted directly - the forge
path is closed at the DB), and NO update policy or grant exists.

Enforcement summary: owner authorization - every policy + both functions.
Approval hash binding - `action_hash NOT NULL` at the DB; canonical
SHA-256 recomputed and compared at execution time by the driver
(`verifyAuthoritativeApproval`: approved status + owner + hash +
job/goal/env scope + nonce + non-expired). Execution-time expiry -
enforced in the decision RPC AND re-checked by the driver at clearance.
Concurrency - advisory lock, row lock, partial unique nonce index, run_id
lease CAS.

Idempotency and re-run behavior, stated PRECISELY: on a CLEAN slate the
file runs once, end to end. Statements are guarded, so re-running after
FULL success is a no-op. But `create table if not exists` does NOT
reconcile a partially-created or drifted table with this file's shape -
a MIXED prior state (some Phase-7 objects present, some absent, or an
older shape) is NOT safely re-runnable and is a HARD STOP (section 4.2).

Expected predecessor state: 0001 (approvals), 0002 (`public.is_owner()`),
0004 (`os_jobs`, `repository_worktrees`), 0005 (text id alignment) applied;
0006/0009 applied per prior gates; 0007/0008 NOT required. There is NO
`supabase_migrations` ledger (owner applies via the SQL editor), so
predecessor verification is object-level: section 4.2 checks sentinel
objects for each predecessor and hard-stops on any gap.

Known limitations (stated, accepted):

- NOT executed against a disposable local Postgres; validated by the
  static migration test suite + fake-client behavioral suites. Mitigation:
  verification block 4.6 and behavioral checks 4.7 run immediately after
  apply; objects stay inert until the worker gate.
- No tracked down-migration (repo policy keeps destructive SQL out of
  tracked files). Post-failure posture is CONTAINMENT (section 8.1), not
  reversal: additive objects are inert if unused; app rollback never
  requires object removal; true removal is owner-composed SQL.

RECOMMENDATION: GO for staging application, AFTER the 4.3 backup, in the
EXECUTION ORDER above (migration before the master push).

## 3. OWNER-RUN GIT SEQUENCE (PowerShell, real ZPC26)

Read-only until 3.3. STOP at any mismatch. No force-push anywhere; every
mutation is a plain push or a fast-forward.

```powershell
# 3.1 Verify primary repo state (expect: clean, master, ahead 2)
git -C C:\dev\preston-os status
git -C C:\dev\preston-os log --oneline origin/master..master
```
STOP IF: working tree dirty, or the two ahead commits are not
`cdc98b7` + `b3f18b0`.

```powershell
# 3.2 Review the branch commits and the full diff (read until satisfied)
git -C C:\dev\preston-os log --oneline master..phase7/reconcile-approval-enforcement
git -C C:\dev\preston-os diff --stat master...phase7/reconcile-approval-enforcement
git -C C:\dev\preston-os diff master...phase7/reconcile-approval-enforcement
```
Record the branch tip hash as `$TIP`. STOP IF: any file outside
`apps/dashboard/src/lib/ai-os/`, `apps/dashboard/test/`,
`supabase/migrations/0010_phase7_orchestration.sql`, `deploy/`, `reports/`
appears in the stat, or the tip is not the finalized-packet docs commit.

```powershell
# 3.3 Push master's 2 base commits, then the branch (remote backup/review)
git -C C:\dev\preston-os push origin master
git -C C:\dev\preston-os push origin phase7/reconcile-approval-enforcement
git -C C:\dev\preston-os log --oneline -1 origin/master
```
STOP IF: either push is rejected (the remote moved - investigate; never
force). NOTE: pushing the BRANCH may create a Vercel PREVIEW deployment;
that surface is fail-closed for the not-yet-applied migration (the
orchestration read model distinguishes `migration_absent`), and it is not
the owner dashboard. The PRODUCTION dashboard only redeploys on the
MASTER push in 3.5 - which is why section 4 runs BEFORE 3.5.

>>> NOW EXECUTE SECTION 4 (staging migration). Return here after 4.7. <<<

```powershell
# 3.5 Merge: fast-forward ONLY (the branch strictly contains master)
git -C C:\dev\preston-os merge --ff-only phase7/reconcile-approval-enforcement
git -C C:\dev\preston-os log --oneline -3
```
STOP IF: git refuses the fast-forward (master moved since 3.1 - re-verify
from 3.1; do NOT create a merge commit without re-review).

```powershell
# 3.6 Push merged master (this TRIGGERS the Vercel dashboard deployment)
git -C C:\dev\preston-os push origin master
git -C C:\dev\preston-os fetch origin
git -C C:\dev\preston-os log --oneline -1 origin/master
git -C C:\dev\preston-os status
```
EXPECT: `origin/master` == `$TIP`; status clean, ahead 0. In the Vercel
dashboard, note the previous production deployment (that is the Vercel
rollback point, section 8.2) and verify the new deployment builds at
`$TIP`.

## 4. OWNER-RUN STAGING MIGRATION SEQUENCE (Supabase STAGING SQL editor)

4.1 Target confirmation: open the Supabase project named
`preston-os-staging` (the ONLY project this packet touches). STOP IF the
project name in the header is anything else. Never run this in production.

4.2 Predecessor + slate check (read-only). Expected results in comments;
ANY deviation = HARD STOP (report, do not apply):

```sql
-- 0002 sentinel (expect 1 row)
select proname from pg_proc where proname = 'is_owner';
-- 0001/0004/0005/0006/0009 sentinels (expect ALL of: approvals, os_jobs,
-- repository_worktrees, system_controls, telegram_updates, clients)
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('approvals','os_jobs','repository_worktrees',
 'system_controls','telegram_updates','clients') order by table_name;
-- 0005 id-alignment sentinel (expect data_type = 'text')
select data_type from information_schema.columns
 where table_name='job_attempts' and column_name='id';
-- Phase-7 slate (expect 0 rows = clean slate, OR exactly these 5 = already
-- applied, then SKIP to 4.6. ANY OTHER SUBSET = HARD STOP: partial/drifted
-- schema; this file is NOT safe to run over a partial state - see 8.1.)
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('master_goals','goal_jobs','job_dependencies',
 'agent_contracts','orchestration_approvals') order by table_name;
```

4.3 BACKUP (required, before apply): run the owner pg_dump per
`STAGING_FIRST_BACKUP_OWNER_PACKET` (pg_dump -Fc, port 5432, password via
Read-Host; verify the dump file exists and is non-trivial in size).
STOP IF the dump fails - do not apply the migration unbacked.

4.4 Content confirmation (read-only - no checkout, nothing overwritten):

```powershell
# Blob identity at $TIP (git's own content hash; expect
# e513bb14269778999b1c65915e9c717305e9996d)
git -C C:\dev\preston-os rev-parse "$TIP`:supabase/migrations/0010_phase7_orchestration.sql"
# File-byte hash of the checked-out branch copy you will paste (expect
# 5099AF8120CE3099304B1D8C113FF6FE799BD80ECC17A5AAE335C961C5CD9970)
Get-FileHash C:\dev\preston-os-worktrees\phase7-approval-reconcile\supabase\migrations\0010_phase7_orchestration.sql -Algorithm SHA256
```
STOP IF either value differs. Paste FROM the feature-worktree file just
hashed (it is exactly the `$TIP` content on a clean worktree).

4.5 Apply: SQL editor -> new query -> paste the ENTIRE file -> Run ONCE.
Expect success with no errors (clean-first-run guarded). STOP IF any
statement errors: capture the exact message, run NOTHING else, go to 8.1.

4.6 Verification block (run ONLY after 4.5 succeeds, as a separate query):

```sql
-- a five tables (expect 5)
select count(*) from information_schema.tables where table_schema='public'
 and table_name in ('master_goals','goal_jobs','job_dependencies','agent_contracts','orchestration_approvals');
-- b execution-lease columns (expect 2)
select count(*) from information_schema.columns where table_name='goal_jobs'
 and column_name in ('run_id','run_lease_expires_at');
-- c worktree fencing columns (expect 3)
select count(*) from information_schema.columns where table_name='repository_worktrees'
 and column_name in ('fence','allowed_paths','lease_expires_at');
-- d the two functions (expect 2)
select count(*) from pg_proc where proname in ('submit_goal_decomposition','decide_orchestration_approval');
-- e approval INSERT policy constrained (expect the is_owner AND pending AND nonce/decided_at null chain)
select pg_get_expr(polwithcheck, polrelid) from pg_policy
 where polrelid='orchestration_approvals'::regclass and polcmd='a';
-- f no direct UPDATE grant on approvals (expect 0 rows)
select 1 from information_schema.role_table_grants
 where table_name='orchestration_approvals' and grantee='authenticated' and privilege_type='UPDATE';
-- g anon holds nothing on the five tables (expect 0)
select count(*) from information_schema.role_table_grants where grantee='anon'
 and table_name in ('master_goals','goal_jobs','job_dependencies','agent_contracts','orchestration_approvals');
-- h RLS enabled on all five (expect 5 rows, all true)
select relname, relrowsecurity from pg_class
 where relname in ('master_goals','goal_jobs','job_dependencies','agent_contracts','orchestration_approvals');
```
STOP IF any value differs; go to 8.1.

4.7 Behavioral checks - EXACT owner-run SQL. Drill fixtures use the
`drill-` correlation prefix and fixed UUIDs so they are unmistakable and
retry-safe; they are simulation rows (CHECK-pinned) and are left in place
STATUS-cancelled, never deleted (DELETE is revoked by design).

```sql
-- B1a first submission (expect created:true, jobs:1)
select public.submit_goal_decomposition(
 '{"id":"00000000-0000-4000-8000-0000000000b1","correlation_id":"drill-b1",
   "title":"drill goal","objective":"idempotency drill","source":"owner_cli",
   "requested_by":"owner"}'::jsonb,
 '[{"id":"00000000-0000-4000-8000-0000000001b1","kind":"audit",
    "title":"drill job","risk_class":"GREEN"}]'::jsonb,
 null);
-- B1b identical retry (expect created:false, no new rows)
--   (re-run B1a verbatim)
-- B1c cross-match (same correlation, DIFFERENT goal id - expect ERROR
--   idempotency_conflict)
--   (re-run B1a with id 00000000-0000-4000-8000-0000000000b2)
-- B2a pending approval fixture (INSERT allowed: pending, nonce null)
insert into orchestration_approvals
 (approval_id, action, affected_resource, reason, risk_class,
  rollback_plan, action_hash, owner_identity, expires_at)
 values ('drill-b2-1','drill action','drill resource','behavioral check',
  'RED','none - simulation row','drill-hash-b2-1','owner',
  now() + interval '10 minutes');
-- B2b decide (expect returned row status=approved, decided_at set)
select status, decided_at from public.decide_orchestration_approval(
 'drill-b2-1','approved','drill-nonce-b2-1');
-- B2c second decision (expect ERROR not_pending)
select * from public.decide_orchestration_approval(
 'drill-b2-1','rejected','drill-nonce-b2-x');
-- B2d expiry: fixture with a 5-second window, wait >10s, then decide
--   (expect ERROR expired)
insert into orchestration_approvals
 (approval_id, action, affected_resource, reason, risk_class,
  rollback_plan, action_hash, owner_identity, expires_at)
 values ('drill-b2-2','drill action','drill resource','expiry check',
  'RED','none - simulation row','drill-hash-b2-2','owner',
  now() + interval '5 seconds');
select * from public.decide_orchestration_approval(
 'drill-b2-2','approved','drill-nonce-b2-2');
-- B3 forge attempt (expect ERROR: row-level security / policy violation)
insert into orchestration_approvals
 (approval_id, action, affected_resource, reason, risk_class,
  rollback_plan, action_hash, owner_identity, expires_at, status)
 values ('drill-b3-1','forged','drill resource','forge check','RED',
  'none','drill-hash-b3','owner', now() + interval '10 minutes','approved');
```
STOP IF any expectation deviates; go to 8.4. On all-pass: MIGRATION 0010
IS APPLIED AND BEHAVIORALLY VERIFIED. Record all outputs, then return to
step 3.5.

## 5. OWNER-RUN DEPLOYMENT SEQUENCE (staging host)

The production dashboard deployed via Vercel on the 3.6 push - verify in
the Vercel dashboard that the deployment commit == `$TIP` and record the
PREVIOUS deployment (rollback point). The steps below deploy the host
DISPATCHER runtime. Execution stays disabled throughout.

```bash
# 5.1 Connect and verify host identity
ssh preston-agent-staging
hostname && whoami && ls /srv/preston-os
```
STOP IF: hostname/layout is not the known staging host.

```bash
# 5.2 Current deployed commit (record as $PREV for rollback)
cd /srv/preston-os && git log --oneline -1
```

```bash
# 5.3 Fetch and pin the approved commit
git fetch origin && git checkout $TIP && git log --oneline -1
```
STOP IF: checkout output is not exactly `$TIP`.

```bash
# 5.4 Build the runtime (npm ci because package-lock may have changed)
cd /srv/preston-os/apps/dashboard
npm ci
npm run build:os-runtime
ls dist/os-runtime/bin.js
```
STOP IF: build fails or `bin.js` absent -> section 8.2.

```bash
# 5.5 Env files remain protected (names only - never print values)
sudo stat -c '%U:%G %a' /etc/preston/worker.env
```
EXPECT: owner `preston-worker`, mode `600`. STOP IF group/world readable.

```bash
# 5.6 Systemd units: compare first; back up + refresh ONLY if changed
diff /etc/systemd/system/preston-worker.service /srv/preston-os/deploy/systemd/preston-worker.service
diff /etc/systemd/system/preston-worker.timer /srv/preston-os/deploy/systemd/preston-worker.timer
# ONLY if a diff is non-empty:
sudo mkdir -p /root/preston-unit-backup && sudo cp /etc/systemd/system/preston-worker.* /root/preston-unit-backup/
sudo cp /srv/preston-os/deploy/systemd/preston-worker.service /etc/systemd/system/
sudo cp /srv/preston-os/deploy/systemd/preston-worker.timer /etc/systemd/system/
sudo systemctl daemon-reload
# Always verify nothing is enabled/active:
systemctl is-enabled preston-worker.timer preston-hermes-observe.timer
systemctl is-active preston-worker.service preston-hermes-observe.service
```
EXPECT: timers `disabled` (or hermes as previously owner-set to
observe-only), services `inactive`. STOP IF anything auto-started.

```bash
# 5.7 Preflight (read-only; PROVES: env names present, tight perms, build
# exists, authenticated read-only control-plane connectivity as the
# service user, production URL refused. It does NOT prove migration 0010,
# bridge readiness, or control VALUES - those are 5.8/6.)
cd /srv/preston-os && sudo bash deploy/preflight-health.sh
```
EXPECT: `PREFLIGHT: PASS`. Exit 78 = config gap / production URL refused
-> STOP, fix env NAMES only, re-run. Any other failure -> section 8.7.

5.8 Controls posture (owner SQL, read-only - exact check, expected values):

```sql
select owner_stop, paused, execution_enabled, remote_runner_enabled,
       hermes_mode from system_controls where id='global';
```
EXPECT: `false, false, false, false, disabled` (or `observe_only` for
hermes_mode if the owner previously set it). STOP IF anything else.

```bash
# 5.9 Logs baseline
sudo tail -n 20 /var/log/preston/worker.log
```

Nothing is started in section 5. The worker timer stays disabled until a
section 6 gate is crossed. Hermes stays exactly as the owner last set it -
this packet never changes Hermes.

## 6. STAGING ACTIVATION GATES (two DISTINCT gates - do not conflate)

### Gate 6A - OPTIONAL: re-validate the Phase-5 simulation worker
(os_jobs simulation only; does NOT touch Phase-7 goals)

Preconditions (all must hold): 5.3 pin, 5.6 disabled-state verified,
5.7 preflight PASS, 5.8 posture exact, rollback section 8 open.

The one activation command for THIS gate only (owner-only):

```bash
sudo systemctl enable --now preston-worker.timer
```

Deactivation mirror: `sudo systemctl disable --now preston-worker.timer`.
This re-proves the Phase-5 posture (bounded oneshot, exit 75 on
owner_stop/paused). It cannot advance Phase-7 goals.

### Gate 6B - Phase-7 goal-driving activation: BLOCKED (do not attempt)

ALL of the following must be true before Gate 6B exists as a runnable
command; as of this packet the FIRST box cannot be checked, so THERE IS NO
6B COMMAND IN THIS PACKET by design:

- [ ] `orchestrate-once` dispatcher command implemented, tested, merged,
      and deployed at a new `$TIP` (follow-up LOCAL gate; includes wiring
      `loadBridgeReadiness` to an owner-visible surface and a unit/timer
      revision for the new command - a separate packet revision will name
      the exact unit change and activation command).
- [ ] Migration 0010 applied + verified (4.6) + behaviorally verified (4.7).
- [ ] Host and Vercel deployments at the same pin.
- [ ] Preflight PASS + 5.8 posture exact.
- [ ] Approval path verified RPC-only (4.7 B2/B3).
- [ ] Pause/stop/kill verified from the phone (5.8 row readable; global
      kill SQL from `docs/PRESTON_AI_EMERGENCY_SHUTOFF_SPEC_v1.md` at hand).
- [ ] No secrets exposed (5.5), no unauthorized grants (4.6 e/f/g), no
      external-write capability (`executed` CHECK-pinned false;
      `execution_enabled=false`).
- [ ] Rollback commands ready (section 8).

## 7. PHONE + LAPTOP-CLOSED DRILL (owner-operated; runs only after Gate 6B
## exists and is crossed - i.e. NOT YET)

Preconditions: phone SSH (key-based) to the staging host; owner login to
the Supabase dashboard and the Vercel-deployed dashboard. Steps marked
[6B] require the `orchestrate-once` worker and are BLOCKED until that
gate; steps 1-10 + 20-21 are runnable earlier but the drill only PASSES
as a whole, in order, laptop closed throughout.

For every step: on FAILURE, stop the drill, run the stop action, record
evidence, do not proceed.

| # | Step | Command / UI action | Expected | Failure => stop action |
|---|---|---|---|---|
| 1 | Laptop closed | Close/sleep the laptop before anything else | No local session in any later step | n/a |
| 2 | Phone connects | Phone SSH -> `hostname`; phone browser -> dashboard login | Host answers; owner login succeeds | Abort drill; nothing started |
| 3 | Deployed commit | `cd /srv/preston-os && git log --oneline -1`; Vercel deployment page | Both == the pinned commit | Abort; redeploy per 5.3 |
| 4 | Authenticated simulation command | Dashboard `/os/orchestration` goal-submit form (owner session) | Submission accepted | Abort; check owner auth |
| 5 | Durable master goal | SQL: `select id,status,correlation_id,simulation_only from master_goals order by created_at desc limit 1;` | One new row, `simulation_only=true` | 8.4 |
| 6 | Duplicate submission | Submit the SAME goal again (same correlation) | No second row (count unchanged) | 8.5 |
| 7 | Decomposition persisted | SQL: count `goal_jobs` + `job_dependencies` for the goal id | Jobs + same-goal dependency edges present | 8.4 |
| 8 | Approval blocks | Inspect the gated (RED-objective) job row | `status='awaiting_approval'`, `requires_approval=true`, never advances on its own | 8.4 |
| 9 | Owner approval | `select status, decided_at from public.decide_orchestration_approval('<id>','approved','<fresh-nonce>');` | `approved`, `decided_at` set | 8.4 |
| 10 | Replayed/invalid nonce | Repeat step 9 with the same approval id | `not_pending` error; a consumed nonce on another approval -> unique violation | 8.4 |
| 11 | Expired approval fails at execution | Approve a second gated job, let `expires_at` pass, run the worker [6B] | Clearance refused, job stays parked | 8.4 |
| 12 | Hash binding | Tamper one bound field in a test-goal approval scenario, run worker [6B] | Refused on hash mismatch; untampered path clears | 8.4 |
| 13 | Bounded claim | Run the oneshot; SQL: `select run_id, run_lease_expires_at, status from goal_jobs where goal_id='<goal>';` [6B] | Only the permitted ready job claimed, under a run_id lease | 8.5 |
| 14 | Evidence + result | SQL: `select status, evidence_refs, executed from goal_jobs where id='<job>';` [6B] | `completed`, non-empty evidence ref, `executed=false` | 8.4 |
| 15 | Pause prevents claims | Shutoff-spec SQL sets `paused=true`; run the oneshot [6B] | Exit 75, no new `run_id` stamped | 8.6 |
| 16 | Resume | Shutoff-spec SQL sets `paused=false`; run the oneshot [6B] | Claims resume | 8.6 |
| 17 | Owner stop halts flow | Shutoff-spec SQL sets `owner_stop=true`; run the oneshot [6B] | Exit 75, nothing persisted | 8.6 |
| 18 | Global kill leaves nothing | Full kill SQL (shutoff spec) + `sudo systemctl disable --now preston-worker.timer`; then `systemctl is-active preston-worker.service; pgrep -f os-runtime` | No Preston runtime process; timer disabled | 8.10 |
| 19 | Restart recovery | Re-enable, start a multi-job goal, kill the oneshot mid-run, run again [6B] | Completed jobs NOT re-run (attempts unchanged); goal completes; expired-lease job requeued | 8.5 |
| 20 | Hermes observe-only | `systemctl is-enabled preston-hermes-observe.timer`; SQL check `hermes_mode` | Unchanged from pre-drill posture; no Hermes side effects | 8.6 |
| 21 | No external business write | Review Airtable TEST base activity, email outbox, Telegram bot (dormant) + `select count(*) from goal_jobs where executed=true;` | Zero external writes; count = 0 | FULL 8.9 containment + incident note |

PASS = all 21 recorded with evidence, laptop closed throughout. Only then
may the platform state "Remote-Live staging bridge VERIFIED".

## 8. CONTAINMENT (DEFAULT) + LIMITED ROLLBACK (owner-run)

Honest scope: for the migration, this section provides CONTAINMENT, not
reversal (additive objects stay, inert; removal is owner-composed SQL kept
out of tracked files; the 4.3 dump is for scratch-restore diagnosis only -
NEVER restored over staging). For host + dashboard code, real rollback is
provided. Default posture in every scenario: execution disabled, services
stopped, timers disabled, owner_stop asserted, NO database destruction,
evidence preserved.

Global kill (usable in every scenario, from the phone):

```sql
update system_controls set owner_stop=true, paused=true,
  execution_enabled=false, remote_runner_enabled=false,
  hermes_mode='disabled', updated_at=now() where id='global';
```
plus on the host: `sudo systemctl disable --now preston-worker.timer
preston-hermes-observe.timer`.

| Scenario | Containment / rollback |
|---|---|
| 8.1 Migration failure (4.2 mixed slate, 4.5 error, or 4.6 mismatch) | STOP all SQL. A partial apply leaves inert objects, not corruption. Capture the exact error + failing verification letters. Do NOT hand-craft repair DDL and do NOT re-run the file over a partial state. Report for a corrected-migration gate. Diagnose via the 4.3 dump in a SCRATCH project only. |
| 8.2 Deployment failure (5.4 or bad behavior at the pin) | Host: `git checkout $PREV && npm ci && npm run build:os-runtime`; if 5.6 replaced units, restore them: `sudo cp /root/preston-unit-backup/preston-worker.* /etc/systemd/system/ && sudo systemctl daemon-reload`; re-run preflight. Dashboard: Vercel -> promote/redeploy the PREVIOUS production deployment recorded in 3.6. The applied migration may stay (inert). |
| 8.3 Worker crash loop | The timer fires a bounded oneshot (RuntimeMaxSec=300, no Restart=), so no tight loop; still: disable the timer, read `/var/log/preston/worker.log`, keep `owner_stop=true` until diagnosed. |
| 8.4 Incorrect approval behavior (any 4.7 or drill 8-12 deviation) | Global kill. Approvals are decide-once and expiring - do NOT fix rows by hand. Record the approval id + returned row; treat as a code/DB defect gate. |
| 8.5 Duplicate execution / duplicate goal / lease violation | Global kill. Preserve rows (DELETE is revoked anyway). Capture `run_id`s + `attempts`; a fencing violation = NO-GO until root-caused. |
| 8.6 Stale lease / pause-resume anomaly | Disable the timer; wait out `run_lease_expires_at`; run ONE oneshot; verify expired-lease requeue. If wrong, global kill + defect gate. |
| 8.7 Health/preflight failure | Exit 78 = env NAMES/staging-allowlist issue - fix names only (never values in shell history), re-run. Other exits: node presence, build output, log tail. Nothing was started; nothing to roll back. |
| 8.8 Unauthorized privilege discovered (4.6 e/f/g deviates) | Do NOT proceed and do NOT revoke ad hoc; the finding invalidates the migration gate. Global-kill posture, report, corrected-migration gate. |
| 8.9 Unexpected external write attempt (drill 21) | FULL global kill + incident note (what/when/which table or service). Send paths are structurally absent in this build - any evidence of one is a critical defect: freeze the host (timers disabled), preserve logs, no cleanup that destroys evidence. |
| 8.10 Owner loses remote control | Controls fail closed: every oneshot halts (exit 75) on `owner_stop`/`paused` even if the host is briefly unreachable. Regain control from any device via the Supabase SQL editor kill row. Host restored -> disable timers. The Vercel dashboard is independent of the host. |

## 9. FINAL GO/NO-GO MATRIX

| Boundary | Verdict | Unmet condition (if not GO) |
|---|---|---|
| Local implementation | CONDITIONAL GO | `orchestrate-once` dispatcher command + readiness surfacing not implemented (one small LOCAL gate); two test-file-only tsc errors to clean up in the same gate. Everything else verified green. |
| Commit quality | GO | - |
| Push (3.3) | GO | - |
| Merge (3.5, ff-only) | GO | run AFTER section 4 per the execution order |
| Staging migration (4) | GO | 4.2 sentinels + 4.3 backup first |
| Deployment (5) | GO | dashboard + dispatcher deploy fully; goal-driving waits on the local gate |
| Simulation activation (6) | CONDITIONAL GO | Gate 6A (Phase-5 worker re-validation) available now; Gate 6B (Phase-7 goal driving) BLOCKED on `orchestrate-once` |
| Phone/laptop-closed drill (7) | NO-GO | steps 11-19 need Gate 6B; drill runs only after sections 3-6 complete in order |
| Remote-Live staging | NO-GO | requires the full 21-step drill PASS |
| Production activation | NO-GO | separate owner-approved RED gate; also blocked by backup/LA-10 closure + production-readiness blockers P1-P22 |

## 10. FINAL PERCENTAGES

- Bridge completion: 88% (all bridge logic, migration, tests, and this
  packet done and re-verified; remaining: the `orchestrate-once` +
  readiness wiring gate, then owner-run live boundaries).
- Remote-Live readiness: 60% (code + packet ready; migration not applied,
  nothing deployed at `$TIP`, activation gates open, drill not run).
- Overall Preston AI OS completion: 55% (durable simulation orchestration
  built and bridge-ready; real-agent execution, business go-live, knowledge
  layer, and all production gates remain).

## 11. CODEX FINAL AUDIT DISPOSITION (read-only audit of this packet)

11 substantive findings; every one reconciled in this version:

1. BLOCKER - audited file was uncommitted -> resolved by the finalization
   commit (`$TIP`); the git sequence approves the committed packet.
2. CRITICAL - checksum step used `git checkout --` (working-tree
   overwrite) -> replaced with read-only `rev-parse` blob check + file
   hash of the clean feature worktree (4.4).
3. CRITICAL - master push triggered Vercel deploy BEFORE the migration ->
   execution order restructured: section 4 now runs between 3.3 and 3.5;
   branch-preview fail-closed window documented (3.3).
4. MAJOR - activation checklist contained an impossible mandatory box next
   to a runnable command -> split into Gate 6A (available) and Gate 6B
   (explicitly command-less and blocked).
5. MAJOR - preflight overstated as "readiness green" -> preflight scope
   stated precisely; exact controls-posture SQL with expected values added
   (5.7/5.8); readiness read model documented as library-only.
6. MAJOR - unit-file rollback missing -> unit backup before overwrite +
   restore + daemon-reload in 8.2; Vercel previous-deployment rollback
   recorded at 3.6 and used in 8.2.
7. MAJOR - predecessor migrations unverified -> object-level sentinel gate
   for 0001/0002/0004/0005/0006/0009 with hard stop (4.2); no-ledger
   reality documented (section 2).
8. MAJOR - "re-runnable" overstated; mixed slate unhandled -> precise
   idempotency statement (section 2) + explicit HARD STOP on any partial
   five-table subset (4.2, 8.1).
9. MAJOR - B1-B4 were prose -> replaced with exact executable SQL with
   fixed drill UUIDs, expected outputs, and fixture-hygiene rules (4.7).
10. MINOR - unconditional systemd unit overwrite -> diff-gated, backed up
    (5.6).
11. MINOR - "rollback" mislabeled for the migration -> section 8 retitled
    and its honest scope stated up front.

Confirmed by the same audit: migration blob + SHA-256 match the repo; the
dispatcher command surface and the `driveGoal`/`loadBridgeReadiness` gap
are exactly as stated; no command in this packet targets production,
enables execution or the remote runner, prints a credential value, sends a
business message, or activates Hermes.
