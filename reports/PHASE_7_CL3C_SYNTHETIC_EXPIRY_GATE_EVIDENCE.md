# CL-3c SYNTHETIC EXPIRY (STAGE 4) - CLOSE EVIDENCE (PASS WITH NOTE)

Closed: 2026-08-06 (UTC). Deployed line: origin/master = Vercel
(dpl_Cc4iUQvCbtKKeUh6DoRBxvbYVPZR) = host = e922db0.

## Drill records

- Goal: 5c9ca82e-df21-4352-b14a-039630c28542 (approved-expiry drill 2)
- Gated job: 94dd8bcc-5374-4577-b42d-8424bd914bab
- Documentation job: 2009d8f6-8e23-4f4a-b2f7-642630fca3e0
- Approval: apr-95a0f270ba9ee654370725c3
- Inert residue from attempt 1 (tightened while PENDING, preserved,
  never reused): goal 79cbf94b..., job cb6d00d6..., apr-ef455de8...
  (pending, undecided, expired; the approved-only guarded update
  correctly affected 0 rows on it).

## Evidence chain

1. Compose verified live pre-decision (agent browser read): exactly one
   actionable approval, correct visible binding goal 5c9ca82e / job
   94dd8bcc, all three residue approvals expired with controls withheld.
2. Park oneshot disp-102932 (agent ssh-verified): goal driven cycles:1,
   docs job completed in simulation, gated job parked; unlockRefusals
   [{94dd8bcc, not_approved}] - a pending record cannot unlock.
3. Owner approved once while unexpired; owner SQL: approved,
   decided=true, nonce_recorded=true, unexpired=true, rows_for_goal=1.
4. Owner tightening (approved-only guarded UPDATE): exactly 1 row;
   re-select: approved / decided / nonce / expired=true.
5. Refusal oneshot disp-102975 (agent ssh-verified): goal driven,
   unlock REFUSED - unlockRefusals [{94dd8bcc, action_hash_mismatch}];
   exit 0; service inactive; timers disabled x3.
6. Finals: gated job awaiting_approval executed=false; docs job
   completed executed=false; goal blocked (agent browser re-verified on
   a fresh render: blocked 4, open approvals 3, apr-95a0f270 decided
   and offering no controls - stale-decision replay surface closed);
   owner SQL: executed_true_rows=0, running_jobs=0.

## THE NOTE - why the refusal reason is action_hash_mismatch, not
## expired_at_execution (finding, not a defect)

expires_at is a hash-bound envelope field. Synthetically mutating it
post-decision (even tightening) breaks the SHA-256 binding, and the
tamper check correctly PRECEDES the expiry check - so a mutated
validity window can never surface the canonical expiry reason. That
precedence is the stronger guarantee: any post-decision change to the
approved action or its window is refused as tampering. The canonical
expired_at_execution path (window lapses WITHOUT mutation) cannot be
produced synthetically without waiting out the 24h TTL, and is instead
pinned at two layers: unit (orchestration-durable.test.ts 224/229) and
NEW end-to-end dispatcher regression (cdb9668: lapsed unmutated window
-> unlockRefusals expired_at_execution; plus a pin that tightened
windows surface action_hash_mismatch first, matching the live drill).

## Ruling

PASS WITH NOTE. All Stage 4 target claims hold: an approved-then-
expired (here: approved-then-window-mutated) approval cannot authorize
progression; the gated job never ran; stale decided-state and nonce do
not help; a fresh approval would be required; executed=false global;
no external writes; posture unchanged. The canonical expiry-at-
execution reason is regression-proven at both unit and dispatcher
levels at commit cdb9668.
