# Phase 4B - Remote-Live Beta Owner Packet

OWNER-RUN packet. Documentation ONLY. The AI wrote these files; it did NOT
install services, start any daemon, mutate the remote server, send any message,
run SQL, or enable execution. Everything below is owner-run against STAGING and
is fail-closed until the owner flips controls. Remote-Live Beta = simulation +
observe only; NO live business execution.

## 0. Hard-stop rules
Staging only. No production. No secret values in Git. No service-role key in the
app. Do not enable execution_enabled or remote_runner_enabled during the beta
(both stay false). Global kill (section 7) is always available.

## 1. Remote server preparation (owner-run, no activation)
On the staging host (SSH alias preston-agent-staging per project notes):
1. Install git + Node LTS via the host package manager.
2. Clone the canonical repo to a dedicated path, e.g. /srv/preston-os (read-only
   checkout for the beta).
3. Create a worktrees/ root beside it; do NOT create git worktrees yet.
4. Provision a LEAST-PRIVILEGE service identity for worker/Hermes Supabase access
   (NOT the owner's OAuth). Store its env in an EnvironmentFile the services read
   (host secret store), never in Git.
5. Do NOT start any service yet.
Verify: `git -C /srv/preston-os status` clean; no preston process running.
Rollback: remove the checkout + worktrees + identity.

## 2. Disabled service definitions (SUPERSEDED - use the tracked units)
SUPERSEDED by section 8b and the TRACKED artifacts in `deploy/systemd/`
(preston-worker.service/.timer, preston-hermes-observe.service/.timer). The
example units that previously appeared here referenced `scripts/os/*.mjs`
dispatchers that do not exist in the repo and lacked the hardening directives;
do NOT hand-write units. The tracked services have NO [Install] section (they
can never auto-start; only the owner-enabled timers fire them), run the
compiled `dist/os-runtime/bin.js` as dedicated least-privilege users, and carry
NoNewPrivileges/ProtectSystem=strict/ProtectHome/PrivateTmp/RuntimeMaxSec.

Optional preston-telegram-intake is the Next app route /api/telegram (no separate
service); it stays disabled unless TELEGRAM_INTAKE_ENABLED=true.

Install (no enable): copy the tracked units, `systemctl daemon-reload` (8b).
Rollback: remove the unit files + `systemctl daemon-reload`.

## 3. Remote repository / worktree (dry-run)
Use git worktrees for isolation; never a shared mutable worktree. Per job:
- verify canonical repo + trusted branch + base commit;
- `git -C /srv/preston-os worktree add ../worktrees/<job> <base_commit>` (owner-run);
- a lock row (locks scope 'repository') must be held first;
- refuse reuse if the tree is dirty/staged/untracked (worktree.refusesDirtyReuse);
- capture a checkpoint before any handoff;
- cleanup (`git worktree remove`) only after status 'verified';
- NO automatic push, NO force operations. Owner pushes.
Dry-run first: print the plan, mutate nothing.

## 4. Activation sequences (owner-run)
Hermes observe-only:
    update system_controls set hermes_mode='observe_only', updated_at=now() where id='global';
  Then `systemctl start preston-hermes-observe`. Expect orchestration_decisions
  rows + HermesObserved events; no job enters 'running'. Rollback:
    update system_controls set hermes_mode='disabled' where id='global';

Worker simulation:
  `systemctl start preston-worker` (execution stays disabled). Expect
  job_checkpoints + job_attempts rows; every result executed=false. Rollback:
  stop the unit.

ChatGPT remote control: point the connector/action at the existing owner-only
  endpoints (owner session required): POST /api/os/command (proposal), GET
  /api/os/status, GET /api/os/queue, POST /api/os/control. All proposals only;
  no execution. Do not expose or commit any API key.

Telegram remote control: set TELEGRAM_OWNER_USER_ID + TELEGRAM_OWNER_CHAT_ID and
  TELEGRAM_INTAKE_ENABLED=true (Preview), point the bot webhook at /api/telegram.
  The receiver validates owner + freshness and never sends. Command insertion via
  a service identity is a later gate. Rollback: unset TELEGRAM_INTAKE_ENABLED.

## 5. Remote-Live Beta drill (owner-run; synthetic data only)
1. Services installed but disabled (section 2). 2. Start worker (sim). 3. Start
Hermes (observe). 4. Owner submits a GREEN test command (POST /api/os/command).
5. Confirm it is stored (runtime_command_packets) + audited (audit_log). 6. It
appears in GET /api/os/queue. 7. Hermes records an observe decision
(orchestration_decisions). 8. Worker simulates the job (job_attempts,
executed=false). 9. Checkpoint stored (job_checkpoints). 10. Status visible via
GET /api/os/status and /os. 11. Owner pause (POST /api/os/control action=pause).
12. Resume. 13. Stop. 14. Restart the units. 15. Checkpoint resumes safely
(read last job_checkpoint). 16. Close the laptop. 17. Server-side units continue
the sim. 18. Status stays available by phone (Telegram /status once enabled, or
the web /os). 19. Global kill (section 7) halts everything. 20. Rollback
(section 8) restores the disabled state.
Do NOT claim the drill passed until you actually run it.

## 6. Laptop-closed readiness
Ready to DRILL once sections 1-2 are done and the least-privilege identity exists.
Not "passed" until step 16-18 are owner-verified. No live business action occurs
at any point (execution disabled; worker simulates).

## 7. Global kill switch (always available, no deploy)
    update system_controls set owner_stop=true, execution_enabled=false,
      remote_runner_enabled=false, hermes_mode='disabled', paused=true,
      updated_at=now() where id='global';
Effect: worker/Hermes loops stop on owner_stop; nothing dispatches; readStatus
shows fully stopped. Also `systemctl stop preston-worker preston-hermes-observe`.

## 8. Full rollback
- Controls: run the kill (section 7).
- Services: stop + remove unit files + daemon-reload.
- Env: unset TELEGRAM_INTAKE_ENABLED; remove any worker/Hermes EnvironmentFile.
- Remote repo: remove worktrees (`git worktree remove`), keep the checkout or
  delete it; never force-push.
- Database: drop the additive Phase 2/3 tables per the earlier packets - NEVER
  the legacy command_packets.
- Git: `git revert <hash>` for any commit.
All non-destructive to business data.

## 8b. Phase 4B.1 - deployable dispatcher + systemd (tracked artifacts)
All artifacts are now in the repo; the owner writes NO runtime code on the host.

Build the dispatcher (deterministic):
    cd apps/dashboard && npm ci && npm run build:os-runtime
  Produces dist/os-runtime/bin.js (+ dist/lib/ai-os/*.js), CommonJS, Next-free.
  Health check (proves startup; exits 78 with no env, 0 when configured):
    node dist/os-runtime/bin.js health

Runtime env files /etc/preston/worker.env and /etc/preston/hermes.env (host
only; never in Git; one per service identity - these are the paths the tracked
units load). Required names (see PHASE_4B_WORKER_IDENTITY_PACKET.md section 1):
    SUPABASE_URL, SUPABASE_RUNTIME_KEY (anon), SUPABASE_RUNTIME_ENV=staging,
    SUPABASE_RUNTIME_TOKEN_STORE (0600 file in a 0700 dir owned by the service
    user), and - for the ONE-TIME --bootstrap run only -
    SUPABASE_RUNTIME_REFRESH_TOKEN (removed after bootstrap; the store then owns
    the rotating token). SUPABASE_RUNTIME_TOKEN is diagnostic-only.
Precondition (SQL, owner, once - Phase 3 packet): the system_controls singleton
must exist, or every control UPDATE and db-health probe matches zero rows:
    insert into system_controls (id) values ('global') on conflict do nothing;
Precondition (SQL, owner, once): apply migration 0005_phase4b1_id_alignment.sql
before expecting job_attempts / orchestration_decisions / os_events rows - the
runtime writes deterministic text ids that the pre-0005 uuid columns reject.

Install services (disabled; no auto-start):
    sudo cp deploy/systemd/preston-worker.service /etc/systemd/system/
    sudo cp deploy/systemd/preston-worker.timer /etc/systemd/system/
    sudo cp deploy/systemd/preston-hermes-observe.service /etc/systemd/system/
    sudo cp deploy/systemd/preston-hermes-observe.timer /etc/systemd/system/
    sudo systemctl daemon-reload
  Validate unit syntax: `systemd-analyze verify /etc/systemd/system/preston-*.{service,timer}`.
  NOTHING runs yet - the timers are not enabled.

Enable the beta (owner, when ready; still simulation/observe only):
    sudo systemctl enable --now preston-hermes-observe.timer   # after setting hermes_mode=observe_only
    sudo systemctl enable --now preston-worker.timer
  Each fires a bounded oneshot (node dist/os-runtime/bin.js worker-loop/hermes-loop --max 5);
  execution stays disabled by controls; workers only simulate.

Health / status:
    sudo systemctl list-timers 'preston-*'
    node dist/os-runtime/bin.js health
    GET /api/os/status ; /os control center

Uninstall / rollback:
    sudo systemctl disable --now preston-worker.timer preston-hermes-observe.timer
    sudo rm /etc/systemd/system/preston-worker.* /etc/systemd/system/preston-hermes-observe.*
    sudo systemctl daemon-reload
  SECURITY: also destroy the persisted (rotated) refresh tokens + env files:
    sudo shred -u <SUPABASE_RUNTIME_TOKEN_STORE path from worker.env and hermes.env>
    sudo shred -u /etc/preston/worker.env /etc/preston/hermes.env
  and revoke the service identities' sessions in Supabase (owner dashboard).
  Optional cleanup: `userdel preston-worker preston-hermes`, remove /var/log/preston.
  Plus the global kill (section 7). Non-destructive; no business data touched.

Telegram intake (Phase 4B.1 hardened; still owner-gated):
    Set TELEGRAM_WEBHOOK_SECRET (also as the setWebhook secret_token),
    TELEGRAM_OWNER_USER_ID, TELEGRAM_OWNER_CHAT_ID, TELEGRAM_INTAKE_ENABLED=true.
    The /api/telegram route verifies the secret token in constant time before
    reading the body, enforces size/freshness/owner/replay, and never sends.
    Command insertion via the service identity is a later gate.

## 9. Non-execution statement
The AI wrote docs + fail-closed code only. It installed nothing, started no
service, mutated no server, sent no message, ran no SQL, and enabled no
execution. Remote-Live Beta is simulation + observe only and is owner-activated.
