# PHASE 7 - BRIDGE GO-LIVE PACKET (FINAL, owner-run)

Date: 2026-07-23 (revision 2, orchestrate-once local gate complete).
Status: AUTHORITATIVE. Supersedes the 2026-07-23 revision 1 of this file
and the migration block of
`reports/PHASE_7_MIGRATION_0010_FINAL_OWNER_PACKET.md`.

Codex audit history: (a) the revision-1 packet audit (11 findings, all
reconciled - section 11); (b) an initial read-only architecture/security
review of the orchestrate-once design (8 findings, all reconciled -
section 12); (c) a final read-only review of the real implementation
diff + tests (2 MAJOR + 1 MINOR, all reconciled and re-confirmed -
section 12). Zero unreconciled blocker/critical/major findings remain.

WHAT CHANGED IN REVISION 2: the two verified gaps of revision 1 are
CLOSED locally. The deployed dispatcher now has an `orchestrate-once`
command that drives Phase-7 goals through the existing durable driver
(simulation-only), `loadBridgeReadiness` is exposed on the owner-only
`GET /api/os/status` route, the two lagging test-file typing issues are
repaired (no suppression), a `preston-orchestrator` systemd unit pair
exists, and Gate 6B + the drill below are fully specified with no
blocked steps. Owner-run boundaries (migration, merge, Vercel + host
deployment at the new `$TIP`, activation, drill) remain owner-run.

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
| cad21d2 | revision-1 finalized packet (docs only) | this file |
| d4ce7c3 | driver by-id goal load, provable-complete job reads (1001-cap), parked short-circuit BEFORE iteration reserve, distinct controls_unreadable vs owner_stop_or_paused reasons | driver.ts, orchestration/store.ts (readGoalById, listGoalsByStatus, listDependenciesForGoal, probeSimulationPinViolations), read-model.ts (shared migration-absent classifier), orchestration-driver.test |
| 1f11d98 | `orchestrate-once` dispatcher command: bounded single-goal durable drive, fail-closed config/control/selection/completeness gates, exit mapping, 27-test focused suite | os-runtime/dispatcher.ts, test/orchestrate-once.test.ts |
| 9de4611 | owner-only `GET /api/os/status` now carries `orchestration` = loadBridgeReadiness (no new subsystem, no anon access) | api/os/status/route.ts, os-routes-auth.test |
| 908180b | typing repairs, no suppression: OwnerGateInput.userEmail admits undefined (fail-closed unchanged), read-model test fake gains full update guard-chain | owner-auth.ts, orchestration-read-model.test |
| 8af0b13 | preston-orchestrator systemd unit pair (disabled, hardened, SuccessExitStatus=75), flock token-store serialization on worker + orchestrator, ORCH env NAMES, preflight name report, unit pins | deploy/systemd (3 files), deploy/preflight-health.sh, env.template, systemd-units.test |
| `$TIP` | THIS revision-2 packet (docs only) | this file |

Validation matrix, re-run 2026-07-23 at the revision-2 branch head on this
machine (after the orchestrate-once gate):

| Check | Result |
|---|---|
| Full vitest suite | 879 tests: 874 pass, 5 fail - ALL 5 are `worktree-prep.test.ts` shelling to `bash` (Windows PATH env limitation, documented since Phase 5; compensated below). Owner-environment runs show all-pass. |
| Compensating Git Bash checks | `bash -n` on worktree_prepare.sh / secret_scan.sh / red_boundary_scan.sh / preflight-health.sh: 4/4 OK |
| Focused orchestrate-once suite | 27/27 pass (test/orchestrate-once.test.ts: routing, config gates, control gates, selection, full drive, approvals, leases/locks/recovery, completeness boundaries, containment) |
| Bridge end-to-end tests | 9/9 pass (orchestration-bridge-e2e.test.ts) |
| Orchestration/migration/driver/durable/drills/security-regression suites | 220/220 pass across 15 files |
| os-runtime build (`npm run build:os-runtime`, tsc strict) | PASS; compiled `bin.js orchestrate-once` startup proven: exits 78 fail-closed with redacted structured log when runtime env is absent |
| Lint (`npm run lint`) | PASS (0 errors, 0 warnings) |
| Next.js production build (`npm run build`) | PASS inside the feature worktree itself. The node_modules junction was replaced by a real `npm ci` install (valid non-junction environment), removing the revision-1 caveat. All routes compile; /os and /os/orchestration dynamic. |
| App-graph `tsc --noEmit` (includes test files) | PASS, 0 errors. Both revision-1 lagging test-file errors repaired at the source (no suppression, no exclusion): `owner-auth.ts` OwnerGateInput.userEmail now admits `undefined` (fail-closed behavior unchanged; pins the undefined-session case), and the `orchestration-read-model.test.ts` fake gained the full update guard-chain (eq/lte/gt). |
| secret_scan.sh (worktree root) | 0 findings |
| red_boundary_scan.sh (worktree root) | 0 findings |

Codex disposition: the P7-CX-01 adversarial package (23 security-regression
tests) is integrated at `e1a6467` (in master ancestry); its two
expected-fail defects (forged approval_id unlock; re-entrant worktree
rebind) were reproduced, FIXED, and pinned by now-passing tests. Branch
commits were Codex-reviewed during the build sessions. The final packet
audit findings and dispositions are in section 11 - zero unreconciled
blocker/critical/major findings remain.

THE TWO REVISION-1 GAPS ARE CLOSED (this revision's local gate):

- `orchestrate-once` dispatcher command: the deployed dispatcher surface
  is now `health | db-health | worker-loop | hermes-loop |
  orchestrate-once`. One bounded invocation selects AT MOST ONE eligible
  non-terminal simulation goal (status decomposed/running/blocked,
  DETERMINISTIC oldest-first per status - no starvation window) and
  advances it via the existing `driveGoal` durable driver under the
  owner-scoped runtime identity. Fail-closed gates, in order: runtime env
  + staging allowlist + production-URL refusal (78); ORCH_BASE_COMMIT
  7-40 hex and ORCH_ALLOWED_PATHS relative/no-traversal (78); controls
  unreadable (70); owner_stop/paused (75); execution_enabled or
  remote_runner_enabled true = unsafe posture for a simulation-only
  command (78); migration 0010 absent (78); GLOBAL simulation-pin probe -
  any master_goals row with simulation_only=false anywhere refuses the
  whole run (70); unprovably-complete job (>1000 rows) or dependency-edge
  (bound-filling) reads (70). Worktree locks use a crypto-random
  per-invocation token; run ids are minted by the driver itself
  (crypto.randomUUID). A goal parked on owner approvals is SKIPPED
  without burning its iteration budget (both a dispatcher fast path and
  a driver-level short-circuit BEFORE the iteration reserve). Exit codes:
  0 ok/no-op/bounded-progress/parked, 75 owner halt, 70 outage or
  ambiguous state, 78 configuration.
- `loadBridgeReadiness` is exposed on the EXISTING owner-only
  authenticated route `GET /api/os/status` as the `orchestration` field
  (same session auth + allowlist re-check as every /api/os route; no new
  subsystem, no anonymous access, no duplicate read model). The owner
  reads migration state, control posture, simulation-safety, and backlog
  from the deployed dashboard - phone-friendly, laptop closed.

Also in this gate: `preston-orchestrator.service/.timer` unit pair
(disabled, hardened, oneshot; details in Gate 6B), flock serialization of
the shared rotating refresh-token store across worker + orchestrator
oneshots, ORCH_* env NAMES in env.template + preflight name report, and
the two test-file typing repairs. Goal submission, decomposition
persistence, approval issuance/decision, and all read models continue to
work via the dashboard action + SQL RPCs.

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
`apps/dashboard/src/lib/ai-os/`, `apps/dashboard/src/os-runtime/`,
`apps/dashboard/src/app/api/os/status/route.ts`,
`apps/dashboard/src/lib/owner-auth.ts`, `apps/dashboard/test/`,
`supabase/migrations/0010_phase7_orchestration.sql`, `deploy/`,
`env.template`, `reports/` appears in the stat, or the tip is not the
revision-2 packet docs commit.

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
# Phase 7: verify the two NEW names exist in worker.env (owner adds the
# VALUES: ORCH_BASE_COMMIT=$TIP, ORCH_ALLOWED_PATHS=apps/dashboard/).
sudo grep -cE '^ORCH_BASE_COMMIT=' /etc/preston/worker.env
sudo grep -cE '^ORCH_ALLOWED_PATHS=' /etc/preston/worker.env
```
EXPECT: owner `preston-worker`, mode `600`; both greps return 1. STOP IF
group/world readable. If the ORCH names are absent, add them (values:
the pinned commit hash and a comma list of RELATIVE path prefixes) -
orchestrate-once fails closed (exit 78) without them.

```bash
# 5.6 Systemd units: compare first; back up + refresh ONLY if changed.
# The worker service CHANGED in revision 2 (flock serialization) and the
# orchestrator pair is NEW - expect diffs on first deployment at $TIP.
diff /etc/systemd/system/preston-worker.service /srv/preston-os/deploy/systemd/preston-worker.service
diff /etc/systemd/system/preston-worker.timer /srv/preston-os/deploy/systemd/preston-worker.timer
ls /etc/systemd/system/preston-orchestrator.* 2>/dev/null
# ONLY if a diff is non-empty (or the orchestrator units are absent):
sudo mkdir -p /root/preston-unit-backup && sudo cp /etc/systemd/system/preston-worker.* /root/preston-unit-backup/
sudo cp /srv/preston-os/deploy/systemd/preston-worker.service /etc/systemd/system/
sudo cp /srv/preston-os/deploy/systemd/preston-worker.timer /etc/systemd/system/
sudo cp /srv/preston-os/deploy/systemd/preston-orchestrator.service /etc/systemd/system/
sudo cp /srv/preston-os/deploy/systemd/preston-orchestrator.timer /etc/systemd/system/
sudo systemctl daemon-reload
# Always verify nothing is enabled/active:
systemctl is-enabled preston-worker.timer preston-orchestrator.timer preston-hermes-observe.timer
systemctl is-active preston-worker.service preston-orchestrator.service preston-hermes-observe.service
```
EXPECT: timers `disabled` (or hermes as previously owner-set to
observe-only), services `inactive`. STOP IF anything auto-started.
NOTE: the worker and orchestrator share ONE runtime identity and ONE
rotating refresh-token store; their oneshots serialize on
`/var/lib/preston/worker/.dispatch.lock` (flock, enforced in both unit
files). Even so, enable AT MOST ONE of the two timers at a time.

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
owner_stop/paused). It cannot advance Phase-7 goals. Disable this timer
BEFORE crossing Gate 6B (one worker-identity timer at a time; the flock
in both units enforces serialization, the single-timer rule keeps the
schedule unambiguous).

### Gate 6B - Phase-7 goal-driving activation (RUNNABLE in this revision)

Preconditions - ALL boxes must be checked before the activation command:

- [x] `orchestrate-once` dispatcher command implemented + tested +
      readiness on the owner status route (THIS revision, commits
      d4ce7c3..`$TIP`). Deployment at the new `$TIP` is owner-run
      (sections 3-5).
- [ ] Migration 0010 applied + verified (4.6) + behaviorally verified (4.7).
- [ ] Host and Vercel deployments at the same pin (`$TIP`).
- [ ] Preflight PASS + 5.8 posture exact + ORCH_* names present (5.5).
- [ ] Deployed unit files match the repo (5.6), orchestrator pair
      installed, all timers disabled, `preston-worker.timer` NOT enabled
      while driving Phase-7 goals.
- [ ] Approval path verified RPC-only (4.7 B2/B3).
- [ ] Pause/stop/kill verified from the phone (5.8 row readable; global
      kill SQL from `docs/PRESTON_AI_EMERGENCY_SHUTOFF_SPEC_v1.md` at hand).
- [ ] No secrets exposed (5.5), no unauthorized grants (4.6 e/f/g), no
      external-write capability (`executed` CHECK-pinned false;
      `execution_enabled=false`).
- [ ] Rollback commands ready (section 8).

THE DEPLOYED UNIT: `preston-orchestrator.service` - oneshot, hardened
(ProtectSystem=strict, NoNewPrivileges, RuntimeMaxSec=300, no [Install]),
runs as the existing `preston-worker` identity with `worker.env`, and
executes:

```
/usr/bin/flock -w 90 /var/lib/preston/worker/.dispatch.lock \
  /usr/bin/node dist/os-runtime/bin.js orchestrate-once --max 10
```

`SuccessExitStatus=75` on this unit only: an owner stop/pause halt is a
HEALTHY state, not a unit failure (an unreadable control plane exits 70
and DOES fail the unit).

THE OWNER ACTIVATION COMMAND (one bounded pass per invocation; use this
for the drill - each drill step that says "run the oneshot" means exactly
this command):

```bash
sudo systemctl start preston-orchestrator.service
systemctl show -p ExecMainStatus preston-orchestrator.service   # exit code
sudo tail -n 5 /var/log/preston/orchestrator.log                # JSON summary
```

RECURRING activation (OPTIONAL, only after the section-7 drill PASSES;
never together with the worker timer):

```bash
sudo systemctl disable --now preston-worker.timer
sudo systemctl enable --now preston-orchestrator.timer
```

Deactivation mirror: `sudo systemctl disable --now
preston-orchestrator.timer`. Exit codes: 0 = ok / no eligible goal /
bounded progress / parked awaiting the owner; 75 = owner_stop or paused;
70 = outage or ambiguous state (controls/pin/read failures); 78 =
configuration (env names, unsafe posture, migration absent).

## 7. PHONE + LAPTOP-CLOSED DRILL (owner-operated; runs after the Gate 6B
## checklist is fully checked - NO step is blocked in this revision)

Preconditions: phone SSH (key-based) to the staging host; owner login to
the Supabase dashboard and the Vercel-deployed dashboard. Steps marked
[RUN] invoke the Gate 6B oneshot:
`sudo systemctl start preston-orchestrator.service`, then read the exit
code via `systemctl show -p ExecMainStatus preston-orchestrator.service`
and the JSON summary via
`sudo tail -n 5 /var/log/preston/orchestrator.log`. The drill PASSES only
as a whole, in order, laptop closed throughout.

For every step: on FAILURE, stop the drill, run the stop action, record
evidence, do not proceed.

Bridge readiness is remotely inspectable at ANY step: the deployed
dashboard's owner session can read `GET /api/os/status` - the
`orchestration` field reports migration_applied, controls, simulation
safety, and backlog; `status` must be `simulation_ready` while driving
(or `halted` during steps 15-18).

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
| 11 | Expired approval fails at execution | Approve a second gated job, let `expires_at` pass, then [RUN] | Clearance refused, job stays parked (`awaiting_approval`), exit 0 | 8.4 |
| 12 | Hash binding | Tamper one bound field in a test-goal approval scenario, then [RUN] | Refused on hash mismatch (stays parked); untampered path clears | 8.4 |
| 13 | Bounded claim | [RUN]; SQL: `select run_id, run_lease_expires_at, status from goal_jobs where goal_id='<goal>';` | Only the permitted ready job(s) claimed, each under a run_id lease | 8.5 |
| 14 | Evidence + result | SQL: `select status, evidence_refs, executed from goal_jobs where id='<job>';` | `completed`, non-empty run-bound evidence ref, `executed=false` | 8.4 |
| 15 | Pause prevents claims | Shutoff-spec SQL sets `paused=true`; [RUN] | ExecMainStatus=75 (unit reports success - SuccessExitStatus), no new `run_id` stamped | 8.6 |
| 16 | Resume | Shutoff-spec SQL sets `paused=false`; [RUN] | Claims resume | 8.6 |
| 17 | Owner stop halts flow | Shutoff-spec SQL sets `owner_stop=true`; [RUN] | ExecMainStatus=75, nothing persisted | 8.6 |
| 18 | Global kill leaves nothing | Full kill SQL (shutoff spec) + `sudo systemctl disable --now preston-worker.timer preston-orchestrator.timer`; then `systemctl is-active preston-worker.service preston-orchestrator.service; pgrep -f os-runtime` | No Preston runtime process; timers disabled | 8.10 |
| 19 | Restart recovery | Clear the kill row, start a multi-job goal, kill the oneshot mid-run (`sudo systemctl kill preston-orchestrator.service`), wait out `run_lease_expires_at`, then [RUN] again | Completed jobs NOT re-run (attempts unchanged); expired-lease job requeued and finishes; goal completes | 8.5 |
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
preston-orchestrator.timer preston-hermes-observe.timer`.

| Scenario | Containment / rollback |
|---|---|
| 8.1 Migration failure (4.2 mixed slate, 4.5 error, or 4.6 mismatch) | STOP all SQL. A partial apply leaves inert objects, not corruption. Capture the exact error + failing verification letters. Do NOT hand-craft repair DDL and do NOT re-run the file over a partial state. Report for a corrected-migration gate. Diagnose via the 4.3 dump in a SCRATCH project only. |
| 8.2 Deployment failure (5.4 or bad behavior at the pin) | Host: `git checkout $PREV && npm ci && npm run build:os-runtime`; if 5.6 replaced units, restore them: `sudo cp /root/preston-unit-backup/preston-worker.* /etc/systemd/system/`, remove the new pair if reverting fully (`sudo rm /etc/systemd/system/preston-orchestrator.service /etc/systemd/system/preston-orchestrator.timer`), then `sudo systemctl daemon-reload`; re-run preflight. Dashboard: Vercel -> promote/redeploy the PREVIOUS production deployment recorded in 3.6. The applied migration may stay (inert). |
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
| Local implementation | GO | complete: orchestrate-once + readiness surfacing implemented, tested, Codex-reviewed twice + confirmation pass; app-graph tsc 0 errors; Next build passes in the worktree itself |
| Commit quality | GO | - |
| Push (3.3) | GO | - |
| Merge (3.5, ff-only) | GO | run AFTER section 4 per the execution order |
| Staging migration (4) | GO | 4.2 sentinels + 4.3 backup first |
| Deployment (5) | GO | includes the ORCH_* env names (5.5) and the revised/new unit files (5.6) |
| Simulation activation (6) | GO | Gate 6A optional; Gate 6B runnable once its checklist boxes (migration, same-pin deployments, preflight, posture, units) are all checked |
| Phone/laptop-closed drill (7) | CONDITIONAL GO | runnable with NO blocked steps; requires sections 3-6 complete in order and Gate 6B crossed first |
| Remote-Live staging | NO-GO | requires the full 21-step drill PASS |
| Production activation | NO-GO | separate owner-approved RED gate; also blocked by backup/LA-10 closure + production-readiness blockers P1-P22 |

## 10. FINAL PERCENTAGES

- Bridge implementation (local scope: code + tests + packet): 100%
  (both revision-1 gaps closed; zero unreconciled Codex findings; all
  local validation matrices green).
- Remote-Live staging bridge: 65% (everything local done; migration not
  applied, nothing deployed at the new `$TIP`, Gate 6B boxes unchecked,
  21-step drill not run - all owner-run).
- Overall Preston AI OS completion: 57% (durable simulation
  orchestration built, wired, and deployable; real-agent execution,
  business go-live, knowledge layer, and all production gates remain).

## 11. CODEX REVISION-1 PACKET AUDIT DISPOSITION (read-only, historical)

11 substantive findings; every one reconciled in revision 1:

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
were exactly as stated at revision 1 (both closed in revision 2); no
command in this packet targets production, enables execution or the
remote runner, prints a credential value, sends a business message, or
activates Hermes.

## 12. CODEX ORCHESTRATE-ONCE REVIEWS (this revision's local gate)

Two mandated read-only Codex runs plus a confirmation pass; every
blocker/critical/major finding reconciled in code, with tests pinning
each fix.

INITIAL architecture/security review (pre-implementation design +
partial diff) - 8 findings, all reconciled:

1. CRITICAL - bounded job reads (500) below the 1000-job model/DB cap
   could finalize a goal with unread jobs -> reads now use
   JOB_READ_LIMIT=1001 and REFUSE when the row count exceeds
   MAX_GOAL_JOBS (driver loadGoalState returns null; dispatcher exits
   70 `job graph overflow`). Boundary test: 1001 jobs.
2. MAJOR - dependency-edge reads could silently truncate -> bound raised
   to 10000 with an explicit full-read refusal (70). Boundary test:
   10000 edges.
3. MAJOR - a parked goal whose approval merely CLAIMS `approved` (but
   fails authoritative verification) would burn one iteration per timer
   tick to the durable cap -> the DRIVER now short-circuits
   `awaiting_owner_approval` BEFORE reserving an iteration whenever
   every non-terminal job is parked and nothing cleared; the dispatcher
   fast path remains as an optimization. Tests pin zero burn for both
   the undecided and the forged-approved cases.
4. MAJOR - "oldest goal" selection was oldest-of-the-newest-100 window
   (starvation) -> selection now reads OLDEST-FIRST per driveable
   status (listGoalsByStatus ascending) and merges, so the globally
   oldest driveable goal is always in the window.
5. MAJOR - documented-only mutual exclusion of the shared rotating
   refresh-token store -> ENFORCED serialization: worker and
   orchestrator ExecStart both wrap in
   `flock -w 90 /var/lib/preston/worker/.dispatch.lock`; unit tests pin
   the same lock file in both and its absence from hermes.
6. MAJOR - unsafe ORCH_ALLOWED_PATHS entries (absolute/traversal) were
   accepted and became doomed lock acquisitions -> validated at the
   config gate with the same rules as the lock layer; exit 78.
7. MINOR - `owner_stop_or_unreadable` conflated an owner halt with a
   control-plane outage -> distinct `owner_stop_or_paused` (75) and
   `controls_unreadable` (70) reasons end to end, incl. mid-run.
8. MINOR - exit 75 would mark the oneshot failed -> the orchestrator
   unit declares `SuccessExitStatus=75` (worker keeps its recorded
   Phase-5 decision unchanged).

Also answered by the initial review: no external execute/send path (the
simulation adapter pins executed:false); no owner_stop/pause/approval/
lease/fence bypass found; excluding `proposed` goals is sound; widening
OwnerGateInput.userEmail is a typing repair, not an authorization
change; readiness on the owner status route adds no anonymous exposure.

FINAL review (real implementation diff + tests) - verdict: the eight
reconciliations "materially present", approval/lease/fence/simulation
enforcement intact, no new external business-write path; 2 MAJOR +
1 MINOR new findings, all reconciled:

1. MAJOR - oldest-first selection could pick a goal the driver's
   newest-200 `listGoals` scan could not load -> `loadGoalState` now
   loads BY ID (`readGoalById`); test drives an old goal past 250 newer
   rows.
2. MAJOR - the simulation-pin refusal only covered the selection
   window -> a GLOBAL probe (`probeSimulationPinViolations`,
   `simulation_only=eq.false` limit 1) refuses the whole run on a hit
   anywhere in master_goals; the environment axis stays DB-CHECK-pinned
   plus window-checked (the eq-only read surface cannot express "not
   staging" globally - stated, not hidden). Test: pin violation on a
   TERMINAL (out-of-window) goal refuses the run.
3. MINOR - missing boundary tests -> added: 1001 jobs, 10000 edges,
   out-of-window pin violation, 250-newer-goals load, mid-run pause ->
   75 and mid-run controls outage -> 70.

CONFIRMATION pass verdict: all three findings RESOLVED; "PASS - no new
blocker, critical, or major defect found; TypeScript validation passes."
(The reviewer's own sandbox could not run vitest - read-only temp-dir
EPERM; the suites pass in this environment, matrix in section 1.)
