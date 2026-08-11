# PRESTON AI OS - FINAL PRE-PRODUCTION AUDIT

Date: 2026-08-11 UTC. Audit-only run; no production activation.
All states below independently re-verified this run (no reliance on
prior PASS claims except where marked live-proven with timestamps).

## 1. Canonical commits

- origin/master == local master: 99b3f4f (audit fixes land after).
- Staging host: b4f1b71 (runtime-equivalent to live-proven f80553d;
  delta was web/docs-only, verified via os-runtime build graph).
- Vercel serving: b4f1b71 (Ready). ORCH_BASE_COMMIT: b4f1b71 (owner-
  verified grep=1).

## 2. Staging host - PASS

Pinned b4f1b71, tree clean (0), timers orchestrator-enabled/worker-
disabled/hermes-disabled, unit hardening intact (TimeoutStartSec=3600,
SuccessExitStatus=75, ProtectSystem=strict + exact ReadWritePaths),
ticks healthy (parked-residue skips only), worktrees = inert 5j pair,
job/* residue branches swept this run (6 deleted; by-design one-per-
job residue from the 3 real runs). Claude executable path owner-
verified; credential live-proven by 3 real executions ~3h before this
audit.

## 3. Vercel staging - PASS

b4f1b71 success; alias 307->login; ALL remote surfaces fail-closed
probes this run: ssot no-auth 401, ssot bad-token 401, goal no-auth
401, status no-auth 401.

## 4. Supabase staging - PASS WITH HOUSEKEEPING

Parity target (P0-0) captured: 49 public base tables (string recorded
in SQL evidence; runtime_roles absent = 0007 deferred confirmed).
RLS: 0 tables without RLS. Controls: execution/remote-runner TRUE
(deliberate active remote-live posture), owner_stop/paused FALSE.
Intake queue: 0 pending. Actors: exactly 3 enabled, hashes 64.
HOUSEKEEPING FINDING (fixed-in-repo): 23 tables still carried default
anon TABLE grants from pre-0009-era migrations - zero row access
(RLS owner-only everywhere) but a defense-in-depth gap and a P0-3
verification mismatch. Fix drafted as migration 0015 (+static pins);
OWNER applies to staging once, and it joins the P0-2 chain.

## 5. SSOT - PASS

S1-S4 evidence intact and re-probed: read surface refuses correctly
(401 x2 this run), 3 actors enabled, stamping (claude-1) and legacy
(actor_id NULL) rows both persisted, no pending rows, no competing
truth surfaces introduced since.

## 6. Security - PASS WITH HOUSEKEEPING

RLS full coverage; anon row-access zero everywhere; gateways refuse
unknown tokens; no secrets in repo (secret scan 0); RED boundary scan
0; child env allowlist carries no token vars; firewall drop-by-default
with 6 x TCP/22 allowlist entries. HOUSEKEEPING: temp rule
174.216.209.19 (this machine) + unvetted 174.244.146.219 + two
undescribed rules await the deferred owner cleanup; anon grant sweep
0015 awaits owner apply; staging pg_dump backup PREDATES migrations
0009-0014 (Jul 27) - fresh owner dump recommended before P0.

## 7. Tests / builds (this run, at 99b3f4f)

vitest: 1234 pass + 1 expected fail (D2-L1) + 5 known Windows env-
class (worktree-prep scanner self-scan; compensated by direct
scanners 0/0). tsc app + osruntime: 0. Next build (Turbopack): PASS.
os-runtime build: PASS. New audit test migration-0015: 4/4.

## 8-9. Regression checks on every 11R/S1-S4 defect

- intake silent rows: FIXED+DEPLOYED (selected/mark_failed in log;
  regression test) - no silent rows possible; queue 0 pending.
- Claude executable path: owner-verified correct.
- Claude auth persisted: live-proven x3 (~3h old evidence).
- child env sanitation: allowlist pinned + fingerprint in result log.
- TimeoutStartSec: 3600 on installed unit (re-read this run) + test.
- orphan worktree recovery: code + tests + live-proven (69baec6b).
- stale-lock takeover: live-proven (fence takeover, same goal).
- Vercel blank env value: SSOT flag verified live (401s); operating
  rule recorded (verify via edit form).
- web-tier legacy pre-gate: REMOVED (d433f51) + source pin test.
- actor hash length: all 3 = 64 (re-verified).
- actor stamping / legacy compat: both rows re-verified this run.
- SSOT negative auth: 401 x2 re-probed this run.
- sim fallback: none on any real run; decline paths all logged.
DEFECTS FOUND THIS AUDIT: (1) anon table grants x23 -> 0015 drafted
(owner applies); (2) job/* residue branches -> swept; (3) driver
lock-skip silent continue -> REGISTERED, deliberately NOT patched in
this run to keep the golden runtime untouched; scheduled as the first
P1-entry code item together with the staging-env route allowlist.

## 10. Remaining owner gates (unchanged)

Firewall cleanup; 0015 apply (staging); fresh staging backup; P0
execution (prod Supabase + Vercel); P1 route env-allowlist code gate;
hermes timer; codex actor/executable; telegram dedup + activation;
all customer/business writes; payments; sends.

## 11. Production activation blockers

None structural. Everything on the path is an enumerated owner gate
with a packet. Architecture audit: no missing migrations (chain
0001..0015, 0007 deferred by design); rollback documented per layer;
secret-reuse forbidden by packet (fresh prod tokens/credentials);
actor ids collision-free (separate DB); n8n excluded from truth
(consumer-only per consolidation audit; LA-1 public-console finding
stands, unrelated to this stack); hermes cannot bypass approvals
(observe-only code + timer off); codex cannot bypass controls (no
actor, no executable gate, adapter refuses role); ChatGPT cannot
bypass attribution (actor tokens + relay-integrity rule); audit
callbacks present (access_events/audit_log + tick logs + evidence
refs); no unrestricted execution path (capability chain + allowlist +
CHECK pins re-verified).

## 12. Recommendation

Apply 0015 to staging, take the fresh staging backup, do the firewall
cleanup, then run P0 with the updated packet. The system is ready for
the Full Multi-Agent Production Activation master goal.

## Component classification

GitHub/master PASS | Staging host PASS | Vercel staging PASS |
Supabase staging PASS WITH HOUSEKEEPING | SSOT PASS | Remote intake
PASS | Goals/tasks/approvals PASS | Orchestrator PASS | Real executor
PASS | Claude runtime/auth PASS | systemd PASS | Worktrees/locks PASS
(observability item registered) | Firewall/SSH PASS WITH HOUSEKEEPING
| RLS/security PASS WITH HOUSEKEEPING | Env vars PASS | Actor
registry PASS | Audit/evidence PASS | Backups PASS WITH HOUSEKEEPING
(stale dump) | Staging/prod separation PASS (packet-enforced) |
Production packets PASS | Codex OWNER-GATED (by design) | Hermes
OWNER-GATED (by design) | n8n OWNER-GATED (excluded from truth) |
ChatGPT path PASS (attribution live-proven) | Deferred gates PASS
(all enumerated).

## Verdict

FINAL AUDIT PASS - READY FOR FULL MULTI-AGENT PRODUCTION ACTIVATION

Production touched: false. Secrets exposed: false. Live messages or
emails sent: false.
