# P2 GATE REPORT - CLAUDE BOUNDED PRODUCTION EXECUTION

Closed: 2026-08-18 (UTC). Template: PRESTON_P2_GATE_REPORT_TEMPLATE.md.
Runbook: PRESTON_P2_PROD_HOST_RUNBOOK_v1.md. Host: preston-agent-prod.
Runtime pin at close: 412ad15c5ff8bee01962a4581691532526196c82
(= P2 review pin 9aad634 + the single classifyJob hotfix, branch
p2-hotfix-classify-env; fix also on master 9e08b95).

## 1. Host sequence (H-1..H-9) - ALL PASS

| Step | Evidence | Result |
|------|----------|--------|
| H-1 host exists | created 2026-08-12, CPX22, Hetzner (runbook note) | PASS |
| H-2 hardening | Batch A markers A1-A14 + Batch B ufw 22/tcp single owner /32 (session log 2026-08-18); sshd key-only; worker.env root:preston-worker 640; repo root-owned, tree write-denied to service user | PASS |
| H-3 pinned clone | HEAD==pin, tree clean, npm ci + build:os-runtime clean; Node upgraded 20->24.19.0 (supabase-js WebSocket requirement, found live) | PASS |
| H-4 worker.env | all names present; pins verified (production env, prod URL); REMOTE_INTAKE_OWNER_IDENTITY added (was missing - found live); prod publishable API key corrected (wrong-project key found live via auth-settings probe) | PASS |
| H-5 token store | bootstrap after key fix; store 0600 rotating (multiple proven rotations); plain db-health ok rows:1 (disp-93421, disp-95684) | PASS |
| H-6 claude login | .credentials.json persisted via claude auth login; sanitized-env probe (env -i, allowlist-only) returned PRESTON-REAL-OK | PASS |
| H-7 systemd units | six units installed from repo; nothing enabled; /var/log/preston pre-created (LogsDirectory first-start ordering quirk, found live) | PASS |
| H-8 preflight | preflight-health.sh full PASS, exit 0 (env names, store 0600, authenticated read-only db-health) | PASS |
| H-9 drill ready | p2_h9-pre evidence: controls global all-false, hermes disabled, 2 parked P1 rows, 0 goals | PASS |

## 2. Drill ladder - ALL PASS

| Drill | Evidence | Result |
|-------|----------|--------|
| D-P2-1 consume | p2_d-p2-1_20260817_211813.txt + tick disp-92987: p2-drill-consume-02 consumed -> goal 9af9aa2d environment=production, actor claude-1/api preserved, job parked awaiting_approval (apr-6dd8cb54..., env=production), zero execution. Note: the two ORIGINAL P1 rows were correctly REJECTED by the fail-closed composer (surface-proof rows, not composable) - recorded as positive containment evidence; drill ran on a fresh neutral request | PASS |
| D-P2-2 approve+kill | p2_d-p2-2_20260817_213146.txt + ticks disp-93066/93141/93265: approval approved one-time (pending=0), job completed attempts=1 SIM evidence only; owner_stop=true -> single-line halt (exit-75 path, SuccessExitStatus=75), no goal read; restore -> clean tick | PASS |
| D-P2-3 bounded real x2 | p2_d-p2-3-1_20260817_221533.txt + p2_d-p2-3-2_20260817_222627.txt + ticks disp-93907/disp-94722: TWO first-attempt real executions - jobs 2e48b6ec (goal d39f4e38) and 6e354fb6 (goal 3da3e5b9), each real:*:attempt:1:completed:executed:true + real-audit:*:paths_ok:clean, zero sim:*, worktree created AND removed (/srv/worktrees empty after each), child env fingerprint [PATH,HOME,SHELL,LANG] only, child_home correct | PASS |

## 3. Safety invariants (post-drill sweep 2026-08-18) - ALL PASS

RLS/anon posture unchanged (P0 chain; no migration in this gate touched
policies - 0018 is function-body only). Approval one-time semantics
proven (D-P2-2). Actor restriction: only the claude path executed;
codex-1/hermes-1 rows disabled, no codex/hermes env on host, no
hermes.env, no n8n presence. Path allowlist enforced (paths_ok:clean
on both real runs; allowlist value unchanged apps/dashboard/). No
external side effects (doc-only drills; no send/calendar/business
writes exist in this runtime). Controls posture at close = owner
ruling "leave enabled": execution_enabled=true,
remote_runner_enabled=true, owner_stop=false, paused=false,
hermes_mode=disabled. Token store healthy/rotating; job/* branch
residue swept to zero; worktree list clean; timers all disabled;
services inactive between ticks. Staging untouched all session.
No credential value appears in any evidence artifact.

## 4. Live defects found and fixed during this gate (all root-caused)

1. LogsDirectory first-start ordering -> pre-created /var/log/preston.
2. REMOTE_INTAKE_OWNER_IDENTITY missing from worker.env -> added
   (intake hook was inert without it).
3. Wrong-project publishable API key in worker.env -> proven via
   /auth/v1/settings 401 + "owned by another project" probe; replaced
   with the prod key (settings 200).
4. Node 20 lacked native WebSocket for supabase-js -> Node 24.19.0 +
   rebuild (token-store write happened BEFORE the failure; no re-mint).
5. Migration 0018: submit_goal_decomposition hardcoded environment
   'staging' -> every composed prod goal violated deployment equality
   (fail-closed refusal, tick disp-92809). Fixed + static test
   migration-0018.test.ts; applied both envs; live-proven.
6. classifyJob hardcoded environment 'staging' -> every composed prod
   job classified RED (non_staging_environment), real adapter refused
   risk_exceeds_allowed, silent sim fallback (tick disp-93663). Fixed
   (policy.ts -> deploymentEnvironment()) + regression test
   policy-deployment-env.test.ts; host repinned to hotfix 412ad15.
7. PROD-claude-1 actor token treated as compromised -> rotated via
   p1_actor_provision.ps1 -OnlyActor (canonical single-actor re-key).

Deviations recorded: ufw host firewall used (Hetzner cloud firewall
not attached - owner console confirmation owed, non-blocking); the
approval parks observed in D-P2-1/2 were partly an artifact of defect
6 (RED misclassification) - approval lifecycle remains fully proven,
and post-fix GREEN doc jobs run without parking, which matches the
canonical runbook's risk<=YELLOW design.

## 5. Gate close block (CLAUDE.md format)

- Gate result: PASS
- Commit hashes: e421f75 (0018+test), 9e08b95 (classifyJob fix+test),
  412ad15 (hotfix branch pin), evidence+close commit (this commit).
- Files changed: supabase/migrations/0018_*.sql, policy.ts, two
  regression test files, reports/p2_evidence/* (8 captures), this
  report, status record.
- Commands run: runbook H-2..H-9 (owner+agent split per session log),
  drill ladder ticks disp-92460..94722, p2_drill_verify.ps1 x8.
- Tests run: full suite green at 9e08b95 (1309 pass + 1 xfail + 5
  known env-class); targeted: migration-0018 (7), policy-deployment-
  env (4), composer suites (68), tsc x2 clean.
- Environment: production (preston-agent-prod + hiqsymsiwonmvrbbqhhe).
- Production touched: true (bounded, per runbook + live-defect fixes).
- Secrets exposed: false (hash-prefix/length-only diagnostics; hidden
  prompts; one prior token ruled compromised and rotated).
- Live messages sent: false. Live emails sent: false.
- Next gate: Codex individual production proof
  (PRESTON_CODEX_ACTIVATION_OWNER_PACKET_v1.md - starts with repin).
- Owner action required: none for P2; Codex gate owner steps queued.

## 6. Sign-off

OWNER AUTHORIZES GATE STATUS CHANGE - owner directed the P2 PASS
declaration after both real executions + evidence capture
(2026-08-18 session, "done + leave enabled" ruling).

OWNER RULES P2: PASS - 2026-08-18 - exit posture: execution enabled.
