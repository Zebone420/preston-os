# Phase 5 — Remote-Live Staging Architecture (Verified, Documentation Only)

Status: DESCRIPTIVE. This document records what is verifiably built and
deployed as of this commit. It authorizes nothing, changes nothing, and
grants no new capability. Where an item exists only as authored-but-unapplied
or staged-in-worktree work, it is labeled explicitly as such. Companion docs:
`docs/PHASE_5_REMOTE_DRILL_RUNBOOK.md`, `docs/PRESTON_AI_REMOTE_LIVE_READINESS_PLAN_v1.md`,
`docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md`.

## 1. Verified deployed baseline

- Host: `preston-agent-staging` (Hetzner), reached only via the owner's SSH
  alias — never agent-initiated SSH (`docs/PRESTON_AI_POWERSHELL_SETUP_v1.md`,
  `docs/PRESTON_AI_SSH_ACCESS_SPEC_v1.md`).
- Canonical repository path on the host: `/srv/preston-os`
  (`reports/PHASE_4B_REMOTE_LIVE_OWNER_PACKET.md`,
  `reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md`).
- Branch: `master`. Verified commit: `f4fd2bce30ea3c6f4ce02b5a791ee5b4568d1201`
  (`docs(5): staging simulation, control/recovery drills, final job drill packets`).
- Runtime: Node `v24.18.0` (`.nvmrc` = `24`).
- Isolated per-job worktrees live under `/srv/worktrees/` and the canonical
  checkout at `/srv/preston-os` is never edited directly by a job. This is
  an operational convention enforced by owner process today (deploy packets
  in `reports/`); the code-level constant that pins it
  (`WORKTREES_ROOT = '/srv/worktrees/'` in
  `apps/dashboard/src/lib/ai-os/worktree.ts`) exists only in the staged
  Phase 5J worktree described in §5 — it is NOT part of the deployed
  baseline at this commit. As of drafting, worktrees on disk include
  `/srv/worktrees/wt-5j-orchestration` (branch `phase-5j-orchestration`,
  see §5) and `/srv/worktrees/wt-5j-doc-drill-001` (the drill worktree in
  which this document itself was authored).
- Deploy steps that produced this baseline are owner-run, not agent-run:
  `ssh preston-agent-staging`, `git pull --ff-only`, `npm ci --ignore-scripts`,
  `npm run build:os-runtime`, `sudo bash deploy/preflight-health.sh`
  (`reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md`).

## 2. Control plane (owner-gated Next.js routes)

Five routes under `apps/dashboard/src/app/api/os/`, each calling
`resolveOwner()` first and returning 401 if it fails:

| Route | File | Purpose |
|---|---|---|
| `GET /api/os/status` | `route.ts` (`status/route.ts`) | Read-only runtime status: execution/owner-stop/pause, Hermes mode, runner mode |
| `GET /api/os/queue` | `queue/route.ts` | Read-only list of recent command proposals + jobs |
| `POST /api/os/command` | `command/route.ts` | Intake: any command becomes a default-deny PROPOSAL only |
| `POST /api/os/enqueue` | `enqueue/route.ts` | Turns an existing GREEN proposal into one QUEUED staging job; `execution_enabled` stays `false` on the written row |
| `POST /api/os/control` | `control/route.ts` | Owner-only `pause`/`resume`/`stop`; never enables execution or the remote runner |

- **Proxy owner gate**: `apps/dashboard/src/proxy.ts` uses
  `evaluateOwnerGate()` in `apps/dashboard/src/lib/owner-auth.ts`. Missing
  Supabase auth env → `setup` (only `/login` renders); unauthenticated →
  `login`; authenticated but not allowlisted → `deny`.
- **Owner allowlist, fail-closed**: `isOwnerEmail()` reads
  `OWNER_EMAIL_ALLOWLIST` (comma-separated); an empty or missing allowlist
  means nobody is owner (`owner-auth.ts`). Each route handler additionally
  re-checks the owner inside the handler itself via `resolveOwner()`
  (`apps/dashboard/src/lib/ai-os/owner-context.ts`) — defense in depth over
  the proxy gate.
- **Audit log**: `audit_log` table, insert/select only for the owner role;
  `update`/`delete` are not granted (`supabase/migrations/0002_phase0b_owner_rls.sql`).
- **Idempotency**: `runtime_command_packets.idempotency_key` and the job
  enqueue path are `unique` DB columns — a replayed `idempotency_key` is
  rejected/returns `duplicate` rather than creating a second row
  (`supabase/migrations/0004_phase3_runtime.sql`,
  `apps/dashboard/src/app/api/os/enqueue/route.ts` comment).
- **Production-mention screening**: `submitCommandProposal` and
  `enqueueStagingJob` in `apps/dashboard/src/lib/ai-os/controlplane.ts`
  re-screen for production markers and write an audited
  `command_rejected:production_target` / `job_rejected:production_target`
  RED event before refusing.

## 3. Runtime (systemd timers → bounded dispatcher)

- Two disabled-by-default timer/service pairs in `deploy/systemd/`:
  `preston-worker.timer` → `preston-worker.service`, and
  `preston-hermes-observe.timer` → `preston-hermes-observe.service`.
- Each service is `Type=oneshot`, runs
  `/usr/bin/node dist/os-runtime/bin.js worker-loop --max 5` (worker) or
  `hermes-loop --max 5` (Hermes), and carries `RuntimeMaxSec=300`,
  `TimeoutStartSec=120`.
- Least-privilege runtime identities: `User=preston-worker` /
  `Group=preston-worker` for the worker service, `User=preston-hermes` /
  `Group=preston-hermes` for Hermes — separate from each other and from the
  owner (`deploy/systemd/preston-worker.service`,
  `preston-hermes-observe.service`).
- Hardening on both services: `NoNewPrivileges=true`, `ProtectSystem=strict`,
  `ProtectHome=true`, `PrivateTmp=true`, plus a scoped `ReadWritePaths` for
  each identity's own token-store directory (`/var/lib/preston/worker`,
  `/var/lib/preston/hermes`) so the atomic refresh-token rotation does not
  hit `EROFS` under `ProtectSystem=strict`.
- Rotating refresh-token store: `apps/dashboard/src/os-runtime/supabase-runtime.ts`
  — the dispatcher exchanges a stored refresh token for a fresh access token
  at each bounded run; a successful refresh's *rotated* token is persisted
  back to the store; a store that is empty, unreadable, malformed, or a
  refresh response missing a rotated token all fail closed (no fallback to a
  stale/consumed env token) except for an explicit one-time
  `allowBootstrap` seed.
- Staging gate, shared by every DB-touching dispatcher command
  (`apps/dashboard/src/os-runtime/dispatcher.ts`, `stagingGate()`):
  `SUPABASE_RUNTIME_ENV` must literally equal `staging` (fail-closed on
  anything else), and `SUPABASE_URL` is rejected if it matches
  `/\bprod(uction)?\b/i`.
- `db-health` command: an authenticated read-only probe
  (`probeControls()` in `apps/dashboard/src/lib/ai-os/store.ts`) that only
  counts as healthy when it actually reads ≥1 row — an RLS-filtered empty
  result does not count as a pass.

## 4. Safety boundaries and their enforcement points

| Boundary | Default | Enforcement point |
|---|---|---|
| `execution_enabled` | `false` | `DEFAULT_CONTROLS` in `apps/dashboard/src/lib/ai-os/controls.ts`; `isHalted()` treats anything other than `execution_enabled === true` as halted; the worker loop's DB write path (`os_jobs_worker_upd` RLS policy in `0007`, see below) requires `execution_enabled = false` in its `with check`; the staging cycle (`staging-sim.ts`) is simulation-only regardless |
| `remote_runner_enabled` | `false` | `SystemControls.remote_runner_enabled` (`controls.ts`); readiness plan (`docs/PRESTON_AI_REMOTE_LIVE_READINESS_PLAN_v1.md`) states no remote runner is authorized while this is false |
| `hermes_mode` | `disabled`/`observe_only` ceiling | `decide()` in `apps/dashboard/src/lib/ai-os/hermes.ts`: `observe_only` always returns `{decision:'observe'}` and never reaches the dispatch/propose branches; the dispatcher's `hermes-loop` calls `hermesObserveLoop`, which only inserts into `orchestration_decisions`/`os_events`; the `0007` migration's RLS policies grant the `hermes` runtime role no lease or update privilege anywhere |
| `owner_stop` / `paused` halt | halts immediately | `isHalted()` (`controls.ts`); `runDispatcher()` checks `pre.owner_stop \|\| pre.paused` before any loop work and exits `EXIT.halted` (`75`) without touching a candidate |
| service-role key | never used by the runtime client | `supabase-runtime.ts` comment: builds an "RLS-bound client for the worker/Hermes SERVICE IDENTITY — an owner-allowlisted authenticated user, NEVER the service-role key" |
| RLS owner-only, plus unapplied least-privilege roles | owner-only today | `supabase/migrations/0002_phase0b_owner_rls.sql` (`is_owner()` gate on every table). `supabase/migrations/0007_phase5h_runtime_roles.sql` **adds** two bounded non-owner roles (`worker`, `hermes`) additively via new permissive policies — **this migration is authored and reviewed but NOT applied**; its own header states "apply only at the identity-hardening gate, AFTER the staging drill has passed" |
| Append-only evidence tables | insert/select only | `job_checkpoints`, `job_attempts`, `orchestration_decisions`, `dead_letters`: `revoke update, delete ... from authenticated, anon` in `0004_phase3_runtime.sql`; `os_events` likewise in `0003_phase2_ai_os_core.sql`; `audit_log` likewise in `0002_phase0b_owner_rls.sql` |
| Lease CAS + token fencing | one active worker per job | `worker_leases` has `unique (job_id)` (`0004_phase3_runtime.sql`); `leases.ts` `canLease()`/`lease()`/`renew()` require a matching `(owner, token)` pair for anything but an already-expired lease, so the DB unique constraint plus token compare is the real mutual exclusion |
| Crash recovery | fail-closed resume | `resolveResume()` in `apps/dashboard/src/lib/ai-os/checkpoint.ts`: a missing checkpoint → `fresh`; a checkpoint matching this job/correlation and `status='complete'` → `skip_completed` (idempotent no-op); anything corrupt, foreign, or correlation-mismatched → `reject` (touches nothing); expired leases are swept back to `queued` each worker cycle (`staging-sim.ts`, `recovered` counter) |

## 5. Multi-agent orchestration (Phase 5J — in progress, staged in worktree, NOT deployed)

The Phase 5J orchestration work exists only as **uncommitted working-tree
changes** inside the isolated worktree `/srv/worktrees/wt-5j-orchestration`
(git branch `phase-5j-orchestration`). It is not committed on that branch,
not merged to `master`, and not present anywhere on the deployed staging
host. It is described here for transparency about work in flight, not as a
deployed capability.

Observed there (`git status` in that worktree shows these as modified/untracked):

- **Shared job envelope** (`apps/dashboard/src/lib/ai-os/envelope.ts`, new,
  untracked): a `JobEnvelope` type with hard invariants enforced by
  `validateJobEnvelope()` — `environment` must literally be `'staging'`;
  `execution`, `push`, `deploy` must literally be `false`; `risk_class` may
  never be `RED`/`BLACK`; `assigned_implementer` must be `'claude'` and
  `assigned_reviewer` must be `'codex'`, and the two must differ;
  `allowed_operations` is restricted to a fixed allowlist (`read_repo`,
  `edit_docs`, `edit_code`, `run_tests`, `run_lint`, `run_build`,
  `secret_scan`, `boundary_scan` — no shell/exec/network verb);
  `prohibited_operations` must always include `push`, `deploy`,
  `production_access`, `secret_access`, `network_egress`; `worktree_path`
  must resolve under `/srv/worktrees/` with no traversal; free-text fields
  are scanned and rejected if secret-shaped.
- **Hermes routing (observe-only)**: `hermes.ts` and `orchestrator.ts` show
  modifications in the worktree toward routing recommendations; the
  deployed `hermes.ts` on master already enforces the `observe_only` mode
  ceiling described in §4, and nothing in the worktree changes that ceiling.
- **Isolated worktree flow**: `worktree.ts` (modified in the worktree) adds
  `worktreePreparePlan()` — a pure planner (runs no git itself) that
  produces an ordered `argv`-only command plan (never a shell string) for an
  **owner-run** prepare script: verify a clean canonical tree, verify the
  base commit exists, acquire the repo lock, `git worktree add
  /srv/worktrees/wt-<job> -b job/<job> <base_commit>`, verify the new
  worktree is clean, record a checkpoint, and grant the reviewer read-only
  access to that same worktree (no second write-tree for review). It refuses
  when implementer and reviewer are the same actor.
- **ChatGPT intake route (new, untracked)**:
  `apps/dashboard/src/app/api/os/chatgpt/route.ts` — a bearer-token
  authenticated, disabled-by-default (`CHATGPT_INTAKE_ENABLED`),
  proposal-only intake endpoint for a future owner-configured ChatGPT
  connector. It is deliberately not owner-session-gated (server-to-server),
  which is why `apps/dashboard/src/proxy.ts` is modified to exclude it from
  the cookie gate; the route self-authenticates with a constant-time token
  compare and can only create default-deny command proposals — never
  enqueue, execute, or run shell.
- **Job cancel route (new, untracked)**:
  `apps/dashboard/src/app/api/os/jobs/cancel/route.ts` — owner-session-gated;
  sets `cancel_requested=true` on a job. Supporting edits in
  `controlplane.ts` (adds a `kill` control action = `owner_stop` + `paused`,
  RED-audited, plus `cancelJob`), `store.ts` (adds `requestJobCancel`), and
  `control/route.ts` (allowlist gains `kill`).
- **Worker/Hermes support edits**: `staging-sim.ts` (Hermes observe batches
  gain a fail-closed, read-only command-packet hint lookup for task
  classification).
- **Safety-hook change (modified)**: `githooks/pre-commit` gains a bash
  fallback that runs new Linux ports of the two safety scanners
  (`scripts/secret_scan.sh`, `scripts/red_boundary_scan.sh`) when
  `powershell.exe` is unavailable, and fails closed (blocks the commit) if
  neither scanner runtime exists. This is a safety-guard file change and is
  called out here explicitly for owner review per CLAUDE.md.
- Also present but not yet committed: `supabase/migrations/0008_phase5j_orchestration_envelope.sql`,
  `scripts/worktree_prepare.sh`, test files `envelope.test.ts`,
  `chatgpt-route.test.ts`, `hermes-routing.test.ts`, `worktree-prep.test.ts`,
  updated `controlplane.test.ts` / `orchestrator.test.ts`, updated
  `scripts/README.md`, and owner-run packets under `reports/PHASE_5J_*.md`.
- Owner gates still apply unchanged: any commit, push, migration apply, or
  service-file change coming out of this work requires the same owner
  approval gates as every other phase in this repo (CLAUDE.md build rules).

## 6. What this system cannot do today

- No live business writes (Airtable, Drive, Supabase business tables) —
  every runtime write path observed above is confined to control-plane
  evidence tables (`os_jobs`, `worker_leases`, `job_attempts`,
  `job_checkpoints`, `dead_letters`, `orchestration_decisions`, `os_events`,
  `audit_log`).
- No emails, SMS, WhatsApp, or Telegram sends. The Telegram path
  (`0006_phase5g_telegram_updates.sql`) is dedup bookkeeping for inbound
  replay protection only; per that migration's own comment, it is "written
  only by the command-insertion activation gate (a later owner gate)".
- No production access: the `stagingGate()` denylist in `dispatcher.ts`
  refuses any `SUPABASE_URL` containing `prod`/`production`, and
  `controlplane.ts` rejects any command/job mentioning a production target.
- No push, no deploy: `workerPushAllowed()` in `worktree.ts` returns `false`
  unconditionally; the Phase 5J envelope's `push`/`deploy` fields are
  type-pinned to the literal `false` and validated as such.
- No autonomous shell: the dispatcher runs pure TypeScript logic against the
  Supabase client; `worktreePreparePlan()` only ever returns descriptive
  `argv` arrays for an owner-run script, never invoking a shell itself; the
  Phase 5J envelope's allowed-operations vocabulary excludes any shell/exec
  verb by construction.
- No self-activation: neither `preston-worker.service` nor
  `preston-hermes-observe.service` carries an `[Install]` section — a
  service can never enable itself. The corresponding `.timer` units do carry
  `[Install] WantedBy=timers.target` (required so `systemctl enable` has
  something to target), but each timer file's own comment states it stays
  "INACTIVE until the owner runs `systemctl enable --now <timer>`" — placing
  or pulling these files never activates anything.

## 7. Verification pointers

- Runtime logs: `/var/log/preston/worker.log` and `/var/log/preston/hermes.log`
  (`StandardOutput`/`StandardError` in the two `.service` units); all lines
  are JSON, redacted via `redactSecrets()` before being logged
  (`apps/dashboard/src/os-runtime/dispatcher.ts`, `jsonLogger()`).
- Owner packets and drill evidence: `reports/` at repo root (e.g.
  `reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md`,
  `reports/PHASE_5_LEAST_PRIVILEGE_IDENTITY_PACKET.md`,
  `reports/PHASE_5_CONTROL_RECOVERY_DRILL_PACKET.md`,
  `reports/PHASE_5_REMOTE_LIVE_JOB_DRILL_PACKET.md`).
- Evidence binder template for the remote drill:
  `docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md` (pass/fail rows, no secrets, no
  host details).
- Automated test suite: 30 `*.test.ts` files under `apps/dashboard/test/`,
  run via `npm test` → `vitest run` (`apps/dashboard/package.json`).
- Unresolved facts: `docs/PRESTON_AI_VERIFICATION_REGISTER_v1.md` (V1–V9)
  remain unverified until the owner rules on them and must never be treated
  as fact in this or any client-facing document.
