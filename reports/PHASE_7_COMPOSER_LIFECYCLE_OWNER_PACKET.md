# PHASE 7 - COMPOSER STAGING LIFECYCLE OWNER PACKET (REVISION 2)

Date: 2026-07-28 (revision 2, verification session). Status: AUTHORITATIVE
for the Goals/Tasks Request Composer staging rollout and the first
simulation-only staging Goal lifecycle run through it. Companion to
`reports/PHASE_7_BRIDGE_GOLIVE_PACKET.md` (sections 5-8 and the
section-13 addendum remain the authority for host deployment, Gate 6B,
the 21-step drill, and the ratified SQL drill method).

Revision 2 adds: dependency-ordered drill request (engine-pinned by test),
rejection-path check, expiry-path check, owner-stop/kill-switch check,
Hermes observe-only evidence, preflight command block, cleanup steps, and
consolidated pass/fail + stop conditions. It also updates the merge source
to the verification-session branch.

Nothing in this packet enables execution, sends, production writes,
credentials, or Hermes activity. Every boundary step is OWNER-RUN.

---

## 0. WHERE THE WORK IS (factual, verified in the verification session)

- Merge source branch: `claude/phase7-composer-staging-readiness-izxo25`
  (remote), a fast-forward superset of
  `claude/preston-composer-phase7-ccyea1`, built from `0c287b0`
  (= current `master` = current staging pin).
- Commits over master (in order):
  - `347d65c` feat(7): composer engine + persistence + UI + nav
  - `3f6995c` test(7): composer suites + d2 lint repair
  - `ea23bac` docs(7): this packet, revision 1
  - `209270a` feat(7): dashboard owner decision path (approve/reject
    buttons through the one-time owner-only 0010 RPC)
  - plus this revision's commits: the CL-3 drill-request engine pin test
    and this packet revision.
- NOT merged to master. NOT deployed to Vercel or the staging host.
  Staging remains pinned to `0c287b0`, which does NOT contain the
  composer.
- Validation at this revision (remote verification container, Linux,
  2026-07-28):
  - composer suites (engine, security, persist, UI, lifecycle,
    approval-decide): all pass
  - full vitest: 978 tests, 975 pass, 1 expected-fail (D2-L1 known-defect
    marker, unchanged); the ONLY 2 failures are the known environmental
    scanner self-scan timeouts in `worktree-prep.test.ts` (5s vitest
    timeout vs slow container I/O; both scanners pass standalone with
    0 findings - re-verified this session: secret scan 0 findings in
    11.5s, RED boundary scan 0 findings in 7.5s)
  - app-graph `tsc --noEmit` 0 errors; eslint 0 errors / 0 warnings
  - `npm run build` PASS (`/os/composer` compiles, dynamic)
  - `npm run build:os-runtime` PASS (`dist/os-runtime/bin.js` present)

### 0.1 IMPORTANT - local Windows worktree reconciliation

The July-28 checkpoint referenced local-only commits `8acb70d`
(navigation consolidation) and `a141055` (composer work-in-progress) in
`C:\dev\preston-os-worktrees\phase7-approval-reconcile`. NEITHER exists
on the remote (re-verified this session: no ref on origin contains
either hash; `origin/phase7/reconcile-approval-enforcement` points at
`0c287b0`). This composer was necessarily built WITHOUT them, directly
on `0c287b0`. Before merging, decide ONE of:

- (a) Adopt this completed composer; treat the local `a141055` WIP as
  superseded (review it once for anything worth porting, then retire it).
- (b) Push the local branch first and request a reconciliation pass.

Do NOT merge both lines blindly - they touch the same surfaces
(`/os/orchestration` page, goal-form flow).

---

## 1. EXPLICIT PROHIBITIONS (apply to every gate and step below)

The drill must NEVER involve any of the following; encountering a step
that seems to need one is a STOP condition, not a judgment call:

- production access of any kind (DB, host, DNS, Vercel prod env vars)
- external sends (email, SMS, WhatsApp, Telegram, ChatGPT relay)
- customer or client communication
- financial activity (payments, invoices, refunds, transfers)
- credential creation, rotation, exposure, or changes
- destructive operations (drops, deletes, truncations, file wipes)
- real Claude/Codex execution (contracts stay `worktree_only`; the
  simulated adapter with `executed=false` is the only execution surface)
- enabling the remote runner (`remote_runner_enabled` stays false)
- enabling unrestricted worker execution (`execution_enabled` stays
  false; the worker timer stays disabled)
- RLS weakening, grant widening, or approval-gate bypass
- force-push

---

## GATE CL-1 - LOCAL PUSH / MERGE GATE (owner-run, PowerShell, ZPC26)

Read-only until the merge. STOP at any mismatch. No force-push.

```powershell
# CL-1.1 fetch and review the branch (expect exactly 6 commits)
git -C C:\dev\preston-os fetch origin
git -C C:\dev\preston-os log --oneline master..origin/claude/phase7-composer-staging-readiness-izxo25
git -C C:\dev\preston-os diff --stat master...origin/claude/phase7-composer-staging-readiness-izxo25
git -C C:\dev\preston-os diff master...origin/claude/phase7-composer-staging-readiness-izxo25
```

STOP IF: more than these files appear in the stat:
`apps/dashboard/src/lib/ai-os/orchestration/composer.ts`,
`.../composer-persist.ts`, `apps/dashboard/src/app/os/composer/*` (4 files),
`apps/dashboard/src/app/os/page.tsx` (+1 nav line),
`apps/dashboard/src/app/os/orchestration/page.tsx` (nav line + pending
approve/reject buttons), `apps/dashboard/src/app/os/orchestration/actions.ts`
(new: goal submit + approval-decide server actions),
`apps/dashboard/test/composer-*.ts` (6 files),
`apps/dashboard/test/orchestration-approval-decide.test.ts`,
`apps/dashboard/test/orchestration-d2-local.test.ts` (1-line lint repair),
`reports/PHASE_7_COMPOSER_LIFECYCLE_OWNER_PACKET.md` (this file).

```powershell
# CL-1.2 merge fast-forward only and push (this TRIGGERS Vercel)
git -C C:\dev\preston-os checkout master
git -C C:\dev\preston-os merge --ff-only origin/claude/phase7-composer-staging-readiness-izxo25
git -C C:\dev\preston-os log --oneline -1        # record as $TIP
git -C C:\dev\preston-os push origin master
```

Expected: master fast-forwards to the branch tip (`$TIP`); Vercel builds
the dashboard at `$TIP`. Record the PREVIOUS Vercel deployment as the
rollback point. Rollback: Vercel "Redeploy" the previous deployment;
`git -C C:\dev\preston-os reset --keep <previous-master>` is NOT needed
unless you also want master back (then handle per section 8.2 of the
go-live packet - never force-push).

---

## GATE CL-2 - STAGING HOST DEPLOYMENT GATE (owner-run, phone/SSH ok)

Only needed for the orchestrator runtime to drive composer-created
goals; the dashboard itself deploys via Vercel in CL-1.2.

```bash
# CL-2.1 pin the host to the same $TIP (go-live packet 5.1-5.4 shape)
ssh preston-agent-staging
cd /srv/preston-os && git log --oneline -1          # record $PREV
git fetch origin && git checkout $TIP && git log --oneline -1
cd /srv/preston-os/apps/dashboard && npm ci && npm run build:os-runtime
ls dist/os-runtime/bin.js
```

STOP IF: checkout is not `$TIP` or the build fails (rollback:
`git checkout $PREV`, rebuild). Execution stays disabled; no timer is
enabled by this gate; env files untouched.

---

## GATE CL-3 - STAGING LIFECYCLE DRILL (owner-run, simulation only)

### CL-3.0 Preconditions and preflight (run BEFORE the drill)

Preconditions: CL-1 + CL-2 done; migration 0010 applied + verified
(DONE 2026-07-27/28 per the go-live packet section 13); worker timer
disabled; orchestrator/Hermes observation timers in their owner-approved
bounded state.

Preflight commands (SQL editor + SSH). STOP if any expectation fails:

```sql
-- P1 safety posture (expect: false, false, 'observe_only', false, false)
select execution_enabled, remote_runner_enabled, hermes_mode,
       owner_stop, paused
from system_controls where id = 'global';

-- P2 migration 0010 present (expect: both non-null)
select to_regclass('public.master_goals'), to_regclass('public.goal_jobs');

-- P3 nothing has ever really executed (expect 0)
select count(*) from goal_jobs where executed = true;
```

```bash
# P4 host pin + worker timer disabled + runtime built
cd /srv/preston-os && git log --oneline -1               # expect $TIP
systemctl is-enabled preston-worker.timer                # expect disabled
ls apps/dashboard/dist/os-runtime/bin.js                 # expect present
```

### CL-3.1 The drill request (paste into the composer VERBATIM)

> Create a staging-only goal to verify the Phase 7 dashboard status
> page. Create tasks to inspect the staging status data, then generate
> a simulation-only readiness summary, then attach internal evidence.
> Do not deploy, send messages, access production, change credentials,
> perform financial actions, or make external writes.

This exact request is PINNED by `test/composer-engine.test.ts`
("pins the CL-3 dependency-ordered drill request"): the engine is proven
to interpret it as 1 goal, 3 tasks with the sequential dependency chain
t1 <- t2 <- t3, all GREEN / auto-runnable-in-simulation, 0 approvals,
1 recorded constraint, proposal hash `5bd2ea4b`. It contains no external
capability and cannot trigger a real business action.

Expected interpreted proposal (what the preview must show):

| # | Kind | Task | Depends | Agent | Policy |
|---|---|---|---|---|---|
| t1 | audit | Inspect the staging status data | - | audit | GREEN - auto-runnable in simulation |
| t2 | documentation | Generate a simulation-only readiness summary | t1 | claude | GREEN - auto-runnable in simulation |
| t3 | documentation | Attach internal evidence | t2 | claude | GREEN - auto-runnable in simulation |

Plus: "0 requiring owner approval", the constraint sentence recorded
verbatim, banner "nothing created yet".

### CL-3.2 Lifecycle steps

| # | Step | Action | Expected | On failure |
|---|---|---|---|---|
| 1 | Open composer | Dashboard `/os/composer` (owner login) | Page loads; safety chips: execution false, remote_runner false, hermes observe_only | stop; check owner auth |
| 2 | Interpret | Paste CL-3.1 request, press "Interpret request" | Proposal preview exactly as the table above | stop; record the rejection codes |
| 3 | Nothing durable yet | SQL: `select count(*) from master_goals where title like 'Verify the Phase 7%';` | 0 | stop |
| 4 | Confirm | Press "Confirm & create (simulation)" | Success card: goal id, 3 job ids, no approval ids; banner says simulation-only | stop; note error codes |
| 5 | Durable graph | SQL: `select id,status,simulation_only,environment,requested_by from master_goals where id='<goal-id>'; select count(*) from goal_jobs where goal_id='<goal-id>'; select count(*) from job_dependencies where goal_id='<goal-id>';` | status decomposed, simulation_only true, staging, requested_by info@preston.nyc; 3 jobs; 2 dependency edges | 8.4 (go-live packet) |
| 6 | Duplicate confirm (idempotent replay) | Press "Confirm & create" again (or resubmit the same form) | "Already created (duplicate confirm)" - same ids; SQL counts from step 5 unchanged | 8.5 |
| 7 | Drive (simulation) | `sudo systemctl start preston-orchestrator.service` then `systemctl show -p ExecMainStatus preston-orchestrator.service` and `sudo tail -n 5 /var/log/preston/orchestrator.log` | Exit 0; jobs progress over 1-3 invocations | 8.5 |
| 8 | Dependency ordering | SQL: `select title, status, updated_at from goal_jobs where goal_id='<goal-id>' order by updated_at;` after each invocation | t1 completes before t2 starts; t2 before t3; a downstream job NEVER completes before its dependency | stop; record order |
| 9 | Evidence | SQL: `select status, evidence_refs, executed from goal_jobs where goal_id='<goal-id>';` | all completed, non-empty evidence_refs, executed=false on EVERY row | 8.4 |
| 10 | Dashboard state | `/os/orchestration` | Goal listed completed; counts consistent; `GET /api/os/status` orchestration field healthy | 8.4 |
| 11 | Hermes observe-only evidence | `sudo tail -n 20 /var/log/preston/hermes.log` and SQL posture check P1 | Hermes entries are observations only (no lease, no execution, no writes to goal_jobs attributed to Hermes); hermes_mode still observe_only | stop; FULL 8.9 containment |
| 12 | Safety posture | Re-run preflight P1 and P3 | Identical to preflight: false/false/observe_only/false/false; executed=true count still 0 | FULL 8.9 containment |

### CL-3b - gated-approval variant (approval + rejection + replay)

Request (paste verbatim):

> Create a staging-only goal to prepare the Phase 7 schema evidence.
> Create tasks to draft a schema migration plan for owner review, and
> summarize the plan in a local report.

Run this variant TWICE, with fresh interprets (two separate goals): once
deciding "approved" (steps A1-A8), once deciding "rejected" (steps
R1-R5). The migration-kind task is pinned by
`test/composer-engine.test.ts` ("classifies a migration task as gated")
to classify RED / owner-approval-required.

Approval path:

| # | Step | Expected |
|---|---|---|
| A1 | Interpret | 2 tasks; the migration-kind task shows "RED - owner approval required"; "1 requiring owner approval" |
| A2 | Confirm | Success card lists 1 approval id (`apr-...`) |
| A3 | Approval row | SQL: `select approval_id,status,owner_identity,job_id,expires_at from orchestration_approvals where approval_id='<apr-id>';` -> pending, info@preston.nyc, linked job, expires ~24h out |
| A4 | Blocks | Orchestrator oneshot: gated job -> awaiting_approval; exit 0; re-run: still parked |
| A5 | Decide (approve) | EITHER the dashboard "Approve" button on `/os/orchestration` (new in `209270a`; goes through the same RPC) OR the ratified section-13.2 SQL method: `select status, decided_at from public.decide_orchestration_approval('<apr-id>','approved','<fresh-nonce>');` -> approved |
| A6 | Replay refused | Repeat A5 with the same id -> ERROR not_pending (dashboard shows "approval decision refused") |
| A7 | Completes | Oneshot again: job completed, evidence present, executed=false; goal completed |
| A8 | Posture | Same checks as CL-3.2 step 12 |

Rejection path (fresh goal from a fresh interpret):

| # | Step | Expected |
|---|---|---|
| R1 | Confirm + park | As A2-A4: approval pending, job awaiting_approval |
| R2 | Decide (reject) | Dashboard "Reject" button or SQL: `...decide_orchestration_approval('<apr-id>','rejected','<fresh-nonce>');` -> rejected |
| R3 | Replay refused | Re-decide the same id (either outcome) -> ERROR not_pending |
| R4 | Stays parked, fail-closed | Orchestrator oneshot: the rejected job STAYS awaiting_approval (a rejection never becomes an execution); no status regression; the goal ends blocked-on-approval, not completed |
| R5 | Posture | Same checks as CL-3.2 step 12; `select count(*) from goal_jobs where executed=true;` still 0 |

### CL-3c - expiry-path check (synthetic, staging-only)

Purpose: prove an EXPIRED approval can neither be decided nor unlock a
job. Uses a third fresh CL-3b-style goal.

| # | Step | Expected |
|---|---|---|
| E1 | Confirm + park | Approval pending, job awaiting_approval (as A2-A4) |
| E2 | Force expiry (drill-only) | SQL editor (postgres role, staging only, THIS synthetic approval id only): `update orchestration_approvals set expires_at = created_at + interval '1 second' where approval_id = '<apr-id>' and status = 'pending';` -> 1 row (this shape always satisfies the table's `expires_at > created_at` CHECK; wait a few seconds before E3) |
| E3 | Decide refused | `...decide_orchestration_approval('<apr-id>','approved','<fresh-nonce>');` -> ERROR expired |
| E4 | Driver fail-closed | Orchestrator oneshot: job STAYS awaiting_approval (driver refuses non-authoritative/expired approvals); executed=true count still 0 |
| E5 | Posture | Same checks as CL-3.2 step 12 |

E2 is the ONLY direct SQL write in this packet: it shrinks a validity
window on one synthetic pending row (strictly tightening, never
loosening). STOP if the row count is not exactly 1.

### CL-3d - owner-stop / kill-switch check

| # | Step | Expected |
|---|---|---|
| K1 | Engage | SQL: `update system_controls set owner_stop = true, updated_at = now() where id = 'global';` -> 1 row |
| K2 | Halt proven | `sudo systemctl start preston-orchestrator.service; systemctl show -p ExecMainStatus preston-orchestrator.service` -> ExecMainStatus=75; `sudo tail -n 5 /var/log/preston/orchestrator.log` shows the owner_stop/paused halt; NO job status changed (re-run the CL-3.2 step 8 SQL - timestamps unchanged) |
| K3 | Release | SQL: `update system_controls set owner_stop = false, updated_at = now() where id = 'global';` -> 1 row; re-run P1 -> back to the preflight posture |
| K4 | Recovery | One orchestrator oneshot -> exit 0, normal drive resumes |

### CL-3e - cleanup / rollback (after all checks)

Durable rows are the audit trail - NEVER delete them. Cleanup is:

1. Record every drill goal id, job id, and approval id in the drill log.
2. The CL-3b rejection-path and CL-3c expiry-path goals remain parked
   (blocked on approval) by design; optionally cancel them so the board
   is tidy - SQL editor, per goal:
   `update master_goals set status='cancelled', updated_at=now() where id='<goal-id>' and status in ('decomposed','blocked','running');`
   then the same-shape update for its non-terminal jobs
   (`status in ('pending','ready','awaiting_approval') -> 'cancelled'`).
   Cancelled rows are inert; the driver never drives them.
3. Confirm final posture: preflight P1 + P3 unchanged
   (false/false/observe_only/false/false; executed count 0).
4. No host, env, timer, credential, or Vercel change is part of cleanup.
   If CL-1/CL-2 themselves must be rolled back, use the rollback lines
   inside those gates - never force-push.

### Evidence capture (run at each marked step; save output to the drill log)

```bash
# host-side
systemctl show -p ExecMainStatus preston-orchestrator.service
sudo tail -n 20 /var/log/preston/orchestrator.log
sudo tail -n 20 /var/log/preston/hermes.log
```

```sql
-- graph state
select id, title, status, simulation_only from master_goals order by created_at desc limit 10;
select id, title, status, requires_approval, approval_id, executed, evidence_refs
from goal_jobs where goal_id = '<goal-id>' order by created_at;
select approval_id, status, decided_at, expires_at from orchestration_approvals order by created_at desc limit 10;
-- posture
select execution_enabled, remote_runner_enabled, hermes_mode, owner_stop, paused from system_controls where id='global';
select count(*) from goal_jobs where executed = true;
```

Plus dashboard screenshots at: proposal preview (step 2), success card
(step 4), duplicate-confirm card (step 6), completed goal (step 10),
pending approval with Approve/Reject buttons (A3/R1).

### PASS / FAIL criteria

PASS requires ALL of:

- every CL-3.2 step matched its Expected column, with evidence captured
- CL-3b approval path AND rejection path both matched
- CL-3c expiry refusal matched; CL-3d kill-switch halt (exit 75) matched
- `executed = true` count was 0 at every posture check
- safety posture (P1) identical before and after the whole drill
- no step required anything in section 1 (Explicit prohibitions)

Any other outcome is FAIL (or PARTIAL if a later step was never reached);
apply the On-failure column, capture evidence, and stop.

### STOP conditions (immediate, no judgment call)

- any preflight expectation fails
- the composer preview differs from the pinned CL-3.1 table
- any SQL count/posture check differs from Expected
- `executed = true` appears anywhere, ever
- any real send, external write, credential prompt, or production
  surface appears in any step
- a step seems to need a capability listed in section 1
- On ANY stop: engage CL-3d K1 (owner_stop) first, then run FULL 8.9
  containment from the go-live packet, then report.

PASS = all steps recorded with evidence. This packet's drill plus the
go-live packet's 21-step phone drill together support "Remote-Live
staging bridge VERIFIED"; this drill alone proves the COMPOSER lifecycle.

---

## WHAT IS PROVEN WHERE (honest boundary)

Proven LOCALLY at this revision (fake in-memory store, real app
boundaries - `test/composer-lifecycle.test.ts` and the composer suites):

request -> interpretation -> proposal -> policy classification ->
confirmation boundary -> no-durable-before-confirm -> exactly-one graph
-> duplicate-confirm replay -> dependency-ordered simulated
orchestration -> evidence -> read-model state; approval creation +
decision + verified clearance LOGIC; the dashboard decide path's input
validation; idempotency-key semantics; rollback compensation;
injection/prohibited-capability rejection; the CL-3.1 drill request's
exact interpretation (engine-pinned).

NOT proven until CL-1..CL-3 run on staging: real RLS/CHECK/FK/grant
enforcement against the composer's writes, the real
`submit_goal_decomposition` advisory-lock idempotency under the owner
JWT, the real `decide_orchestration_approval` path on composer-created
approvals (including the dashboard buttons), real expiry/rejection/
owner-stop behavior against the live DB and systemd units, Vercel/host
behavior at `$TIP`, and the dashboard UX on a real phone. The fake store
emulates these semantics; it is not evidence of them.

---

## SAFETY STATE AFTER THE VERIFICATION SESSION (factual)

- production access: none (no credentials in the verification container)
- execution_enabled / remote_runner_enabled: untouched (staging DB not
  reachable from the verification container; last owner-verified values
  false)
- hermes: observe_only (untouched)
- claude/codex: worktree_only (contracts unchanged)
- external writes / live messages / emails: none sent
- credentials: none read, none changed
- services/timers: none activated, none changed
- staging pin: still `0c287b0` (unchanged by this session)
