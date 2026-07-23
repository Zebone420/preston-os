# PHASE 7 - REMOTE BRIDGE GO-LIVE PACKET (owner-run)

Date: 2026-07-22. Branch: `phase7/reconcile-approval-enforcement` (6 commits,
NOT merged to master, NOT pushed, migration NOT applied). This packet is the
exact owner-run path to turn the locally-built, tested, and independently-
reviewed bridge into a live, laptop-closed, owner-supervised control plane.
Claude performs NONE of these steps - each is an owner-only boundary.

Supersedes the migration verification block in
`reports/PHASE_7_MIGRATION_0010_FINAL_OWNER_PACKET.md` (the migration has since
gained the fencing/lease columns, the two functions, and the constrained
approval INSERT policy described below).

## 0. What is built (local, verified, simulation-only)

Six commits on the branch, each Codex-reviewed and full-suite green (846/846):
| Commit | Content |
|---|---|
| 291d050 | Migration 0010 approval-enforcement hardening (atomic decomposition RPC, clock_timestamp expiry, idempotency, decision RPC) |
| 4742929 | Worktree-lock store -> real repository_worktrees schema + monotonic fence (ABA/legacy closed) |
| ad41e00 | Durable driver: run_id execution lease, fencing, restart recovery, iteration hard-cap |
| 2478a4f | Canonical SHA-256 approval->execution binding, execution-time expiry, atomic clearance, DB-forge closed |
| 7a53210 | Bridge end-to-end gate + gated-job parking |
| a01bb4e | Durable evidence persistence + bridge readiness/health |

Nothing here can enable execution, sending, or production behavior. All jobs
are executed=false; environment is CHECK-pinned to 'staging'; controls default
to execution_enabled=false, remote_runner_enabled=false, hermes=observe_only.

## 1. Migration 0010 - objects to apply (additive, clean-first-run)

Apply `supabase/migrations/0010_phase7_orchestration.sql` (the branch version)
ONCE in the Supabase STAGING SQL editor. In addition to the five base tables
(master_goals, goal_jobs, job_dependencies, agent_contracts,
orchestration_approvals), the branch migration now also creates/alters:

- master_goals: `iteration` column + `uq_master_goals_correlation` unique index.
- goal_jobs: `run_id`, `run_lease_expires_at` (execution lease) columns.
- repository_worktrees (0004 table): `fence`, `allowed_paths`,
  `lease_expires_at` columns (additive).
- Functions: `public.submit_goal_decomposition(jsonb,jsonb,jsonb)` (SECURITY
  INVOKER, atomic decomposition) and `public.decide_orchestration_approval(
  text,text,text)` (SECURITY DEFINER, the ONLY approval-decision path).
- orchestration_approvals INSERT policy CONSTRAINED to
  `is_owner() AND status='pending' AND nonce is null AND decided_at is null`
  (a pre-approved row can never be inserted directly).

### Owner steps
1. Supabase STAGING -> SQL Editor -> new query.
2. Paste the ENTIRE branch `0010_phase7_orchestration.sql`. Run ONCE.
3. Expect success, no errors (every statement is create/alter ... if not exists
   or a guarded do-block).
4. ONLY AFTER success, run the verification block (section 2) as a SEPARATE
   query. WARNING: run the full migration BEFORE the verification block.

## 2. Migration verification SQL (run AFTER the migration succeeds)

```
-- 2a five tables (expect 5)
select count(*) from information_schema.tables where table_schema='public'
 and table_name in ('master_goals','goal_jobs','job_dependencies','agent_contracts','orchestration_approvals');
-- 2b execution-lease columns on goal_jobs (expect 2)
select count(*) from information_schema.columns where table_name='goal_jobs'
 and column_name in ('run_id','run_lease_expires_at');
-- 2c worktree fencing columns (expect 3)
select count(*) from information_schema.columns where table_name='repository_worktrees'
 and column_name in ('fence','allowed_paths','lease_expires_at');
-- 2d the two functions (expect 2)
select count(*) from pg_proc where proname in ('submit_goal_decomposition','decide_orchestration_approval');
-- 2e approval INSERT policy is pending/undecided-constrained (expect the AND chain)
select pg_get_expr(polwithcheck, polrelid) from pg_policy
 where polrelid='orchestration_approvals'::regclass and polcmd='a';
-- 2f no direct UPDATE on approvals (expect 0 rows)
select 1 from information_schema.role_table_grants
 where table_name='orchestration_approvals' and grantee='authenticated' and privilege_type='UPDATE';
-- 2g anon holds nothing on the five new tables (expect 0)
select count(*) from information_schema.role_table_grants where grantee='anon'
 and table_name in ('master_goals','goal_jobs','job_dependencies','agent_contracts','orchestration_approvals');
```
Report the results. On all-pass, MIGRATION 0010 is applied.

## 3. Behavioral checks (run on the applied staging DB - proves what the
## fake-client tests cannot)

Run each as owner SQL; these prove the real DB enforcement the local suite
documents but cannot execute:
- B1 idempotent decomposition: call `submit_goal_decomposition` twice with the
  same correlation_id -> second returns {created:false}; conflicting id/corr ->
  idempotency_conflict.
- B2 approval decision: `decide_orchestration_approval` on a pending row ->
  approved; a second call -> not_pending; a call after expires_at -> expired
  (clock_timestamp, post-lock).
- B3 forge attempt: try to INSERT an approval with status='approved' -> REJECTED
  by the INSERT policy.
- B4 unique constraints: duplicate master_goals.correlation_id -> rejected.

## 4. Worker deployment (owner-run, disabled-by-default)

Reuse the Phase-5 systemd oneshot + token-store pattern (deployment packet):
1. Build `npm run build:os-runtime` from the pinned branch commit on the host.
2. Add a bounded `orchestrate-once` dispatcher command that calls `driveGoal`
   for the oldest non-terminal goal under the owner-scoped SUPABASE_RUNTIME
   identity (never service-role). It MUST pass a UNIQUE per-invocation token
   (DriverLockContext.token) and let driveGoal mint run_ids via crypto.randomUUID
   (the default). Exit codes reuse Phase-5 (0 / 75 halted / 70 error / 78 config).
3. Install as an owner-run systemd oneshot + timer, DISABLED by default.
4. Enable the timer ONLY when validating; it advances SIMULATION jobs while
   execution_enabled stays false.

## 5. The 17-point bridge drill (phone-operated, laptop-closed)

Map each gate point to its live verification. Points marked [sim-proven] already
pass in the local suite; the drill proves them against the real DB/host/phone.

| # | Gate point | Live verification |
|---|---|---|
| 1 | Authenticated intake | issue a command as owner via the intake path; a non-owner/replayed/expired command is refused [sim-proven] |
| 2 | Durable persistence | goal/job rows persist across a worker restart (real DB) |
| 3 | Idempotent goal | submit the same command twice -> one goal (B1) |
| 4 | Decomposition | jobs + dependency edges persist |
| 5 | Approval blocks | a RED job parks at awaiting_approval, worker never self-approves [sim-proven] |
| 6 | Owner-only decision | decide via decide_orchestration_approval; is_owner enforced (B2) |
| 7 | Exact hash verify | tamper a bound field -> refused; correct canonical hash -> cleared [sim-proven] |
| 8 | Execution-time expiry | approve, wait past expiry, run -> refused (B2) [sim-proven] |
| 9 | Bounded claim | job claimed under a run_id lease [sim-proven] |
| 10 | Controlled assignment | assigned_role honored [sim-proven] |
| 11 | Durable result + evidence | completed job carries an evidence ref [sim-proven] |
| 12 | Checkpoint/failure | status/lease is the restart checkpoint; failure_reason persists |
| 13 | Health/readiness | query loadBridgeReadiness from the phone -> simulation_ready/halted/etc. [sim-proven] |
| 14 | Global kill / owner_stop | set owner_stop from the phone (owner SQL) -> worker halts exit 75 [sim-proven] |
| 15 | Restart recovery | kill the oneshot mid-goal; rerun; completed jobs not re-run; goal completes |
| 16 | Laptop-closed | close the laptop; the host oneshot+timer continues; control from the phone |
| 17 | No external write | goal_jobs.executed stays false; no email/Telegram/Airtable/quote sent |

## 6. Rollback

Additive migration; the tables/columns/functions are inert if unused. Disable
the timer to stop the worker. Removal is owner-composed SQL (destructive
statements kept out of tracked files). Reverting the app does not require
dropping objects.

## 7. Owner-only GO/NO-GO gates (Claude will NOT cross these)

- G1 Apply migration 0010 to staging: owner-only.
- G2 Deploy the oneshot worker (disabled): owner-only.
- G3 Enable the validation timer (simulation, execution still off): owner-only.
- G4 Run the 17-point laptop-closed drill: owner-only.
- G5 Merge the branch to master / push: owner-only (requires branch review).
- Any RED activation (execution_enabled=true, remote_runner_enabled=true,
  hermes active, real messages): a SEPARATE owner-approved RED gate, never in
  this packet.

## 8. Remaining local follow-ups (non-blocking, documented)

- Command Center UI: suppress/label summary counts when the read-model bucket
  state is 'error' (deferred per bridge-first priority; the remote readiness
  signal is already fail-closed).
- Belt-and-suspenders atomic three-row RPC for the approval-clearance requested_by
  TOCTOU and a DB jsonb-append RPC for evidence (both accepted as MINOR for the
  simulation-only single-worker scope).
- Wire the real notification/transport (Telegram/ChatGPT) intake+decision path
  (intake + decision LOGIC exist; transport delivery is a separate integration).
- App-layer decideApproval is superseded by the decide_orchestration_approval
  RPC in the durable path.
