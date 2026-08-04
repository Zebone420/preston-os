# BLOCK 4 - HOST RE-PIN AT 15085cf - CLOSE EVIDENCE (PASS)

Closed: 2026-08-05 (UTC). Host preston-agent-staging re-pinned from
c24a7e5 to TIP 15085cfa5b3ea7f5e4d53a7d49fb9f7f01117f99.

## Owner-run results (reported)

Pin exact; npm ci dry-run 0 / ci 0 / build 0; fresh bin.js Aug 4
23:33 UTC; no-env health exit 78 (fail-closed proven); ORCH_BASE_
COMMIT exact-TIP count 1; pre-refresh diffs = exactly the three
expected .service files (RuntimeMaxSec removed, TimeoutStartSec
comments added), timers silent; unit backup
/root/preston-unit-backup-15085cf; three services refreshed +
daemon-reload; post-refresh parity silent; PREFLIGHT: PASS exit 0;
final posture timers 3x disabled, services 3x inactive.

## Independent agent verification (read-only ssh, no sudo)

- HEAD = 15085cfa5b3ea7f5e4d53a7d49fb9f7f01117f99 (exact)
- bin.js 4,958 bytes Aug 4 23:33 (matches owner report)
- ^RuntimeMaxSec= directive count: 0 / 0 / 0 across the three
  installed service units (the word appears only in the explanatory
  comment); systemctl show: Type=oneshot, TimeoutStartUSec=2min,
  RuntimeMaxUSec=infinity - the cleanup is LIVE on the host and the
  cosmetic journal warning is gone for future runs.
- Timers disabled x3; services inactive x3.
- Orchestrator log unchanged since the CL-3.2 completion line
  (disp-97958) - no runs occurred during the re-pin.

## Consequence

Vercel AND host both serve 15085cf, which contains 541b578
(approval-PK fix) and 06ce6a4 (notice fix). GATE D RERUN UNLOCKED.
Rollback points: Vercel dpl_GDMXCJygBj8UfgM9LQizeCon1oFV (c24a7e5);
host $PREV c24a7e5 + unit backup /root/preston-unit-backup-15085cf.
Posture: execution false, remote_runner false, hermes observe_only,
owner_stop false, paused false, global executed count 0.
