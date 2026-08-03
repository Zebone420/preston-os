# PHASE 7 - GATE CL-2/2 HOST RE-PIN - CLOSE EVIDENCE (PASS)

Closed: 2026-08-03 (UTC). Decider: owner (ran the full E1-E11 sequence
from PHASE_7_CL2_HOST_REPIN_OWNER_PACKET.md on preston-agent-staging).
Result: CLOSED PASS - every packet PASS criterion met, zero STOP
conditions hit.

## Owner-reported evidence (verbatim summary)

- E1 PASS: host preston-agent-staging, user grann, initial HEAD =
  0c287b09fb17185ec67e55e15c2e09eb87a780ab (PREV - containment had
  been applied), dirty 0.
- E2 PASS: worker/orchestrator/hermes-observe timers all disabled;
  all three services inactive.
- E3 PASS: c24a7e5834e86248e1ba67ad84d7959424472cf4 verified present
  after fetch.
- E4 PASS: detached checkout exactly at the TIP hash; commit message
  "fix(deps): restore emnapi entries lost in jsdom lockfile
  regeneration"; dirty 0.
- E5 PASS: untrusted bin.js (Jul 30 05:57 UTC, built after the failed
  npm ci at 641f497) existed and the old dist was MOVED aside to
  dist.untrusted.20260803T033009Z (not deleted).
- E6 PASS: npm 11.16.0; npm ci --dry-run exit 0; npm ci exit 0. No
  audit fix, no new install-script approvals. (Closes the CL-2/3
  lockfile validation that FAILED at 641f497 - the c24a7e5 emnapi
  repair is proven on the host npm line.)
- E7 PASS: build:os-runtime exit 0; fresh bin.js Aug 3 03:31 UTC;
  health emitted the missing-env fail-closed warning and exit 78.
- E8 PASS: worker.env preston-worker:preston-worker 600; hermes.env
  preston-hermes:preston-hermes 600; ORCH_BASE_COMMIT name count 1;
  ORCH_ALLOWED_PATHS name count 1; exact-TIP ORCH_BASE_COMMIT count 1.
- E9 PASS: six installed systemd units byte-identical to the repo
  versions at TIP (diff silent).
- E10 PASS: env names present; token store preston-worker 600;
  authenticated read-only db-health ok:true; PREFLIGHT: PASS exit 0.
- E11 PASS: timer/service posture identical to E2 (3x disabled,
  3x inactive).

## Independent read-only verification (build agent, ssh, 2026-08-03)

Performed AFTER gate close, no sudo, no mutations:

- git rev-parse HEAD = c24a7e5834e86248e1ba67ad84d7959424472cf4
- bin.js present, 4,958 bytes, Aug 3 03:31 (matches E7)
- timers: disabled x3; services: inactive x3 (matches E11)
- git status --porcelain shows exactly ONE untracked entry:
  `?? apps/dashboard/dist.untrusted.20260803T033009Z/` - the intended
  Section-5 quarantine of the untrusted build. Tracked tree is clean.
  Disposal of the quarantine dir = optional owner cleanup AFTER the
  CL-3 drill proves the trusted build (never before).

## State ledger after this gate

- Host: PINNED c24a7e5 (detached), trusted runtime BUILT, preflight
  PASS. Nothing ACTIVATED: no timer enabled, no service started,
  simulation-only posture unchanged.
- Vercel: c24a7e5 DEPLOYED and owner-verified (Block V' PASS
  2026-08-03: commit + dpl_GDMXCJygBj8UfgM9LQizeCon1oFV + chips
  false/false/observe_only all directly confirmed on the dashboard;
  matches the anonymous evidence chain: alias dpl via Link header +
  GitHub deployments API latest Production = c24a7e5 success).
- Repo: master==origin/master==c24a7e5. Branch phase7/offhost-0802
  carries the 4 off-host commits + this evidence commit (UNPUSHED -
  owner pushes; classifier denies agent push).
- ORCH_BASE_COMMIT = full c24a7e5 hash; ORCH_ALLOWED_PATHS =
  apps/dashboard/ (unchanged, no expansion).

## Superseded / resolved items

- CL-2/3 npm-ci failure at 641f497: RESOLVED at c24a7e5 (E6).
- Untrusted bin.js containment concern (2026-07-30): RESOLVED by
  quarantine + trusted rebuild (E5/E7).
- Known cosmetic warning outstanding at TIP: systemd
  "RuntimeMaxSec= has no effect for Type=oneshot" - repo fix already
  on this branch (509a6b4, drops RuntimeMaxSec); reaches the host at
  the NEXT re-pin gate. Not a blocker.

## Next gates

1. CL-3.0 preflight P1-P3 (OWNER: Supabase SQL editor, read-only)
   + P4 (already re-verified above by ssh).
2. CL-3.1/3.2 composer lifecycle drill - owner-run in browser +
   the step-7 oneshot drive `sudo systemctl start
   preston-orchestrator.service` (owner-only sudo boundary).
3. Then CL-3b (approval variant), CL-3c (expiry), CL-3d (kill
   switch), CL-3e (cleanup) per PHASE_7_COMPOSER_LIFECYCLE_OWNER_
   PACKET.md.
