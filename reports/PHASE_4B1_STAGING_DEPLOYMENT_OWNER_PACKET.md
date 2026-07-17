# Phase 4B.1 - Hetzner STAGING Deployment Owner Packet (authoritative)

OWNER-RUN packet, produced by the 2026-07-17 predeployment audit. Documentation
ONLY: the AI deployed nothing, connected to no server, ran no SQL, installed and
started no service, and sent no message. Every command below is run by the
owner. STAGING ONLY - no production system is referenced anywhere in this
packet.

This packet supersedes the command sequences in
PHASE_4B_REMOTE_LIVE_OWNER_PACKET.md (kept for background). Where they differ,
THIS file wins.

Conventions:
- "GATE" = STOP. Do not run the next section until you have read the check,
  seen the expected evidence, and decided to proceed.
- No command in this packet enables or starts a service as a side effect of
  installation. Every activation is its own explicit GATE.
- Never paste secret VALUES into a terminal command that echoes, into Git, or
  into chat. Env files are created with a local editor on the host, 0600.
- Placeholders: <STAGING_HOST> = the Hetzner staging host / SSH alias
  (project notes: preston-agent-staging). Service users: preston-worker,
  preston-hermes. App dir: /srv/preston-os/apps/dashboard.

Honest-evidence note (from the audit): the shipped dispatcher loops
(worker-loop / hermes-loop) currently run with an EMPTY candidate set - they
load env, authenticate via the token store, read system_controls, honor
halt/pause via exit codes, and write logs, but they do NOT yet source jobs from
the database, so they write no job_attempts / orchestration_decisions rows.
Row-producing simulation is the next engineering gate. The drill below verifies
what the shipped artifacts actually do; it claims nothing else.

---

## 0. Preconditions (local, owner)

1. Repo at the audited commit, clean tree:
       git -C C:\dev\preston-os fetch origin
       git -C C:\dev\preston-os status
       git -C C:\dev\preston-os log -1 --oneline
   Expect: the Phase 4B.1 audit commits (this packet's commit or later), clean.
2. Staging Supabase project reachable in the dashboard (owner login).
3. You have: SSH access to <STAGING_HOST>; Supabase staging anon key and the
   service identity's refresh token available in your password manager (never
   in a file inside the repo).

## 1. Local owner commands (verification before any remote step)

    cd C:\dev\preston-os\apps\dashboard
    npm ci
    npm test                     # expect: all suites pass (301+ tests)
    npm run build:os-runtime     # expect: exit 0, dist/os-runtime/bin.js fresh
    git status                   # expect: clean (dist matches the commit)
    node dist/os-runtime/bin.js health    # expect: JSON health line, exit 0

GATE 1: all green locally. If anything fails, stop; do not deploy a red tree.

## 2. Database preconditions (owner, Supabase SQL editor, STAGING project)

Run in this order; each is additive and idempotent:

1. Confirm migrations 0001-0004 are applied (they were owner-applied earlier).
2. Apply supabase/migrations/0005_phase4b1_id_alignment.sql (paste the file
   contents into the SQL editor). Expect: success; no rows deleted (the file is
   ALTER-only; retypes six append-log id columns uuid -> text).
3. Seed the controls singleton (safe if already present):
       insert into system_controls (id) values ('global') on conflict do nothing;
4. Verify the fully-stopped default state:
       select execution_enabled, owner_stop, paused, hermes_mode,
              remote_runner_enabled from system_controls where id = 'global';
   Expect: false, false|true, false|true, 'disabled', false. execution_enabled
   and remote_runner_enabled MUST be false.

GATE 2: controls row exists and execution_enabled=false. Stop on anything else.

## 3. SSH connection and remote host verification

    ssh <STAGING_HOST>
    uname -a && cat /etc/os-release | head -2
    command -v git node && node --version     # need Node LTS (>=20)
    systemctl list-units 'preston-*' --all    # expect: nothing, or only known units
    ps aux | grep -i preston | grep -v grep   # expect: no preston process

GATE 3: host is the staging box, no preston services running.

## 4. Remote repository placement

    sudo mkdir -p /srv && cd /srv
    sudo git clone <canonical repo URL> preston-os   # first time; else:
    cd /srv/preston-os && sudo git fetch origin && sudo git checkout master && sudo git pull --ff-only
    git -C /srv/preston-os log -1 --oneline   # MUST equal the commit from section 1
    git -C /srv/preston-os status             # clean

No force operations. If the tree is dirty or diverged, stop and report.

## 5. Dependency and build verification (remote)

    cd /srv/preston-os/apps/dashboard
    npm ci --ignore-scripts
    npm run build:os-runtime
    git status        # expect: clean (dist/ is gitignored; nothing tracked changed)
    node dist/os-runtime/bin.js health   # expect: JSON line, exit 0 (env-free health)

GATE 5: the dispatcher is compiled ON THE HOST from the pinned commit's source
by the deterministic `build:os-runtime` (tsc) step - the commit hash check in
section 4 is what pins its provenance. dist/ is a build product, not a tracked
artifact.

## 6. Service users, directories, and configuration presence (no secrets printed)

    sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin preston-worker  || true
    sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin preston-hermes  || true
    sudo mkdir -p /etc/preston && sudo chmod 0755 /etc/preston
    sudo install -d -m 0700 -o preston-worker -g preston-worker /var/lib/preston/worker
    sudo install -d -m 0700 -o preston-hermes -g preston-hermes /var/lib/preston/hermes

Create /etc/preston/worker.env and /etc/preston/hermes.env with a local editor
on the host (values from your password manager; NEVER echo them). Names only:

    SUPABASE_URL=            # staging project URL
    SUPABASE_RUNTIME_KEY=    # staging anon key (NOT service-role)
    SUPABASE_RUNTIME_ENV=staging
    SUPABASE_RUNTIME_TOKEN_STORE=/var/lib/preston/worker/token.json   # hermes: .../hermes/token.json
    SUPABASE_RUNTIME_REFRESH_TOKEN=   # TEMPORARY - removed after bootstrap (sec 7)

    sudo chown preston-worker:preston-worker /etc/preston/worker.env && sudo chmod 0600 /etc/preston/worker.env
    sudo chown preston-hermes:preston-hermes /etc/preston/hermes.env && sudo chmod 0600 /etc/preston/hermes.env

Presence check without printing values:
    for v in SUPABASE_URL SUPABASE_RUNTIME_KEY SUPABASE_RUNTIME_ENV SUPABASE_RUNTIME_TOKEN_STORE SUPABASE_RUNTIME_REFRESH_TOKEN; do
      sudo grep -qE "^${v}=." /etc/preston/worker.env && echo "worker ${v} present"; done

GATE 6: both env files exist, 0600, owned by their service user, names present.

## 7. Token bootstrap (one-time per identity; no token values shown)

The store starts empty; a normal run fails closed by design. Bootstrap
explicitly, per identity, as that identity's user:

    cd /srv/preston-os/apps/dashboard
    sudo runuser -u preston-worker -- bash -c 'set -a && . /etc/preston/worker.env && set +a && node dist/os-runtime/bin.js db-health --bootstrap'
    echo "worker bootstrap exit: $?"
    sudo runuser -u preston-hermes -- bash -c 'set -a && . /etc/preston/hermes.env && set +a && node dist/os-runtime/bin.js db-health --bootstrap'
    echo "hermes bootstrap exit: $?"

Expect: exit 0 and a JSON db_health ok line each. The refresh token has now been
ROTATED into the store; the env copy is dead. Remove it:

    sudoedit /etc/preston/worker.env   # delete the SUPABASE_RUNTIME_REFRESH_TOKEN line
    sudoedit /etc/preston/hermes.env   # delete the SUPABASE_RUNTIME_REFRESH_TOKEN line
    sudo ls -l /var/lib/preston/worker/token.json /var/lib/preston/hermes/token.json  # 0600, service-user owned

Recovery if bootstrap fails: fix the reported gap (exit 78 = config/name gap,
70 = auth/read failure), re-provision a FRESH refresh token if consumed, retry.

## 8. Database-health preflight (repeatable, read-only)

    sudo bash /srv/preston-os/deploy/preflight-health.sh
    PRESTON_ENV_FILE=/etc/preston/hermes.env PRESTON_SERVICE_USER=preston-hermes \
      sudo -E bash /srv/preston-os/deploy/preflight-health.sh

Expect: "PREFLIGHT: PASS - authenticated read-only control-plane connectivity OK"
for both identities. This proves: env loaded, store token refreshed+rotated,
staging allowlist satisfied, production URL refused, system_controls readable.

GATE 8: both preflights PASS. Nothing is installed yet.

## 9. systemd installation (services stay DISABLED - nothing can start)

    sudo cp /srv/preston-os/deploy/systemd/preston-worker.service      /etc/systemd/system/
    sudo cp /srv/preston-os/deploy/systemd/preston-worker.timer        /etc/systemd/system/
    sudo cp /srv/preston-os/deploy/systemd/preston-hermes-observe.service /etc/systemd/system/
    sudo cp /srv/preston-os/deploy/systemd/preston-hermes-observe.timer   /etc/systemd/system/
    sudo systemctl daemon-reload

This activates NOTHING: the .service files have no [Install] section (they can
never be enabled), and the timers are not enabled. Verify exactly that:

## 10. Unit-file inspection

    systemd-analyze verify /etc/systemd/system/preston-worker.service /etc/systemd/system/preston-worker.timer /etc/systemd/system/preston-hermes-observe.service /etc/systemd/system/preston-hermes-observe.timer
    systemctl is-enabled preston-worker.timer preston-hermes-observe.timer   # expect: disabled (both)
    systemctl is-active  preston-worker.service preston-hermes-observe.service  # expect: inactive (both)
    systemctl cat preston-worker.service | grep -E 'User=|ExecStart=|ProtectSystem=|NoNewPrivileges='

GATE 10: verify clean, both timers "disabled", both services "inactive".

## 11. Manual foreground dry run (one bounded oneshot each, no timers)

    sudo systemctl start preston-worker.service && systemctl status preston-worker.service --no-pager
    sudo systemctl start preston-hermes-observe.service && systemctl status preston-hermes-observe.service --no-pager
    sudo tail -5 /var/log/preston/worker.log /var/log/preston/hermes.log

Expect: each runs once and exits. Worker: status "inactive (dead)" with
SUCCESS, log line event=worker_loop stoppedReason=completed executed=false.
Hermes: SUCCESS with stoppedReason=disabled (hermes_mode is still 'disabled' -
that IS the fail-closed proof). No job rows are written (see Honest-evidence
note). A start is a bounded <=300s oneshot; nothing keeps running.

## 12. Health / readiness validation

    sudo bash /srv/preston-os/deploy/preflight-health.sh        # still PASS
    systemctl list-timers 'preston-*'                            # still: none active
    From your phone/laptop browser: open the staging dashboard /os
    (read-only owner control center) and GET /api/os/status - owner login
    required; confirms remote visibility of the stopped state.

GATE 12 (ACTIVATION BOUNDARY - WORKER): everything above green. The next
command is the first activation. Proceed only with explicit owner YES.

## 13. Worker-only enable/start gate

    sudo systemctl enable --now preston-worker.timer
    systemctl list-timers 'preston-*'     # worker timer scheduled (5 min cadence)

After >=2 firings:
    sudo tail -20 /var/log/preston/worker.log
Expect: one bounded run per firing, exit SUCCESS, executed=false every line,
no overlap (OnUnitInactiveSec), no job rows, nothing else started.

GATE 13 (ACTIVATION BOUNDARY - HERMES): worker cadence verified. Explicit YES
required for Hermes observe-only.

## 14. Hermes observe-only enable/start gate

1. SQL (owner, staging):
       update system_controls set hermes_mode='observe_only', updated_at=now() where id='global';
2.     sudo systemctl enable --now preston-hermes-observe.timer
3. After >=2 firings:
       sudo tail -20 /var/log/preston/hermes.log
   Expect: event=hermes_loop, stoppedReason=completed (empty batch set),
   recorded=0, exit SUCCESS. No lease, no execution, no message.

Rollback of this step alone:
       update system_controls set hermes_mode='disabled', updated_at=now() where id='global';
   Next firing logs stoppedReason=disabled (exit 0).

GATE 14 (ACTIVATION BOUNDARY - TELEGRAM): explicit YES required; skippable -
the drill does not depend on it.

## 15. Telegram receiver activation gate (optional, Preview env only)

On the dashboard hosting env (NOT the Hetzner host): set
TELEGRAM_WEBHOOK_SECRET, TELEGRAM_OWNER_USER_ID, TELEGRAM_OWNER_CHAT_ID,
TELEGRAM_INTAKE_ENABLED=true; point the bot webhook at /api/telegram with the
same secret_token. The receiver validates size -> secret -> owner -> freshness
-> replay, never sends, and inserts nothing (side effects are a later gate).
Verify: a /status message from the owner account returns 200 accepted in the
route logs; a non-owner or stale message is rejected.
Rollback: unset TELEGRAM_INTAKE_ENABLED (route returns 503 disabled).

## 16. Pause, stop, kill, restart, and crash-recovery checks

Run each; verify via log lines and exit codes at the NEXT timer firing:

1. Pause:   update system_controls set paused=true,  updated_at=now() where id='global';
   Expect: next worker firing exits 75 (halted), log stoppedReason=halted.
2. Resume:  update system_controls set paused=false, owner_stop=false, updated_at=now() where id='global';
   Expect: next firing back to SUCCESS. (Resume can NEVER enable execution -
   regression-tested; execution_enabled stays false.)
3. Stop:    update system_controls set owner_stop=true, paused=true, updated_at=now() where id='global';
   Expect: exit 75 on both services' next firing.
4. GLOBAL KILL (always available):
       update system_controls set owner_stop=true, execution_enabled=false,
         remote_runner_enabled=false, hermes_mode='disabled', paused=true,
         updated_at=now() where id='global';
       sudo systemctl stop preston-worker.timer preston-hermes-observe.timer  # belt+braces
5. Restart/crash recovery: clear the kill (step 2 form + hermes_mode as
   desired), `sudo systemctl start preston-worker.service` once manually,
   then `sudo reboot`. After boot: timers re-fire only if ENABLED (OnBootSec
   5-6 min); each run re-reads controls and re-authenticates from the token
   store (rotated token survives reboot; verify a post-reboot firing SUCCESS).

## 17. Checkpoint recovery verification

Checkpoint WRITE and resume paths exist in code but the shipped loops process
no candidates, so there is no checkpoint row to recover in this drill. Verify
only: `select count(*) from job_checkpoints;` is unchanged by all of the above
(expect 0 or the pre-drill count). Full checkpoint-recovery verification is
part of the next engineering gate (DB-sourced candidates). Do not claim it.

## 18. Laptop-closed staging drill (the actual test)

Precondition: sections 13-14 green, controls: paused=false, owner_stop=false,
hermes_mode='observe_only', execution_enabled=false.

1. Note the time. Close the laptop / disconnect from SSH entirely.
2. Wait >=30 minutes. Interact only by phone: open /os and /api/os/status -
   confirm state renders and hermes_mode shows observe_only.
3. (Optional, if section 15 done) send /status to the bot; expect acceptance.
4. Reopen the laptop, SSH in, and collect:
       journalctl -u preston-worker.service --since "-45 min" --no-pager | tail -30
       journalctl -u preston-hermes-observe.service --since "-45 min" --no-pager | tail -30
       sudo tail -30 /var/log/preston/worker.log /var/log/preston/hermes.log
   Expect: ~6+ bounded firings per service while the laptop was closed, every
   one SUCCESS, executed=false, recorded=0, no restarts loops, no errors.
5. Phone kill test: from the Supabase dashboard (phone), run the GLOBAL KILL
   (16.4 SQL only). Wait one cadence; SSH evidence: both services' next firing
   exits 75/0-disabled. Then restore.

PASS = all five steps evidenced. This drill proves: unattended bounded
operation, remote visibility, remote kill, fail-closed posture. It does NOT
prove job simulation (see Honest-evidence note) - do not report that.

## 19. Rollback (to pre-drill state, services present but inert)

    update system_controls set owner_stop=true, execution_enabled=false,
      remote_runner_enabled=false, hermes_mode='disabled', paused=true,
      updated_at=now() where id='global';
    sudo systemctl disable --now preston-worker.timer preston-hermes-observe.timer
    systemctl is-enabled preston-worker.timer preston-hermes-observe.timer  # disabled
Nothing else changes; unit files, env, tokens remain for a later attempt.

## 20. Uninstall (full removal) + evidence collection

Uninstall:
    sudo systemctl disable --now preston-worker.timer preston-hermes-observe.timer
    sudo rm /etc/systemd/system/preston-worker.* /etc/systemd/system/preston-hermes-observe.*
    sudo systemctl daemon-reload
    sudo shred -u /var/lib/preston/worker/token.json /var/lib/preston/hermes/token.json
    sudo shred -u /etc/preston/worker.env /etc/preston/hermes.env
    sudo rm -rf /var/lib/preston
    # optional: sudo userdel preston-worker; sudo userdel preston-hermes; sudo rm -rf /var/log/preston
Then revoke the two service identities' sessions/refresh tokens in the Supabase
dashboard. Database rollback (only if abandoning 4B entirely): the additive
table drops are in the Phase 2/3 packets; NEVER touch legacy command_packets.

Evidence collection (attach to the gate report):
    git -C /srv/preston-os log -1 --format=%H
    systemctl is-enabled preston-worker.timer preston-hermes-observe.timer
    journalctl -u preston-worker.service --since <drill window> --no-pager
    journalctl -u preston-hermes-observe.service --since <drill window> --no-pager
    /var/log/preston/*.log excerpts, /os screenshots (phone), SQL:
    select * from system_controls; select count(*) from job_attempts;
Redact nothing-needed: none of the above contains a secret value.

---

Owner approval boundaries in this packet: GATE 12->13 (worker activation),
GATE 13->14 (Hermes activation), GATE 14->15 (Telegram activation), and the
drill itself (section 18). Everything before GATE 12 is installation and
verification only and starts nothing.
