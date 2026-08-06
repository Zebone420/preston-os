# GATE D REJECT PATH (STAGE 3) - CLOSE EVIDENCE (PASS)

Closed: 2026-08-06 (UTC). Repository/deployed line: origin/master =
Vercel (dpl_Cc4iUQvCbtKKeUh6DoRBxvbYVPZR) = host /srv/preston-os =
e922db06661d5b56e6c6bd1e03aea567635257be.

## Drill records

- Goal: cad6f5e9-6e0b-4764-8a8f-43a3f9cde9ee ("reject drill" compose)
- Gated migration job: c6816df2-ea89-4ccc-9e17-1e9f86db7356
- Documentation job: 36014dc8-e7df-42cf-b52f-d17a569749ef
- Approval: apr-35d6c4b9c36c3dcbc56f103a

## Evidence chain (owner-run, agent-verified where read-only access exists)

1. PRE-DECISION SQL: exactly one approval row; pending; unexpired;
   bound to the correct goal and gated job.
2. PRE-REJECTION ONESHOT: goal selected and driven; documentation job
   completed in simulation; gated job unlock REFUSED with
   unlockRefusals reason not_approved (the A7-4 observability fix
   working live - a pending record can never unlock); job parked
   awaiting_owner_approval; old parked goal skipped; service inactive.
3. DECISION: rejected exactly once via /os/orchestration; status=
   rejected, decided_at populated, nonce recorded, binding unchanged,
   still exactly one approval row (no duplication).
4. REPLAY: forced re-decision refused "approval decision refused:
   not_pending"; the rejected approval exposes no valid decision
   control after reload.
5. POST-REJECTION ONESHOTS (agent ssh-verified, disp-102736/102763/
   102784): the rejected goal appears ONLY in the all-parked skip set
   (skippedParked: [379ecb65..., cad6f5e9...]); exit 0; no progression;
   a rejected record never claims approved so the driver can never
   unlock it; service returned inactive; timers disabled x3.
6. FINAL SQL: gated job awaiting_approval + executed=false;
   documentation job completed + executed=false; goal blocked (the
   canonical rejected-terminal shape in this schema);
   GLOBAL_EXECUTED_TRUE=0; GLOBAL_RUNNING=0; no failed jobs; no
   dead-letter jobs.

## Ruling

PASS. Rejection is owner-authenticated, one-time, nonce-recorded,
replay-refused, duplication-free; a rejected approval never authorizes
progression; the gated job never ran; no external writes; posture
false/false/observe_only throughout.

## Residual inert rows for the Stage 6 cleanup ruling

- Goal cad6f5e9... blocked with rejected approval (this drill).
- Goal 379ecb65... blocked with expired pending apr-72218a17...
- RED residue approval drill-b2-2 (goal NULL, expired pending).
- Cancelled goal 6fd46b2b... (Gate D first-attempt compensation).
All documented historical audit rows; nothing requires deletion for
safety.
