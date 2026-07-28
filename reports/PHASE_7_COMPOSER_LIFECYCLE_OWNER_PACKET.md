# PHASE 7 - COMPOSER STAGING LIFECYCLE OWNER PACKET

Date: 2026-07-28. Status: AUTHORITATIVE for the Goals/Tasks Request
Composer staging rollout and the first simulation-only staging Goal
lifecycle run through it. Companion to
`reports/PHASE_7_BRIDGE_GOLIVE_PACKET.md` (sections 5-8 and the
section-13 addendum remain the authority for host deployment, Gate 6B,
the 21-step drill, and the ratified SQL drill method).

Nothing in this packet enables execution, sends, production writes,
credentials, or Hermes activity. Every boundary step is OWNER-RUN.

---

## 0. WHERE THE WORK IS (factual, verified in the build session)

- Branch: `claude/preston-composer-phase7-ccyea1` (remote), built from
  `0c287b0` (= current `master` = current staging pin).
- Commits:
  - `347d65c` feat(7): composer engine + persistence + UI + nav
  - `3f6995c` test(7): composer suites (76 new tests) + d2 lint repair
- NOT merged to master. NOT deployed to Vercel or the staging host.
  Staging remains pinned to `0c287b0`, which does NOT contain the
  composer.
- Validation at `3f6995c` (this build container, Linux):
  - lint 0 errors / 0 warnings; app-graph `tsc --noEmit` 0 errors
  - full vitest: 970 tests, 967 pass; the ONLY 2 failures are the
    known environmental scanner self-scan timeouts in
    `worktree-prep.test.ts` (5s vitest timeout vs slow container I/O -
    both scanners pass standalone with 0 findings); 1 expected-fail
    (D2-L1 known-defect marker, unchanged)
  - `npm run build` PASS (`/os/composer` compiles, dynamic)
  - `npm run build:os-runtime` PASS
  - `secret_scan.sh` 0 findings; `red_boundary_scan.sh` 0 findings

### 0.1 IMPORTANT - local Windows worktree reconciliation

The July-28 checkpoint referenced local-only commits `8acb70d`
(navigation consolidation) and `a141055` (composer work-in-progress) in
`C:\dev\preston-os-worktrees\phase7-approval-reconcile`. NEITHER exists
on the remote; this composer was necessarily built WITHOUT them, directly
on `0c287b0`. Before merging, decide ONE of:

- (a) Adopt this completed composer; treat the local `a141055` WIP as
  superseded (review it once for anything worth porting, then retire it).
- (b) Push the local branch first and request a reconciliation pass.

Do NOT merge both lines blindly - they touch the same surfaces
(`/os/orchestration` page, goal-form flow).

---

## GATE CL-1 - LOCAL PUSH / MERGE GATE (owner-run, PowerShell, ZPC26)

Read-only until the merge. STOP at any mismatch. No force-push.

```powershell
# CL-1.1 fetch and review the composer branch (expect exactly 2 commits)
git -C C:\dev\preston-os fetch origin
git -C C:\dev\preston-os log --oneline master..origin/claude/preston-composer-phase7-ccyea1
git -C C:\dev\preston-os diff --stat master...origin/claude/preston-composer-phase7-ccyea1
git -C C:\dev\preston-os diff master...origin/claude/preston-composer-phase7-ccyea1
```

STOP IF: more than these files appear in the stat:
`apps/dashboard/src/lib/ai-os/orchestration/composer.ts`,
`.../composer-persist.ts`, `apps/dashboard/src/app/os/composer/*` (4 files),
`apps/dashboard/src/app/os/page.tsx` (+1 nav line),
`apps/dashboard/src/app/os/orchestration/page.tsx` (+1 nav line),
`apps/dashboard/test/composer-*.ts` (6 files),
`apps/dashboard/test/orchestration-d2-local.test.ts` (1-line lint repair),
`reports/PHASE_7_COMPOSER_LIFECYCLE_OWNER_PACKET.md` (this file).

```powershell
# CL-1.2 merge fast-forward only and push (this TRIGGERS Vercel)
git -C C:\dev\preston-os checkout master
git -C C:\dev\preston-os merge --ff-only origin/claude/preston-composer-phase7-ccyea1
git -C C:\dev\preston-os log --oneline -1        # record as $TIP
git -C C:\dev\preston-os push origin master
```

Expected: master fast-forwards to `3f6995c` (`$TIP`); Vercel builds the
dashboard at `$TIP`. Record the PREVIOUS Vercel deployment as the
rollback point. Rollback: Vercel "Redeploy" the previous deployment;
`git -C C:\dev\preston-os reset --keep <previous-master>` is NOT needed
unless you also want master back (then handle per section 8.2 of the
go-live packet - never force-push).

---

## GATE CL-2 - STAGING HOST DEPLOYMENT GATE (owner-run, phone/SSH ok)

Only needed for the orchestrator/worker runtime to drive composer-created
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

Expected output shape: `git log --oneline -1` prints `$TIP <subject>`;
`ls` prints the bin.js path.

---

## GATE CL-3 - STAGING LIFECYCLE DRILL (owner-run, simulation only)

Preconditions: CL-1 + CL-2 done; migration 0010 applied + verified
(DONE 2026-07-27/28 per the go-live packet section 13); execution
disabled; remote runner disabled; hermes observe_only; all timers
disabled unless Gate 6B was already crossed.

The drill request (paste into the composer verbatim):

> Create a staging-only goal to verify the Phase 7 dashboard status
> page. Create tasks to inspect the staging status data, generate a
> simulation-only readiness summary, and attach internal evidence. Do
> not deploy, send messages, access production, change credentials,
> perform financial actions, or make external writes.

| # | Step | Action | Expected | On failure |
|---|---|---|---|---|
| 1 | Open composer | Dashboard `/os/composer` (owner login) | Page loads; safety chips: execution false, remote_runner false, hermes observe_only | stop; check owner auth |
| 2 | Interpret | Paste the drill request, press "Interpret request" | Proposal preview: 1 goal, 3 tasks (audit + documentation + documentation), all GREEN, "0 requiring owner approval", constraint sentence recorded, banner "nothing created yet" | stop; record the rejection codes |
| 3 | Nothing durable yet | SQL: `select count(*) from master_goals where title like 'Verify the Phase 7%';` | 0 | stop |
| 4 | Confirm | Press "Confirm & create (simulation)" | Success card: goal id, 3 job ids, no approval ids; banner says simulation-only | stop; note error codes |
| 5 | Durable graph | SQL: `select id,status,simulation_only,environment,requested_by from master_goals where id='<goal-id>'; select count(*) from goal_jobs where goal_id='<goal-id>';` | status decomposed, simulation_only true, staging, requested_by info@preston.nyc; 3 jobs | 8.4 (go-live packet) |
| 6 | Duplicate confirm | Press "Confirm & create" again (or resubmit the same form) | "Already created (duplicate confirm)" - same ids; SQL counts unchanged | 8.5 |
| 7 | Drive (simulation) | `sudo systemctl start preston-orchestrator.service` then `systemctl show -p ExecMainStatus preston-orchestrator.service` and `sudo tail -n 5 /var/log/preston/orchestrator.log` | Exit 0; jobs progress to completed over 1-2 invocations | 8.5 |
| 8 | Evidence | SQL: `select status, evidence_refs, executed from goal_jobs where goal_id='<goal-id>';` | all completed, non-empty evidence_refs, executed=false | 8.4 |
| 9 | Dashboard state | `/os/orchestration` | Goal listed completed; counts consistent; `GET /api/os/status` orchestration field healthy | 8.4 |
| 10 | Safety posture | SQL: `select execution_enabled, remote_runner_enabled, hermes_mode, owner_stop, paused from system_controls;` and `select count(*) from goal_jobs where executed=true;` | false, false, observe_only, false, false; count 0 | FULL 8.9 containment |

### CL-3b - gated-approval variant (proves steps 8-9 of the lifecycle)

Request:

> Create a staging-only goal to prepare the Phase 7 schema evidence.
> Create tasks to draft a schema migration plan for owner review, and
> summarize the plan in a local report.

| # | Step | Expected |
|---|---|---|
| 1 | Interpret | 2 tasks; the migration-kind task shows "RED - owner approval required"; "1 requiring owner approval" |
| 2 | Confirm | Success card lists 1 approval id (`apr-...`) |
| 3 | Approval row | SQL: `select approval_id,status,owner_identity,job_id,expires_at from orchestration_approvals where approval_id='<apr-id>';` -> pending, info@preston.nyc, linked job, expires ~24h |
| 4 | Blocks | Run the orchestrator oneshot: gated job -> awaiting_approval; exit 0; re-run: still parked |
| 5 | Decide | Ratified section-13.2 method, single statement inside the transaction wrapper: `select status, decided_at from public.decide_orchestration_approval('<apr-id>','approved','<fresh-nonce>');` -> approved |
| 6 | Replay refused | Repeat step 5 with the same id -> ERROR not_pending |
| 7 | Completes | Oneshot again: job completed, evidence present, executed=false; goal completed |
| 8 | Posture | Same checks as CL-3 step 10 |

PASS = all steps recorded with evidence. This packet's drill plus the
go-live packet's 21-step phone drill together support "Remote-Live
staging bridge VERIFIED"; this drill alone proves the COMPOSER lifecycle.

---

## WHAT IS PROVEN WHERE (honest boundary)

Proven LOCALLY at `3f6995c` (fake in-memory store, real app boundaries -
`test/composer-lifecycle.test.ts` and the composer suites):

1-7, 10-12 of the lifecycle (request -> interpretation -> proposal ->
policy classification -> confirmation boundary -> no-durable-before-
confirm -> exactly-one graph -> duplicate-confirm replay -> simulated
orchestration -> evidence -> read-model state), approval creation +
decision + verified clearance LOGIC, idempotency-key semantics, rollback
compensation, injection/prohibited-capability rejection.

NOT proven until CL-1..CL-3 run on staging: real RLS/CHECK/FK/grant
enforcement against the composer's writes, the real
`submit_goal_decomposition` advisory-lock idempotency under the owner
JWT, the real `decide_orchestration_approval` path on composer-created
approvals, Vercel/host behavior at `$TIP`, and the dashboard UX on a
real phone. The fake store emulates these semantics; it is not evidence
of them.

---

## SAFETY STATE AFTER THIS SESSION (factual)

- production access: none (no credentials in the build container)
- execution_enabled / remote_runner_enabled: untouched (staging DB not
  reachable from the build container; last owner-verified values false)
- hermes: observe_only (untouched)
- claude/codex: worktree_only (contracts unchanged)
- external writes / live messages / emails: none sent
- credentials: none read, none changed
- services/timers: none activated, none changed
- staging pin: still `0c287b0` (unchanged by this session)
