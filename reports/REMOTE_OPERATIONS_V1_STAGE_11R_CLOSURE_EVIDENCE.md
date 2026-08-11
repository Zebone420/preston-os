# STAGE 11R - REAL EXECUTION CLOSURE EVIDENCE (PASS, REPEATABLE)

Date: 2026-08-11 UTC. Host runtime commit: f80553d. Staging only.

## Verdict

STAGE 11R PASS + REPEATABILITY PASS.

Two consecutive drill goals completed with GENUINE bounded real
execution on the deployed staging host, laptop out of the execution
path, zero unintended simulation fallback, path confinement enforced
and clean, worktrees created AND removed, lifecycle persisted.

## The two passing runs (agent-verified: log + postgres-level DB)

PASS 1 - request rops-v1-drill11r-16, tick disp-151746 (03:01 UTC):
- goal 69baec6b-1746.. job 1d8d89d5.. attempts=1 completed
- real:goal:69baec6b...:job:1d8d89d5...:attempt:1:completed:executed:true
- real-audit:job:1d8d89d5...:paths_ok:clean
- included live recovery of BOTH crash legacies: stale worktree-lock
  takeover (expired 02:58:25) and orphan worktree removal.

PASS 2 - request rops-v1-drill11r-17, tick disp-151994 (03:1x UTC):
- goal a825ac23.. job 074085f2.. attempts=1 completed, cycles=1
- real:goal:a825ac23...:job:074085f2...:attempt:1:completed:executed:true
- real-audit:job:074085f2...:paths_ok:clean
- clean-path repeat: no orphan, no lock contention, single tick.

Common: capability line level_resolved=BOUNDED_CODE_EXECUTION
executor=composed; child fingerprint PATH/HOME/LANG with
child_home=/var/lib/preston/worker; stdout excerpts show real agent
work (git archaeology of the 11R commit history for the doc task);
/srv/worktrees back to inert 5J residue after each run; goal_jobs
executed COLUMN untouched (0010 CHECK pin) - executed:true lives in
the evidence ref by design.

## Defect chain found live and fixed during 11R (all pushed)

1. 13d71dd intake silent clog: every selected row now accounts for
   itself (selected + mark_failed in tick log) + regression test.
2. Credential truth: service-user CLI login must be PERSISTED via
   interactive /login as preston-worker (setup-token prints a token
   but does not persist a login; a re-mint rotates the old one).
   Diagnosed via 4955a8c spawn fingerprint + stderr/stdout excerpts
   (885ff72).
3. f80553d TimeoutStartSec 120->3600 on the orchestrator unit only
   (worker/hermes stay 120): 120s killed genuine multi-minute real
   runs; adapter 15-min tree-kill stays the per-attempt bound.
4. f80553d provisionWorktree orphan recovery: remove+retry ONCE on
   add-failure (killed-run residue) + regression tests.

Client-side finding (not a system defect): drill submissions relayed
through a ChatGPT intermediary produced fabricated/mis-id acceptance
claims; canonical rule reaffirmed - drill evidence only from direct
API responses + DB/log ground truth. Composer correctly rejects
execution-mode wording in request text (unsupported_execution_mode).

## Known follow-ups (non-blocking, registered)

- driver.ts lock-acquisition failure path is a silent `continue`;
  add a bounded observability line (one diagnosis round cost).
- ORCH_BASE_COMMIT in worker.env still 9b67292 at PASS time (valid
  ancestor; refresh at next owner repin).
- Hetzner firewall temp rules cleanup: remove ZPC26 /32
  (174.216.209.19) after Gate H work ends; review the
  174.244.146.219 rule's provenance.
- Terminal failed drill residue goals (c8e3f108, cba9d486, 9689c1e4)
  + rejected intake rows: inert, cleanup at next residue ruling.

## Gate report fields

- Production touched: false. Secrets exposed: false (fingerprint =
  env NAMES + HOME path only). Live messages/emails: false.
- Next gate: SSOT S1-S4 staging activation (owner packet), then
  final go-live report.
