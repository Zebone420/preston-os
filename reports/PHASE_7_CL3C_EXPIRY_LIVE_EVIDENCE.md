# CL-3c EXPIRY - LIVE REFUSAL EVIDENCE (IN PROGRESS)

Opened: 2026-08-05 (UTC). The CL-3c expiry proof arrived LIVE and
unplanned: the Gate D A5 approve attempt hit the 24-hour approval TTL
(APPROVAL_TTL_MS, composer-persist.ts) because the approval was minted
during the 2026-08-04 first attempt and the schema-mismatch remediation
consumed the window.

## Live refusal (owner-run, /os/orchestration, Vercel at 82e0fab)

- Approve click on apr-72218a1788f485fa5ad3c65c returned:
  "approval decision refused: expired".
- No retry, no reject, no orchestrator run, no row modification.
- Dashboard at time of refusal: goal "Prepare the Phase 7 schema
  evidence" = blocked; approval listed pending (expired); running 0,
  failed 0, dead-letter 0; execution false, remote_runner false,
  hermes observe_only.

This satisfies the core CL-3c claims at the decision layer:
- expiry is enforced at DECISION time (status can still read pending);
- an expired approval cannot authorize progression (goal stays
  blocked, gated job never ran);
- a fresh approval is required (this one is never reused).

## Row capture (owner SQL, PENDING - appended on return)

    select approval_id, status, expires_at,
           expires_at < now() as expired,
           decided_at, nonce, owner_identity
    from orchestration_approvals
    where approval_id = 'apr-72218a1788f485fa5ad3c65c';

Expected: status=pending, expired=true, decided_at NULL, nonce NULL,
owner_identity=info@preston.nyc.

## Surface fix shipped (same day)

The page offered Approve/Reject on the expired row (RPC refused
correctly; the surface promised a decision it could not record).
Fixed in a0f0119: read-model annotates each open approval with
decision_open (fail-closed on unparseable expiry, mirroring
validateApprovalDecision); the page labels "(expired)", withholds
controls, and explains the refusal. Pinned by 2 new static tests in
approval-surface-crosslink.test.ts. tsc 0, eslint 0, 31 affected
tests pass, next build 0, os-runtime build 0.

## Disposition

- apr-72218a1788f485fa5ad3c65c is PRESERVED as audit evidence -
  never reused, never mutated.
- Goal 379ecb65-be46-4388-b0c4-57fbf73fcc29 (blocked) + its jobs are
  preserved pending Stage 6 cleanup ruling (documented residue vs
  owner-run cancellation).
- Gate D approve path reruns on a FRESH goal + FRESH approval.
- Remaining CL-3c items for the dedicated Stage 4 drill: stale
  nonce/token replay rejection on an expired-then-decided row, and
  the synthetic expiry-tightening path (owner-run bounded SQL).
