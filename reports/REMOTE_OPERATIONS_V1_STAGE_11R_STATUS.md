# REMOTE OPERATIONS V1 - STAGE 11R STATUS + GATE H OWNER PACKET

Date: 2026-08-10. Local tip 885ff72 PUSHED (origin/master==885ff72;
Vercel Production deploy created 2026-08-10T23:03:35Z at that sha).
Staging host: UNREACHABLE at packet time (port 22 timeout AND no ping
reply from 168.119.153.173) - see Gate H step 0.

## 1. Iteration ledger (live drill findings, all fixed + pushed)

- 11R-02 62240ce: every decline-to-simulation now logs a static
  reason code (was silent).
- 11R-03 dd51d88: composer rejected counted task sentences
  ("Create one task to ...") - accepted now.
- 11R-04 be8b251: adapter refused job_not_leased on every real run -
  driver handed the stale pre-claim job image; now hands the
  post-claim row (status in_progress, run_id, lease).
- 11R-05 6e92b8f: provision decline detail was a bare "ok:255" -
  git stderr tail now travels with the decline.
- 11R-06 9b67292: retry collision - a failed first attempt leaves
  branch job/<id> behind and the service cannot delete refs; worktree
  add now uses -B (rebind own reserved branch). Also: every REAL
  result now emits one bounded log line (failed runs were invisible).
- 11R-09 885ff72: exit_1 was visible but the child stderr was not
  (two blind cycles). Bounded sanitized stderr/stdout excerpts now
  ride the real_executor_result log line.

Net state: provisioning WORKS as the service user; the real claude
child SPAWNS and exits 1; root cause not yet visible (blind cycles
predate the 885ff72 excerpt fix).

## 2. exit-1 candidate causes (resolved by the next single tick)

The next real run at 885ff72 prints stderr_excerpt in the
real_executor_result line of /var/log/preston/orchestrator.log.
Ranked candidates:

1. Child HOME invalid. passwd HOME for preston-worker is
   /nonexistent; nothing in the unit or /etc/preston/worker.env sets
   HOME; sanitizeChildEnv passes HOME through. The CLI keeps its
   credentials under /var/lib/preston/worker/.claude (owner setup
   used explicit HOME). If systemd exports the passwd HOME, the
   child cannot find credentials (or mkdir /nonexistent fails) and
   exits 1. COUNTER-EVIDENCE: Gate G put safe.directory in the
   service-user gitconfig and git provisioning works - if that
   gitconfig is really read from HOME, HOME is already valid (unless
   safe.directory was actually set system-wide in /etc/gitconfig).
2. Credential state: expired/revoked token for the service-user
   install -> auth error, exit 1. Fix: owner re-runs the setup-token
   flow as preston-worker (known method, HOME export + paste code).
3. Sandbox friction: unit restrictions (ProtectSystem=strict,
   PrivateTmp, ProtectHome) blocking a CLI write outside
   /var/lib/preston/worker, /srv/worktrees, /tmp. stderr will name
   the exact path (EROFS/EACCES).

Do NOT pre-apply speculative fixes beyond step H3 below; read the
excerpt first. The loop is no longer blind.

## 3. GATE H - owner steps (in order)

H0. RESTORE HOST. Machine does not answer ping or ssh. Check the
    Hetzner Cloud console (server state, reboot if stopped/hung).
    Afterward: ssh preston-agent-staging 'uptime' from your terminal.

H1. REPIN host to 885ff72. Standard E-block shape at
    /srv/preston-os (fetch, checkout detached 885ff72 full hash,
    npm ci dry-run then real, npm run build:os-runtime,
    ORCH_BASE_COMMIT=<full 885ff72 hash> in /etc/preston/worker.env,
    preflight-health.sh). Full hash:
    885ff7245217380cc8c99a7cc55545419dfbe6c3

H2. RESIDUE SWEEP (as grann, at /srv/preston-os): delete leftover
    drill branches and stale worktrees from failed attempts:
      git worktree prune
      git branch --list 'job/*'   (then -D each listed branch)
      ls /srv/worktrees           (rm -rf leftover wt-* dirs)

H3. OPTIONAL PREEMPTIVE (candidate 1): add one line to
    /etc/preston/worker.env:
      HOME=/var/lib/preston/worker
    EnvironmentFile entries override the passwd-derived HOME.
    Deterministic verification (optional):
      sudo systemd-run --wait -p User=preston-worker \
        -p EnvironmentFile=/etc/preston/worker.env \
        /usr/bin/printenv HOME
    Harmless if candidate 1 is wrong: this is the service users real
    state dir either way.

H4. DRILL 11R (fresh request; a NEW request_id + fresh goal - old
    drill approvals/goals are consumed/terminal). Same shape as
    Stage 11 (phone-originated remote intake, owner token). If the
    orchestrator timer is still enabled the tick is automatic;
    otherwise one oneshot start.

H5. EVIDENCE READ (Claude can do this read-only once ssh is back):
    orchestrator.log real_executor_result line. On failure the
    stderr_excerpt names the cause; apply the matching fix from
    section 2 and rerun H4.

## 4. Stage 11R success criteria (unchanged)

- evidence ref real:goal:...:job:...:completed:executed:true
- real-audit ref paths_ok on the same job
- worktree created AND removed; lease released; goal completed
- no sim:* refs on the drill jobs; posture unchanged after the run

## 5. Validation at 885ff72 (this session, ZPC26)

- focused suites real-executor/adapter/provision/seam: 90/90
- full vitest: 1228 pass + 1 expected fail + 5 known env-class
  worktree-prep failures (Windows bash scanner self-scan; direct
  Git Bash scanner runs compensate - see session evidence)
- tsc app + osruntime: 0 errors; build:os-runtime clean
- push verified: origin/master==885ff72; Vercel deployment created
  for the sha (GitHub deployments API)

## 6. Gate report fields

- Production touched: false (staging repo/host scope only)
- Secrets exposed: false
- Live messages/emails sent: false
- Next gate: Stage 11R close -> regression cycle -> SSOT S1-S4
  (reports/SSOT_STAGING_ACTIVATION_OWNER_PACKET.md)
- Owner action required: H0 host restore, then H1-H5
