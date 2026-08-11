# PRESTON AI OS - GOLDEN STAGING BASELINE

Single source of truth for the proven staging system. Supersedes ad-hoc
state notes. Date: 2026-08-11 UTC.

## Commits

- Canonical repo (origin/master == local master): b4f1b71
- Staging host HEAD: b4f1b71 (detached; runtime rebuilt Aug 11 04:47)
- Vercel serving (Production): b4f1b71 (state success, alias
  preston-os-staging.vercel.app)
- Last live-proven RUNTIME commit: f80553d (real exec x3). Delta
  f80553d..b4f1b71 = web-only route fix + tests + docs; os-runtime
  build graph is files:[src/os-runtime/bin.ts] so the host runtime is
  byte-equivalent to the proven build. Route fix is Vercel-served and
  live-proven (S4 legacy + actor both PASS at b4f1b71).
- ORCH_BASE_COMMIT: intended = b4f1b71 (owner aligns via worker.env);
  prior 9b67292 is a valid ancestor, correctness-safe either way.
- Rollback points: PREV runtime f80553d; PREV Vercel d433f51;
  pre-SSOT-route d433f51->6ff86f9; deeper e922db0 (pre-11R).

## Runtime / host

- Host preston-agent-staging (168.119.153.173), up 20+ days.
- systemd: preston-orchestrator.timer ENABLED (~5min);
  preston-worker.timer DISABLED; preston-hermes-observe.timer DISABLED.
- orchestrator unit: Type=oneshot, TimeoutStartSec=3600,
  SuccessExitStatus=75, flock-serialized, ProtectSystem=strict,
  ReadWritePaths=/var/lib/preston/worker /srv/worktrees
  /srv/preston-os/.git ; last ExecMainStatus=0 Result=success.
- Real executor: ORCH_CLAUDE_EXECUTABLE=
  /var/lib/preston/worker/.local/bin/claude (persisted login as
  preston-worker, HOME=/var/lib/preston/worker). CHILD_ENV_ALLOWLIST
  carries no token vars; credential is file-based only.
- /srv/worktrees: only inert wt-5j-* residue (clean).
- KNOWN dirty-tree item (inert, non-runtime): route.ts on host is a
  root:root Aug-9 leftover holding OLD pre-fix content; the host does
  NOT serve HTTP (Vercel does), so runtime is unaffected. Clean via
  the owner action below for a spotless tree.

## SSOT state (S1-S4 PASS)

- Migrations 0012-0014 applied to staging DB. actor_registry RLS on,
  anon privileges 0.
- Enabled actors (3): owner-remote-1, chatgpt-1, claude-1 (sha256
  hashes only, 64 chars each). codex + hermes actors deferred.
- SSOT_STATUS_ENABLED=true (Vercel). GET /api/os/ssot/status:
  unknown/absent token -> 401; per-actor -> 200 (verified).
- Intake auth delegated to submit_remote_intake (0014): legacy global
  token accepted with actor_id NULL (rops-v1-legacy-check-02 PROVEN);
  actor token stamps actor_id (rops-v1-ssot-stamp-01 -> claude-1
  PROVEN). remote_intake_config.token_hash present (64, prefix
  b65be4d3).

## Safety posture (all intact)

- Approvals owner-only. execution_enabled/remote_runner enabled during
  drills (capability proof); owner_stop=false, paused=false.
- Kill switch drill-proven (global owner_stop halt, exit 75).
- goal_jobs.executed CHECK-pinned (real runs record executed:true in
  evidence refs only). RLS verified. No production touched. No live
  messages/emails. No unintended external writes.

## Latest live evidence

- Real exec x3: goals 69baec6b (11r-16, crash-recovery), a825ac23
  (11r-17 repeat), 0e700d29 (actor-attributed) - each
  real:...:completed:executed:true + real-audit:...paths_ok:clean.
- Docs: PRESTON_AI_OS_FINAL_GO_LIVE_REPORT.md,
  REMOTE_OPERATIONS_V1_STAGE_11R_CLOSURE_EVIDENCE.md.

## Backup of record (pre-P0, post-0015)

- File: C:\dev\backups\preston-os-staging-2026-08-11.dump
- Size: 575,399 bytes; pg_restore TABLE DATA entries: 83
- SHA-256: 9e338eb559b12adf064c9a9d07c6add7e6046f7c0695f87fdfbd8209db59f12a
- Method: pg_dump -Fc via session pooler :5432, interactive password.
- Covers the full post-0015 schema (49 public tables + auth-readable).
- Supersedes the 2026-07-27 dump as the staging restore point.
- OFF-HOST COPY still owed (LA-10 discipline): owner copies the file
  to a second physical location when convenient.

## Migration 0015 applied to staging (2026-08-11)

anon table privileges 0 (was 23), anon sequence ACLs 0, RLS coverage
unchanged (0 tables without RLS), gateway EXECUTE path live-proven
post-sweep (bad-token 401 forbidden on both remote routes).

## Baseline seal status (2026-08-11)

1. ORCH_BASE_COMMIT: DONE - aligned to b4f1b71 full hash
   (owner-verified grep count 1).
2. Host tree: DONE - root-owned route.ts leftover chowned + restored;
   git status clean (owner-verified, agent re-verified).
3. Firewall: OWNER RULING 2026-08-11 - all current TCP/22 /32 rules
   stay in place deliberately (multi-location access need); cleanup
   reclassified as deferred housekeeping, NOT a blocker. Posture
   remains drop-by-default + key-auth-only.
Baseline is SEALED. Remaining deferred (non-blocking): off-host
backup copy, firewall tidy, driver lock-skip observability (P1),
route env-allowlist (P1).
