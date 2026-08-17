# P2 - preston-agent-prod PROVISIONING RUNBOOK v1 (OWNER-RUN)

Date: 2026-08-12. Precondition (ALL MET): 9aad634 pushed; 0017 applied
+ seeded on staging AND production; adversarial review PASS with fixes.
Reference: PHASE_4B1_STAGING_DEPLOYMENT_OWNER_PACKET.md (procedures) +
PRESTON_GOLDEN_STAGING_BASELINE.md (target posture). This runbook is
the PROD DELTA list - same hardening, production values, one visit.

Pinned facts for this runbook:
  ORCH_BASE_COMMIT = 9aad6340440f46227a5c49ff818f66ffb3d37654
  SUPABASE_URL     = https://hiqsymsiwonmvrbbqhhe.supabase.co
  SUPABASE_RUNTIME_ENV = production
  Cross-env guard: the runtime REFUSES the staging ref in production
  (and vice versa), case-insensitively - wrong URL cannot run.

## H-1 Create the host (Hetzner console) - DONE 2026-08-12

DONE: created as CPX22 ("CPX21" here was a naming slip - no such
SKU; CPX22 is the 2vCPU/4GB tier matching staging), Ubuntu 24.04,
SSH key-auth ONLY, name preston-agent-prod, Hetzner project
Preston Automation. IP recorded privately (1Password + local
notes; NOT in committed docs). Resume at H-2.

## H-2 Base hardening (mirror staging exactly)

- apt update/upgrade; unattended-upgrades on.
- Firewall drop-by-default; allow TCP/22 only from your owner /32s
  (same set as staging's ruling). No other inbound. (Hetzner Cloud
  Firewall or ufw - match staging's mechanism.)
- sshd: PasswordAuthentication no, PermitRootLogin prohibit-password
  (or no + admin user per staging pattern).
- Create service user preston-worker (no sudo), HOME=/var/lib/preston/worker.

## H-3 Repo + runtime build (pinned)

- git clone https://github.com/Zebone420/preston-os /srv/preston-os
- cd /srv/preston-os && git checkout 9aad6340440f46227a5c49ff818f66ffb3d37654
  (detached; this IS the runtime pin)
- cd apps/dashboard && npm ci && npm run build:os-runtime
- mkdir -p /srv/worktrees; chown per staging Gate G shape
  (preston-worker needs worktree lifecycle under /srv/worktrees and
  git object access to /srv/preston-os/.git - copy staging's exact
  ownership/ACLs).

## H-4 Environment file (/etc/preston/worker.env, root:root 0600 -
##      mirror staging's file, swap ONLY these values)

  SUPABASE_RUNTIME_ENV=production
  SUPABASE_URL=https://hiqsymsiwonmvrbbqhhe.supabase.co
  SUPABASE_RUNTIME_KEY=<prod anon public key>
  SUPABASE_RUNTIME_TOKEN_STORE=/var/lib/preston/worker/token-store.json
  ORCH_BASE_COMMIT=9aad6340440f46227a5c49ff818f66ffb3d37654
  ORCH_CLAUDE_EXECUTABLE=/var/lib/preston/worker/.local/bin/claude
  ORCH_WORKTREES_ROOT=/srv/worktrees
  ORCH_ALLOWED_PATHS=<copy staging value verbatim>
  (CHILD_ENV_ALLOWLIST: nothing to set - the child-env allowlist is
   COMPILED into the runtime, real-claude-adapter.ts:105, locator
   vars only, NO token vars; an env var of that name is unread. If
   staging's worker.env carries such a line it is inert - skip it.)
  DISABLE_REMOTE_RUNNER=true            # stays true until drill 3
  (ORCH_EXECUTION_LEVEL absent           # simulation until drill 3)
  All other vars: copy staging names; values prod. NEVER a staging
  token/key/credential on this host (fresh-credential rule).

## H-5 Runtime DB credential (owner-identity, NOT service-role)

On your workstation: mint a prod refresh token for the owner identity
(same procedure as staging's store bootstrap), then one-time:
  runuser -u preston-worker -- node dist/os-runtime/bin.js db-health \
    --bootstrap   (env loaded per preflight-health.sh pattern)
Store seeds, env refresh token removed. Then plain db-health MUST
return ok (our new gate: production env + prod URL passes; wrong URL
refuses).

## H-6 Claude service credential (fresh, interactive)

  su - preston-worker ; /var/lib/preston/worker/.local/bin/claude
  install per staging; then interactive `/login` AS preston-worker
  (setup-token does NOT persist - staging lesson). New PROD login,
  never the staging credential.

## H-7 systemd units (from repo deploy/systemd/, staging-hardened)

Install preston-orchestrator.service/.timer, preston-worker.*,
preston-hermes-observe.* ; verify unit hardening matches the golden
baseline (Type=oneshot, TimeoutStartSec=3600, SuccessExitStatus=75,
flock, ProtectSystem=strict, ReadWritePaths=/var/lib/preston/worker
/srv/worktrees /srv/preston-os/.git).
ENABLE NOTHING yet. worker + hermes timers stay disabled throughout
P2; orchestrator timer is enabled only at drill time (H-9).

## H-8 Preflight

  deploy/preflight-health.sh (runuser, read-only) => db-health ok,
  binary starts, exit codes sane. Paste output.

## H-9 Drill ladder (owner-run, in order; stop on any FAIL)

Evidence capture after EACH drill step (read-only, from your
workstation): scripts/p2/p2_drill_verify.ps1 -Label d-p2-<n>
writes the posture/intake/goals/jobs/approvals ground truth to
reports/p2_evidence/ - commit those files with the gate report.

D-P2-1 CONSUME (execution stays off):
  systemctl start preston-orchestrator.service (one shot; or enable
  the timer for the drill window). Expect: the two parked P1 intake
  rows consumed through the composer; master_goals/goal_jobs rows with
  environment='production'; actor attribution preserved; approval
  parked where policy requires; NO execution (capability reasons list
  shows level_env_not_set/execution_disabled). Verify by psql:
    select id, status, environment from master_goals;
    select request_id, status from remote_intake_requests;

D-P2-2 APPROVALS + KILL SWITCH:
  Approve one parked approval via the owner dashboard
  (preston-os-prod.vercel.app); driver resumes it (still simulation).
  Then: update system_controls set owner_stop=true where id='global';
  next tick must halt with exit 75; reset owner_stop=false.
  (If system_controls has no row yet, insert the global row first with
  everything false - runtime defaults are closed either way.)

D-P2-3 BOUNDED EXECUTION x2 (the RED flip, one drill window):
  In worker.env: DISABLE_REMOTE_RUNNER=false and
  ORCH_EXECUTION_LEVEL=bounded_code_execution; in DB:
  execution_enabled=true, remote_runner_enabled=true.
  Submit ONE doc-only Level-1 goal (risk<=YELLOW, path-allowlisted,
  no external effect). PASS = real:*:completed:executed:true +
  real-audit:paths_ok:clean evidence refs, worktree created AND
  removed, zero sim:* fallback. Repeat once (repeatability). Then
  posture back: your choice - leave enabled (P2 exit posture, matrix)
  or flip off between sessions.

## Rollback (inherited, per layer)

timer disable | owner_stop=true halt | capability env off |
re-pin ORCH_BASE_COMMIT to $PREV | per-actor disable | Vercel
instant rollback | delete host (nothing else references it).

Codex, Hermes, n8n: DISABLED throughout - separate gates.
