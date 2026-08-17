# HERMES PRODUCTION DELTA PACKET v1 (H1 staging timer, H2 prod)

Date: 2026-08-17. Status: PLAN. Nothing here activates anything.
This is the "Hermes H1 then H2" delta promised in
reports/PRESTON_PRODUCTION_ACTIVATION_STATUS.md. Definition source:
PRESTON_PRODUCTION_ACTIVATION_MATRIX_v1.md item I ("staging timer
activation is its own gate; prod after that"):

  H1 = enable the STAGING preston-hermes-observe.timer (observe-only)
  H2 = provision + enable Hermes observe-only on preston-agent-prod

Hermes SENDS remain RED forever until explicitly gated (matrix
standing RED list). Neither H1 nor H2 grants Hermes any lease,
execution, or write-to-os_jobs capability - observe_only records
decisions/events only (verified design: PHASE_5J packet section 1).

## Sequence position

After: P2 Claude bounded prod execution PASS, Codex individual proof,
Claude+Codex team mode (per the activation status record sequence).
H1/H2 do not depend on each other's DB env but H2 reuses H1's verified
procedure - run H1 first.

## Code/infra ground truth (verified 2026-08-17, laptop, commit fcf3e4d)

- Unit deploy/systemd/preston-hermes-observe.service: runs as its OWN
  least-privilege user preston-hermes (not preston-worker), env file
  /etc/preston/hermes.env, token store under /var/lib/preston/hermes,
  ExecStart hermes-loop --max 5, TimeoutStartSec=120, no [Install]
  on the service - only the owner-enabled timer fires it.
- hermes-loop halts on disabled/stopped/owner_stop/paused; requires
  system_controls.hermes_mode='observe_only' to do any work; recording
  is idempotent (duplicate decisions are no-ops).
- Routing recommendation reasons (route:*) are advisory-only strings
  on observe decisions (PHASE_5J packet has the eight-check
  verification table H1..H8 - reused below unchanged).

## H1 - STAGING hermes-observe timer activation (owner-run)

H1-1  Preconditions: staging host at golden baseline pin or later;
      /etc/preston/hermes.env exists with STAGING values and a
      POPULATED hermes token store (separate identity - never the
      worker's store); system_controls.hermes_mode='observe_only'.
H1-2  systemctl enable --now preston-hermes-observe.timer
H1-3  Verify with reports/PHASE_5J_HERMES_VERIFICATION_PACKET.md
      (all eight checks H1..H8; SQL is read-only).
H1-4  Evidence: paste posture query, one decisions row with route:*
      reasons, hermes.log tail (stoppedReason completed), and the
      zero-lease / zero-attempts counts.
H1-5  Rollback: systemctl disable --now preston-hermes-observe.timer
      (and hermes_mode='disabled' via SQL if Hermes specifically must
      be silenced - control-plane pause does not touch hermes_mode).

## H2 - PRODUCTION Hermes observe-only (owner-run, after H1 PASS)

H2-1  On preston-agent-prod (P2 runbook host, already hardened):
      create user preston-hermes (no sudo, own home
      /var/lib/preston/hermes), mkdir -p /var/lib/preston/hermes.
H2-2  /etc/preston/hermes.env (root:root 0600) - mirror the staging
      hermes.env, swap ONLY:
        SUPABASE_RUNTIME_ENV=production
        SUPABASE_URL=https://hiqsymsiwonmvrbbqhhe.supabase.co
        SUPABASE_RUNTIME_KEY=<prod anon public key>
        SUPABASE_RUNTIME_TOKEN_STORE=/var/lib/preston/hermes/token-store.json
      Fresh PROD refresh token for the store bootstrap - NEVER the
      staging credential and NEVER the worker's prod store
      (fresh-credential + separate-identity rules).
H2-3  One-time store bootstrap as preston-hermes (db-health
      --bootstrap pattern from the P2 runbook H-5, run with the hermes
      env), then plain db-health must return ok.
H2-4  Install preston-hermes-observe.service/.timer from the pinned
      repo checkout; verify hardening lines match the unit in git
      (ProtectSystem=strict, ReadWritePaths=/var/lib/preston/hermes,
      LogsDirectory=preston). ENABLE NOTHING yet.
H2-5  Ensure prod system_controls.hermes_mode='observe_only' (the
      global row; insert-if-absent with everything else false).
H2-6  systemctl enable --now preston-hermes-observe.timer
H2-7  Verify: the SAME eight checks as H1, run against the PROD DB
      (owner psql; evidence files under reports/p2_evidence/ or a new
      reports/hermes_evidence/). At least one observed decision row
      requires a queued/checkpointed job to exist; if the prod queue
      is empty, posture + log checks (H1, H8) plus zero-lease /
      zero-attempt checks (H5, H6) close the gate, and the decisions
      check completes at the next real goal.
H2-8  Rollback: disable the timer; hermes_mode='disabled';
      owner_stop=true halts everything (inherited kill switch).

## Invariants (do not weaken)

Separate hermes identity + token store (never worker/owner creds);
observe_only is the only legal mode in this packet; no lease, no
job_attempts, no os_jobs mutation by Hermes; sends stay RED; all SQL
verification is read-only; evidence = files/DB/log ground truth only
(no relayed claims).
