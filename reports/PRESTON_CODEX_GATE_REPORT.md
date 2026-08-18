# PRESTON CODEX PRODUCTION GATE REPORT (CX-1..CX-5)

Date: 2026-08-18. Packet: PRESTON_CODEX_ACTIVATION_OWNER_PACKET_v1.md

## Gate result: PASS

Codex is live-proven as a second bounded production execution
provider: three real production Codex executions, deterministic
fail-closed revocation under strict mode, verified restoration,
and an unaffected Claude path.

## Commit hashes (this gate, oldest first)

- f91f439 CX-2 repin precheck (target ruling + matrix evidence)
- 1626ced CX-2 repin executed and verified
- 24a5284 CX-1 closed; CX-5 signature corrected for strict mode
- 887d95c CX-4 host-log evidence; packet log-sink wording fix
- 0bd2ec3 security incident record (DB password compromise ruling)
- 6c7dd01 CX-5 host evidence + status sync
- a221158 cx-4-1 canonical DB capture
- (this commit) cx-4-2 canonical DB capture + gate report

## Files changed

- reports/PRESTON_CODEX_ACTIVATION_OWNER_PACKET_v1.md (CX-5
  strict-mode signature; log-sink correction)
- reports/PRESTON_PRODUCTION_ACTIVATION_STATUS.md (sync entries)
- reports/p2_evidence/cx4_host_log_20260818.txt
- reports/p2_evidence/cx5_host_log_20260818.txt
- reports/p2_evidence/p2_cx-4-1_20260818_000604.txt
- reports/p2_evidence/p2_cx-4-2_20260818_001807.txt
- reports/PRESTON_CODEX_GATE_REPORT.md (this file)

## Commands run (production host, owner-authorized speed window)

- git fetch/checkout 4983d3d65f... + npm ci + build:os-runtime (CX-2,
  owner-run over ssh) ; ORCH_BASE_COMMIT repin ; strict-mode flag
- codex CLI install + login as preston-worker (CX-1, owner-run)
- worker.env codex enable pair append (owner-run)
- systemctl start preston-orchestrator.service one-shots (agent-run
  under the owner-approved window; flock-serialized)
- worker.env gate removal + restore with verification (CX-5)
- p2_drill_verify.ps1 captures cx-4-1 / cx-4-2 (owner-run, psql)

## Tests run

- Full vitest matrix at 4983d3d on laptop: 1309 pass + 1 xfail +
  5 known env-class (bash ENOENT under Windows vitest; scanners
  re-run green via Git Bash; secret scan 0; RED boundary scan 0)
- tsc build:os-runtime exit 0 (laptop and host)

## Environment

- Host: preston-agent-prod, runtime pin
  4983d3d65f3a9ea0921c489a7ae39bb8d8779819, tree clean
- worker.env: ORCH_EXECUTION_LEVEL=bounded_code_execution,
  ORCH_REAL_CLAUDE_ENABLED=true, ORCH_REAL_CODEX_ENABLED=true,
  ORCH_CODEX_EXECUTABLE=/var/lib/preston/worker/.local/bin/codex,
  ORCH_REQUIRE_REAL_EXECUTION=true, DISABLE_REMOTE_RUNNER=false
- DB controls: execution_enabled=t, remote_runner_enabled=t,
  owner_stop=f, paused=f, hermes_mode=disabled
- Vercel prod dashboard: promoted to 24a5284 (was stale c615a52)

## Evidence (canonical)

CX-4 (two independent bounded codex runs + claude regression):
- job 97c7be23 goal 256e0211: assigned_role=codex, attempts=1,
  real:*:attempt:1:completed:executed:true +
  real-audit:*:paths_ok:clean + real-provider:*:role:codex
- job 0ef04145 goal 1b6d14bb: same clean triple, role:codex
- job c66b5a71 goal 225b7847: same clean triple, role:claude
- zero sim:* on all three; worktrees empty after every run
- host log lines (orchestrator.log) disp-96623/97514/98238 match
  DB run ids exactly

CX-5 (revocation + restoration, strict mode):
- gate OFF (verified absent) -> job 00803e07 goal fa8f51a2:
  three attempts, each real_executor_decline adapter_refused /
  probe:gate_disabled then honest FAIL; final status dead_lettered,
  failure_reason real_required:probe:gate_disabled; evidence_refs
  carry 3x (real-audit real_required + real-provider role:codex);
  goal failed; ZERO sim:*; no worktree leakage; no real spawn
- gate RESTORED (verified) -> job 9e45c3f8 goal 4a38578e executed
  real first-attempt with the clean codex triple; the dead-lettered
  goal did not block it (anti-starvation live proof)
- host log disp-99418/99501 match DB run ids exactly

## Live defects found and fixed this gate

1. Stale Vercel prod deployment (c615a52, pre-9e08b95): dashboard
   compose classified every job RED (env-mismatch class disp-93663).
   Fix: owner promoted 24a5284. Follow-up: deploy-sync check.
2. Executor evidence lines documented as "journald" but written to
   /var/log/preston/orchestrator.log. Packet corrected.
3. SECURITY INCIDENT: prod DB password pasted into session chat
   (owner mis-aimed a psql prompt reply). Ruled compromised;
   owner reset the Supabase database password; no repo/log
   persistence of the value; host and Vercel unaffected (neither
   uses the postgres password). Recorded in 0bd2ec3.

## Report flags

- Production touched: true (bounded, owner-authorized window:
  repin, env gate flips, orchestrator one-shots)
- Secrets exposed: true (incident above; mitigated by immediate
  rotation; value never persisted to repo/logs)
- Live messages sent: false
- Live emails sent: false

## Hygiene (non-blocking)

- Stale RED graph 5d25fa51 remains blocked with 3 pending approvals
  expiring 2026-08-19 (owner may reject in dashboard; harmless,
  parked, proven non-starving).
- Codex CLI internal sandbox refused some agent shell attempts
  ("operation not permitted"); jobs completed their doc objective;
  host-side confinement is the enforced boundary. Observed, not a
  defect.

## Next gate

CLAUDE + CODEX T-MODE (PRESTON_TMODE_OWNER_PACKET_v1.md). T-1
posture already verified (strict mode true; zero dispatcher timers,
F1 satisfied).

## Owner action required

- Submit the T-mode team goal (text provided in-session).
- Optional hygiene: reject the three pending stale-graph approvals.
