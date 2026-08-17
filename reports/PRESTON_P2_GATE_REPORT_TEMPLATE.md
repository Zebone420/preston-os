# P2 GATE REPORT - CLAUDE BOUNDED PRODUCTION EXECUTION (TEMPLATE)

Status: TEMPLATE - nothing below is a claim until the evidence cell
is filled with a real artifact reference. Fill mechanically; a step
with an empty evidence cell is NOT done, whatever any chat said.
Canonical procedure: reports/PRESTON_P2_PROD_HOST_RUNBOOK_v1.md.
Evidence capture: scripts/p2/p2_drill_verify.ps1 -> reports/p2_evidence/.

Rule: do NOT write PASS in any Result cell without the named
evidence. A successful process exit alone is not evidence.

## 1. Host sequence (H-1..H-9)

| Step | What proves it | Evidence (file/output ref) | Result |
|------|----------------|----------------------------|--------|
| H-1 host exists | Hetzner: preston-agent-prod CPX22 up | recorded 2026-08-12 (runbook H-1 note) | PASS |
| H-2 hardening | sshd config lines + firewall rule list + preston-worker id output | | PENDING |
| H-3 pinned clone | git -C /srv/preston-os rev-parse HEAD == 9aad6340440f46227a5c49ff818f66ffb3d37654; npm ci + build:os-runtime exit 0 | | PENDING |
| H-4 worker.env | ls -l /etc/preston/worker.env (root:root 0600) + grep -c of REQUIRED var NAMES only (values never shown) | | PENDING |
| H-5 token store | db-health --bootstrap once, then plain db-health ok; store file 0600 under /var/lib/preston/worker | | PENDING |
| H-6 claude login | interactive /login AS preston-worker; sanitized-env probe returns the expected marker | | PENDING |
| H-7 systemd units | unit files diff-clean vs repo deploy/systemd/; systemctl list-timers shows NOTHING enabled | | PENDING |
| H-8 preflight | deploy/preflight-health.sh full output pasted (db-health ok, exit codes sane) | | PENDING |
| H-9 drill ready | posture query: execution_enabled=false, remote_runner_enabled=false, owner_stop=false, 2 parked P1 intake rows pending | | PENDING |

## 2. Drill ladder

| Drill | PASS criteria (all required) | Evidence file (p2_evidence/) | Result |
|-------|------------------------------|------------------------------|--------|
| D-P2-1 consume | intake rows consumed; master_goals/goal_jobs rows environment='production'; actor_id preserved; approval parked where required; capability reasons show NO execution (level_env_not_set/execution_disabled) | p2_d-p2-1_*.txt | PENDING |
| D-P2-2 approve + kill | approval decided one-time (re-decide refused); driver resumed the parked goal (still simulation); owner_stop=true -> next tick single-line halt exit 75, no goal read; owner_stop=false -> clean resume | p2_d-p2-2_*.txt + orchestrator.log excerpt | PENDING |
| D-P2-3 bounded real x2 | TWO runs, each: real:*:completed:executed:true + real-audit paths_ok:clean in evidence_refs; worktree created AND removed; zero sim:* fallback; job attempts=1 | p2_d-p2-3_*.txt x2 + log excerpts | PENDING |

## 3. Safety invariant checks (verify AFTER D-P2-3)

| Invariant | Check | Result |
|-----------|-------|--------|
| RLS intact | pg_tables rowsecurity=false count = 0 | PENDING |
| Anon zero | anon table_privileges rows = 0 | PENDING |
| Approval binding | consumed approval cannot re-unlock (not_pending on replay) | PENDING |
| Actor restriction | only claude-path executed; codex/hermes rows still disabled | PENDING |
| Path allowlist | real-audit evidence shows paths_ok:clean; no file outside ORCH_ALLOWED_PATHS | PENDING |
| No external side effects | no email/SMS/calendar/n8n/telegram activity (nothing is wired; confirm no such evidence rows) | PENDING |
| Controls posture after | matches the owner's declared P2 exit posture choice | PENDING |
| Secrets | no credential value in any evidence file (grep sweep before commit) | PENDING |

## 4. Gate close block (CLAUDE.md format)

- Gate result: PENDING (PASS only when sections 1-3 all PASS)
- Commit hash or hashes: <evidence commits>
- Files changed: <list>
- Commands run: runbook H-2..H-9 + drill ladder + p2_drill_verify.ps1
- Tests run: <targeted host checks; laptop matrix already green at fcf3e4d>
- Environment: production (preston-agent-prod + hiqsymsiwonmvrbbqhhe)
- Production touched: true (bounded, per runbook only)
- Secrets exposed: false (verify before signing)
- Live messages sent: false
- Live emails sent: false
- Next gate: Codex individual production proof
  (reports/PRESTON_CODEX_ACTIVATION_OWNER_PACKET_v1.md)
- Owner action required: <none, or the exact bounded remainder>

## 5. Sign-off

Owner ruling line (required for PASS):
  OWNER RULES P2: PASS / PARTIAL / BLOCKED / FAIL - date - initials
