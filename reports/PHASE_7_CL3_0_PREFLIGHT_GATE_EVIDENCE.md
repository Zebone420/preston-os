# PHASE 7 - GATE CL-3.0 SAFETY PREFLIGHT - CLOSE EVIDENCE (PASS)

Closed: 2026-08-03 (UTC). Deployment context: Vercel + host both at
c24a7e5834e86248e1ba67ad84d7959424472cf4 (Block V' PASS, CL-2/2 PASS).

## P1-P3 (owner-run, Supabase SQL editor, staging, read-only)

Owner-reported results, received 2026-08-03:

- P1 system_controls (id='global'):
  execution_enabled = false
  remote_runner_enabled = false
  hermes_mode = observe_only
  owner_stop = false
  paused = false
  -> EXACT match to the required posture.
- P2 migration 0010 presence:
  to_regclass('public.master_goals') = non-null
  to_regclass('public.goal_jobs')   = non-null
  -> PASS (owner attestation of non-null; consistent with the
  0010 gate CLOSED PASS evidence of 2026-07-28).
- P3 `select count(*) from goal_jobs where executed = true` = 0
  -> PASS (nothing has ever really executed).

## P4 (build agent, read-only ssh, no sudo - verified 3x 2026-08-03)

- /srv/preston-os HEAD = c24a7e5834e86248e1ba67ad84d7959424472cf4
- tracked tree clean (sole untracked entry = the intended
  dist.untrusted.20260803T033009Z quarantine)
- preston-worker / preston-orchestrator / preston-hermes-observe
  timers: disabled x3; services: inactive x3
- trusted apps/dashboard/dist/os-runtime/bin.js present
  (4,958 bytes, built Aug 3 03:31 UTC during CL-2/2)
- orchestrator.log baseline ends Jul 28 04:56 (three
  no_eligible_goal entries) - any new line is drill-caused.

## Result

CL-3.0 = CLOSED PASS. The CL-3 drill family is cleared to start.

Gate status at this close: Gate B (composer drill, browser) OPEN -
no browser evidence received yet; agent-driven attempt blocked by
profile/session boundary (server 307 to /login in the controlled
profile, 4x verified; credentials never touched). Gates C-G pending
B. No control value was changed by this gate; posture identical
before and after (read-only checks only).
