# PHASE 7 - FINAL CONSOLIDATED OWNER ACTION PACKET (2026-08-03)

Everything below is genuinely owner-only. All agent-side work is done
and committed on branch phase7/offhost-0802 (7 commits, unpushed).
Actions are in dependency order and batched by tool so each tool is
opened once: A = Supabase SQL editor, B = browser (dashboard), C =
SSH (sudo), D-G = drill continuation reusing the same three tools,
H = PowerShell on ZPC26, I/J = data preservation.

Global invariants for every action here: timers stay disabled, no
service is enabled, execution_enabled stays false, hermes stays
observe_only, nothing touches production, no credential values ever
leave 1Password. The ONLY SQL writes in this packet are: the CL-3c
one-row synthetic expiry tighten (E2), the CL-3d owner_stop toggle
(K1/K3), and optional CL-3e cancellations - all staging, all
reversible or strictly-tightening.

Detailed step tables live in PHASE_7_COMPOSER_LIFECYCLE_OWNER_PACKET
.md (CL-3 family). This packet inlines the commands so you rarely
need to switch documents; on any conflict the lifecycle packet's
Expected columns govern.

After EACH lettered gate: paste the raw output back. Claude verifies
line by line, runs its read-only ssh/anon interleaved checks, records
evidence, and tells you the next single action. On any STOP: change
nothing else and paste what you have.

---

## GATE A - CL-3.0 preflight P1-P3 (Supabase SQL editor, ~2 min)

Why: last safety proof before the drill. Read-only. Reversible: n/a.
Changes: nothing.

```sql
select execution_enabled, remote_runner_enabled, hermes_mode,
       owner_stop, paused
from system_controls where id = 'global';

select to_regclass('public.master_goals'),
       to_regclass('public.goal_jobs');

select count(*) from goal_jobs where executed = true;
```

PASS: row1 = false, false, observe_only, false, false; row2 = both
non-null; row3 = 0. STOP: anything else (P4 host checks are already
re-verified by Claude via read-only ssh: pin c24a7e5, timers 3x
disabled, services 3x inactive, trusted bin.js present).

Claude next: confirms P1-P3, then Gate B.

## GATE B - CL-3.1/3.2 composer drill, browser part (owner login)

Why: proves request -> interpretation -> durable simulation graph on
the DEPLOYED dashboard. Changes: staging DB rows only (simulation
goal + jobs). Reversible: rows are audit trail (cancel-able, never
deleted).

B1. Sign in at https://preston-os-staging.vercel.app/login .
    OPTION: sign in inside the Chrome tab already connected to
    Claude's browser extension - then Claude drives B2-B6 itself
    under the standing browser-simulation authorization and captures
    screenshots (Claude never sees or enters credentials).
B2. /os/composer - verify chips: execution false, remote runner
    false, hermes observe_only. STOP if not.
B3. Paste EXACTLY the CL-3.1 request (lifecycle packet) and press
    Interpret. PASS: 3 tasks t1 audit / t2 documentation (dep t1) /
    t3 documentation (dep t2), all GREEN simulation, 0 approvals,
    constraint recorded, "nothing created yet", hash 5bd2ea4b.
    (This exact interpretation is deterministically pinned by
    composer-engine tests - 69/69 pass at the branch tip. A mismatch
    on the DEPLOYED build means version skew, not parser drift:
    STOP and report; do not weaken anything.)
B4. SQL (editor): `select count(*) from master_goals where title
    like 'Verify the Phase 7%';` -> 0 expected BEFORE confirm.
B5. Confirm & create (simulation). PASS: success card = goal id +
    3 job ids + NO approval ids + simulation banner. RECORD IDS.
B6. Press Confirm again. PASS: "Already created (duplicate
    confirm)", identical ids.
B7. SQL durable-graph proof (replace <goal-id>):

```sql
select id, status, simulation_only, environment, requested_by
from master_goals where id = '<goal-id>';
select count(*) from goal_jobs where goal_id = '<goal-id>';
select count(*) from job_dependencies where goal_id = '<goal-id>';
```

PASS: decomposed / true / staging / info@preston.nyc; 3; 2. Counts
UNCHANGED after B6. STOP: any extra rows (would be D2-L1 class -
report, Claude investigates).

Claude next: verifies, re-checks logs read-only, then Gate C.

## GATE C - CL-3.2 drive, ssh part (sudo - the bounded oneshot)

Why: the driver run itself. This STARTS no timer and ENABLES
nothing; each oneshot returns the service to inactive. Changes: job
statuses (simulation), orchestrator log lines. Reversible: yes
(statuses are the point of the drill; kill switch proven in Gate F).

```bash
sudo systemctl start preston-orchestrator.service
systemctl show -p ExecMainStatus preston-orchestrator.service
sudo tail -n 5 /var/log/preston/orchestrator.log
```

Repeat up to 3 times, with this SQL between runs:

```sql
select title, status, updated_at from goal_jobs
where goal_id = '<goal-id>' order by updated_at;
```

PASS: ExecMainStatus=0 each run; t1 completes before t2 starts, t2
before t3; final state all completed; then:

```sql
select status, evidence_refs, executed from goal_jobs
where goal_id = '<goal-id>';
```

-> all completed, evidence_refs non-empty, executed = FALSE on every
row. /os/orchestration shows the goal completed. STOP: any nonzero
exit (75 = a control is set - re-check P1; 78 = env names; 70 =
error -> paste log tail), any dependency-order violation, any
executed=true (FULL 8.9 containment).

Claude next: verifies order+evidence, checks hermes log read-only,
then Gate D.

## GATE D - CL-3b approval variant, approve AND reject paths

Why: proves gating, one-time approvals, replay refusal, fail-closed
rejection. Uses the lifecycle packet's CL-3b request verbatim, TWICE
(two fresh goals). Changes: staging rows only. The approve decision
is a staging-safe drill action - NOT production/credential/live.

- A1-A2 (browser): interpret -> 2 tasks, migration task RED "owner
  approval required", 1 approval; confirm -> 1 apr-... id.
- A3 (SQL): approval row pending, owner_identity info@preston.nyc,
  expires ~24h out.
- A4 (ssh): oneshot -> gated job parks awaiting_approval, exit 0;
  re-run -> still parked.
- A5 (browser OR SQL): Approve button on /os/orchestration, or
  `select status, decided_at from
  public.decide_orchestration_approval('<apr-id>','approved',
  '<fresh-nonce>');`
- A6: repeat the decision -> ERROR not_pending (replay refused).
- A7 (ssh): oneshot -> job completes, executed=false, goal done.
- A8: posture re-check (P1 + executed count 0).
- R1-R5: fresh goal, decide REJECTED -> job STAYS awaiting_approval
  forever (a rejection never runs), replay refused, posture clean.

PASS/STOP: per the lifecycle packet tables. STOP hard if a gated job
runs without an approved decision, or a second approval row appears
on duplicate confirm.

## GATE E - CL-3c expiry variant

Third fresh CL-3b-style goal, park it (E1), then the ONE synthetic
write (staging, one pending row, strictly tightening):

```sql
update orchestration_approvals
set expires_at = created_at + interval '1 second'
where approval_id = '<apr-id>' and status = 'pending';
```

PASS: 1 row. Wait a few seconds. Decide -> ERROR expired. Oneshot ->
job stays parked; executed count still 0. STOP: row count <> 1, or
an expired approval unlocks anything (that would contradict the
branch-tested expiry pins - full containment + report).

## GATE F - CL-3d owner-stop / kill switch

```sql
update system_controls set owner_stop = true, updated_at = now()
where id = 'global';   -- expect 1 row
```

Then (ssh): oneshot -> ExecMainStatus=75 (that IS the intended halt,
unit treats 75 as success), log shows the halt, NO job timestamps
change. Then release:

```sql
update system_controls set owner_stop = false, updated_at = now()
where id = 'global';   -- expect 1 row
```

Re-run P1 -> preflight posture; one oneshot -> exit 0 normal drive.
Rollback: the release statement IS the rollback. STOP: halt not
honored (containment: leave owner_stop=true, report immediately).

## GATE G - CL-3e cleanup + final posture

1. Record all drill goal/job/approval ids in the drill log.
2. OPTIONAL tidy (rejection + expiry goals stay parked by design):
   cancel per lifecycle packet CL-3e step 2 SQL. Never delete.
3. Final: P1 exact preflight values; P3 = 0; timers 3x disabled;
   services 3x inactive; no orphan leases
   (`select count(*) from worker_leases where expires_at > now();`
   -> expect 0); no stuck running jobs; quarantined
   dist.untrusted.20260803T033009Z stays until Claude confirms all
   drill evidence is committed (then optional removal is a separate
   owner cleanup).

Claude next: writes + commits the CL-3 gate evidence file, updates
readiness docs, declares the staging bridge VERIFIED (if all PASS).

## GATE H - repo: push the branch (ZPC26 PowerShell, owner terminal)

Why: 7 commits exist only locally; classifier denies agent push.
Changes: remote branch only - pushing a BRANCH does not redeploy
the Vercel alias (only a master merge does). Reversible: yes.

```powershell
git -C C:\dev\preston-os push -u origin phase7/offhost-0802
git -C C:\dev\preston-os log --oneline origin/master..phase7/offhost-0802
```

Expected 7 commits: 509a6b4 systemd RuntimeMaxSec fix, b4ee3ff CL-2
packet, a8b4725 Airtable+rulings evidence, d687e92 LA-10+Supabase
packets, 0d9b5ea CL-2/2 close evidence, 76318fa doc alignment,
+ the CL-3 evidence commit once the drills close.
Merge to master = a SEPARATE owner decision after review (ff-only,
never force). Note: merging redeploys Vercel at the new tip and the
host then needs its next re-pin gate (which also clears the
RuntimeMaxSec warning).

## GATE I - LA-10 off-host copy (PowerShell + destination)

Run reports/LA10_OFFHOST_BACKUP_OWNER_PACKET.md end to end.
Source re-verified 2026-08-02: 573,705 bytes, SHA-256
169277328C65576E794271144B88EA4CFC01AABDB937EC53C3B93327D8EF97BF.
LA-10 stays OPEN until you return the post-copy hash + pg_restore
list exit 0 from the DESTINATION copy.

## GATE J - Supabase paused projects (dashboard; DEADLINE)

Run reports/SUPABASE_PAUSED_PRESERVATION_OWNER_RUNBOOK.md -
andersen FIRST. Enable account MFA first (LA-11). Target by
2026-08-15; HARD deadlines 2026-09-23 / 2026-09-28. Claude cannot
resume/pause/export - owner login + DB password required
throughout. Paste back sizes/hashes/counts; Claude fills the
evidence registers.

---

## Rulings you can record any time (no dependency): V3, V4, V5, V8,
proposed V10 - decision menus + recommendations in
reports/VERIFICATION_REGISTER_V3_V4_V5_V8_EVIDENCE.md. Airtable V2
TEST-base formula edit (exact before/after in
reports/AIRTABLE_TEST_CORRECTIONS_OWNER_PACKET.md) is owner-run;
PROD Airtable stays RED-gated.
