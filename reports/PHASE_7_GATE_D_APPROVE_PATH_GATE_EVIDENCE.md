# GATE D APPROVE PATH (A5-A7) - CLOSE EVIDENCE (PASS)

Closed: 2026-08-06 (UTC). The full owner-approved gated-execution path is
now LIVE-PROVEN on the deployed staging runtime, end to end, with
executed=false preserved everywhere.

## What was proven live (deployed host, Vercel + /srv/preston-os at e922db0)

1. Composer intake -> deterministic goal 5db7d3af-2099-476d-91bf-
   b4cb28c48484 (gated migration job 6d5408ca..., ungated documentation
   job d5b2c7b3..., exactly one approval apr-482003a569cae6a392e1bc50).
2. Owner-authenticated approval on /os/orchestration: approved,
   decided_at set, nonce recorded, action_hash bound,
   owner_identity=info@preston.nyc, decided within TTL.
3. Authoritative driver verification PASSED live (first-ever real-DB
   exercise of the SHA-256 canonical binding) after fix 0ecee8b.
4. Completing oneshot disp-102570 (owner-run, bounded):
   old parked goal 379ecb65... skipped (skippedParked recorded), fresh
   goal selected, cycles:1, reason=completed, no unlockRefusals,
   ExecMainStatus=0, service inactive after, timers disabled x3.
   Independent read-only ssh verification matched the owner report.
5. SQL (owner-run): both fresh jobs completed, executed=false, evidence_
   refs non-empty; master goal completed; global executed_true_rows=0;
   old parked goal rows byte-unchanged (blocked / awaiting_approval /
   approval still pending).

## Defects found and fixed by this drill (all pinned by regressions)

- A7-1 scheduler head-of-line starvation (ba54ccc) - parked goals no
  longer end the run; bounded oldest-first scan.
- A7-2 approve-before-park ordering (39d2f17) - unlock also covers
  pre-approved pending jobs.
- A7-3 timestamptz round-trip hash mismatch (0ecee8b) - canonicalInstant
  on both mint and verify; existing approvals retroactively verifiable.
- A7-4 silent refusals (0ecee8b) - unlockRefusals surface in the log.
- UI: expired rows withhold controls (a0f0119); rows show visible
  approval/goal/job binding (1a9b053).

## Approval-control claims now live-proven

- Approval REQUIRED: gated job never ran ungated (parked while pending).
- Owner-authenticated decision via the one-time RPC (nonce recorded).
- Expiry refused at decision time (CL-3c live evidence, separate doc).
- Forged/unverifiable records never unlock (regression-pinned; live
  refusal of the pre-fix hash mismatch demonstrated the same fail-closed
  path end-to-end on the host).
- Replay: decided approval offers no further decision on the surface
  (verified alongside; not_pending on forced re-decision).

## Posture after close

execution=false, remote_runner=false, hermes=observe_only, owner_stop=
false, paused=false, timers disabled x3, services inactive x3, global
executed count 0. Old goal 379ecb65... preserved as documented residue
for the Stage 6 cleanup ruling.

Baselines: Vercel dpl_Cc4iUQvCbtKKeUh6DoRBxvbYVPZR = e922db0; host
e922db0 bin.js Aug 6 02:45. NEXT: Stage 3 reject-path drill.
