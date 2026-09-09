# Preston AI OS Fast-Track Completion Report — 2026-09-08

## A. Branch / build

- Branch: `feature/hermes-native`
- Validated code HEAD: `3616ef42e5e40baf4b70020788c3db4fcd820d1d`
- Pushed origin HEAD: `76d27250fcf1d422ace01b32b5814c99bb16ba70`
- Branch state at validation: clean, 11 commits ahead of origin.
- Production touched: **NO**.

## B. Lane results

### Staging validation — FAIL / owner-gated

The requested target commit `76d2725` was cloned on the staging host into
the isolated path `/tmp/preston-validate-76d2725`. It passed the OS-runtime
build, TypeScript, ESLint, the Next production build, and 2,931 dashboard
tests plus one intentional expected-failure sentinel. Its production npm
audit then found eight advisories: three moderate, four high, and one
critical. The repair is preserved in `743f1d4`; the final local tree has zero
production and zero full-audit findings.

The deployed staging checkout was not changed. It remains detached at
`f9747d7a9c59bc160d28ec0c8c5cf3a6c7bb0936`; both
`preston-orchestrator.timer` and `preston-hermes-observe.timer` are active.
`/srv/worktrees/patches` is absent. The Vercel staging alias is healthy
(`GET /api/health` = 200, connected) but is an older deployment;
unauthenticated control status fails closed with 401 and `/api/control/owner-view`
is absent (404). Protected environment files, service-user state, the live
migration ledger, and timer/deployment mutation require owner sudo.

No database row, worker configuration, credential, service, production
system, or live business side effect was changed.

### Architect / GitHub Gate — FAIL / quarantined

The initial exhaustive audit found no owner-approved Architect Gate plan or
AG-1 through AG-10 contract in tracked history, reflogs, unreachable objects,
remote branches, GitHub issues, or pull requests. A later isolated worktree
unexpectedly created a first-time design plus partial AG-1/AG-2 code at
`81805b1`, `e07d296`, and `73401d9`. That design includes a future live GitHub
write concept and was not authoritative under this task. It remains
quarantined on `feature/architect-gate`; none of it was merged.

Owner action is required to approve an exact Architect Gate contract or
reject the quarantined design. Preston Control remains the sole authority;
no second control plane or GitHub write path was added to the build branch.

### Preston Control cleanup — PASS in repository

`9248f8b` repairs four confirmed defects:

- expired or malformed pending approvals can no longer notify or hide a live
  approval inside the bounded notification window;
- a returned `ArtifactRecorded` insert failure is no longer silent;
- a returned worktree-release failure is no longer silent;
- partial orchestration job reads now make status/read-model posture
  unreadable instead of falsely operating with empty incident buckets.

The existing scheduler starvation, selection-window, routing, intake,
lease/CAS, retry/dead-letter, kill, and preservation paths remained green and
were not speculatively rewritten.

## C–F. Contract status

| Contract area | Status |
|---|---|
| Phase 0 | Repository PASS; live staging scheduler/worker/kill/restore proof pending. |
| M8 ConnectorPassport | Repository PASS; staging migration/freshness/provenance/refusal proof pending. |
| M9 soft launch | `REPOSITORY_READY`; staging live reads and draft-only flows pending. |
| Phase 1 | Repository PASS; identity/document/Drive/knowledge/Gmail-read/deal pilot pending. |
| Phase 2 | Repository PASS; Hermes live-read drills pending. |
| Phase 3 | Repository PASS; deterministic sandbox capability spine remains fail-closed. |
| Phase 4 | Repository PASS; real-project quote/proposal/schedule/follow-up pilot pending. |
| Phase 5 safe subset | Repository PASS after hardening and migration 0037; waiver, terminal change-order decision, and PO approval/placement persistence intentionally disabled pending evidence-bound owner paths. |
| Phase 6 | Repository PASS; real closeout pilot pending. |
| Phase 7 | Repository PASS; no autonomy class promoted. |
| Phases 8–9 | Deferred by the authoritative master contract. |

Phase 5 now binds current approved templates and required forms, immutable
contract/measurement/PO facts, authoritative quote/payment facts,
append-only receipt replay, exact authenticated actors, three-business-day
measurement timing, readiness predicates, and deterministic draft-only
contract/PO renderers. No charge, refund, live contract send, or order
placement executor exists.

## G. Exact files changed from `76d2725`

1. `apps/dashboard/package-lock.json`
2. `apps/dashboard/package.json`
3. `apps/dashboard/src/lib/ai-os/artifacts.ts`
4. `apps/dashboard/src/lib/ai-os/capabilities/business/contract-package-render.ts`
5. `apps/dashboard/src/lib/ai-os/capabilities/business/definitions.ts`
6. `apps/dashboard/src/lib/ai-os/capabilities/business/po-document-render.ts`
7. `apps/dashboard/src/lib/ai-os/capabilities/business/schemas.ts`
8. `apps/dashboard/src/lib/ai-os/capabilities/providers/internal-runner.ts`
9. `apps/dashboard/src/lib/ai-os/notifications.ts`
10. `apps/dashboard/src/lib/ai-os/orchestration/read-model.ts`
11. `apps/dashboard/src/lib/business/order-chain/contract-state.ts`
12. `apps/dashboard/src/lib/business/order-chain/final-measure.ts`
13. `apps/dashboard/src/lib/business/order-chain/order-eligibility.ts`
14. `apps/dashboard/src/lib/business/order-chain/payment-state.ts`
15. `apps/dashboard/src/lib/business/order-chain/po-preparation.ts`
16. `apps/dashboard/src/lib/business/order-chain/store.ts`
17. `apps/dashboard/src/lib/preston-control/tools.ts`
18. `apps/dashboard/src/os-runtime/real-executor.ts`
19. `apps/dashboard/test/artifact-platform.test.ts`
20. `apps/dashboard/test/business-capability-phase5-render.test.ts`
21. `apps/dashboard/test/business-capability-shared.test.ts`
22. `apps/dashboard/test/capability-spine.test.ts`
23. `apps/dashboard/test/fast-track.test.ts`
24. `apps/dashboard/test/orchestration-bridge-e2e.test.ts`
25. `apps/dashboard/test/order-chain-contract.test.ts`
26. `apps/dashboard/test/order-chain-eligibility.test.ts`
27. `apps/dashboard/test/order-chain-final-measure.test.ts`
28. `apps/dashboard/test/order-chain-fixtures.ts`
29. `apps/dashboard/test/order-chain-migration-0037.test.ts`
30. `apps/dashboard/test/order-chain-payment.test.ts`
31. `apps/dashboard/test/order-chain-store.test.ts`
32. `apps/dashboard/test/preston-control-tools.test.ts`
33. `apps/dashboard/test/worker-patch-preservation.test.ts`
34. `reports/p2_evidence/rollback/rollback_0037.sql.txt`
35. `supabase/migrations/0037_p5_order_chain_hardening.sql`
36. `reports/PRESTON_AI_OS_FAST_TRACK_COMPLETION_20260908.md`

## H. Commits created on the build branch

1. `743f1d4` — dependency security update
2. `9248f8b` — control status/attention/evidence cleanup
3. `96448ce` — sandbox-only contract and PO renderers
4. `8a3bb1d` — approved-template/required-form render binding
5. `270a0de` — safe order-chain bindings
6. `1eec0de` — durable receipt evidence and migration 0037
7. `959b811` — receipt replay binding reconciliation
8. `12cedc6` — durable state-truth/RLS hardening
9. `3daf4fd` — contract issuance and final-measure timing guards
10. `6ffc255` — refused provider-event replay remains fail-closed
11. `3616ef4` — scanner-safe migration rollback assertion

## I. Test matrix

| Validation | Exact result |
|---|---|
| Final dashboard unit/integration/security suite | PASS: 210 files; 3,007 passed; 1 intentional expected failure; 0 failed |
| Phase 5 focused | PASS: 9 files; 164 tests |
| Phase 5 render/capability matrix | PASS: 9 files; 326 tests |
| Control/orchestration matrix | PASS: 41 files; 682 tests |
| Scanner regression focus | PASS: 2 files; 44 tests |
| Dashboard TypeScript | PASS, exit 0 |
| ESLint | PASS, 0 errors/warnings |
| OS-runtime build | PASS, exit 0 |
| Next 16.3.4 production build | PASS, exit 0; all routes generated |
| Hermes TypeScript tests | PASS: 4 files; 48 tests |
| Hermes TypeScript check | PASS, exit 0 |
| Hermes Python | PASS: 34 tests with warnings promoted to errors |
| Shared guards | PASS: 1 file; 25 tests; TypeScript PASS |
| npm production audit | PASS: 0 vulnerabilities |
| npm full audit | PASS: 0 vulnerabilities |
| Secret scanner | PASS: 0 findings |
| RED-boundary scanner | PASS: 0 findings |
| Git whitespace check | PASS |
| Staging-host target suite (`76d2725`) | Code PASS: 208 files; 2,931 passed; 1 expected failure; audit FAIL (8), repaired only in later local commit |

Failures were not hidden. The first final dashboard run had one failure because
the new rollback test contained a literal destructive-SQL phrase that the RED
scanner correctly detected. The assertion was made scanner-safe in `3616ef4`;
the scanner returned zero findings, the focused 44-test set passed, and the
full 3,007-test suite then passed. A sandboxed Next build could not fetch the
configured fonts; the approved network rerun passed.

## J–P. Proof verdicts

| Proof | Verdict |
|---|---|
| Claude worker | Repository PASS; real staging dispatch **FAIL / NOT PROVEN** |
| Codex worker | Repository PASS; real staging dispatch **FAIL / NOT PROVEN** |
| True Claude+Codex concurrency | Repository tests PASS; staging **FAIL / NOT PROVEN** |
| Worktree isolation | Repository PASS; staging **FAIL / NOT PROVEN** |
| Lease/CAS | Repository PASS; staging **FAIL / NOT PROVEN** |
| Kill/owner-stop | Repository PASS; staging **FAIL / NOT PROVEN** |
| Status/event/approval truth | Repository PASS; staging reconciliation **NOT PROVEN** |
| Artifact/patch preservation | Repository PASS; staging FAIL because durable patch directory is absent and no real cleanup/retrieval drill ran |
| Backup/restore | **FAIL / NOT RUN**; no safe dump source or isolated restore target was owner-authorized |
| ConnectorPassport | Repository PASS; staging **NOT PROVEN** |
| Hermes live reads | Health/auth-negative PASS only; Today/Project/Approvals/Workforce/Evidence **NOT PROVEN** |
| M9 soft launch | Repository PASS; staging selected flows **NOT PROVEN** |
| Architect Gate | **FAIL / BLOCKED**; no approved AG contract; partial self-authored branch quarantined |

The migration candidates now run through `0037`. No staging migration was
applied. The live ledger remains unreadable to the non-sudo staging identity,
so applied versions cannot be claimed.

## Q–T. Readiness, blockers, and owner gates

- Staging readiness: **NO**.
- Production readiness: **NO**.

Exact blockers:

1. The final branch is not pushed; origin remains `76d2725`.
2. The staging deployment remains `f9747d7`, not the validated/final tree.
3. The live migration ledger is unreconciled; 0028–0037 are not proven
   applied.
4. `ORCH_BASE_COMMIT`, protected worker environment assumptions, service-user
   Claude/Codex auth, and patch-directory ownership are not verified at the
   final revision.
5. No real staging scheduler, starvation, CAS, retry/dead-letter, kill,
   artifact cleanup/retrieval, or true-overlap run exists for the final tree.
6. No safe staging backup/isolated restore proof exists.
7. ConnectorPassport, Hermes, M9, and Phase 1–6 live staging pilots remain
   unexecuted.
8. Architect Gate lacks an owner-approved AG-1–AG-10 contract; the isolated
   first-time design is not accepted.

Owner-gated actions remaining:

1. Review these commits and perform the normal non-force push.
2. Open a bounded staging sudo window; halt both timers, deploy the exact new
   SHA, build it, set `ORCH_BASE_COMMIT`, create/own the patch directory, verify
   service identities/configuration, then restore both timers.
3. Reconcile the staging ledger and apply only missing migrations 0028–0037
   in numeric order after a staging backup.
4. Reauthenticate Codex as `preston-worker` only if the bounded dispatch
   reports authentication failure; no credential change was attempted here.
5. Authorize synthetic staging fixture/project IDs and run the full S1–S10,
   live-read, draft-only, and Phase 1–6 pilot matrix.
6. Provide an isolated restore target and authorize the staging restore drill.
7. Approve or reject the quarantined Architect Gate contract before any AG
   implementation is integrated.
8. Review all staging evidence before any production deploy, production
   migration, live send, payment/refund, order placement, or autonomy change.

## U. Atomic Preston Control goals

1. `Owner review and non-force-push the final feature/hermes-native SHA.`
2. `Open a bounded staging sudo window and freeze both Preston timers.`
3. `Deploy the exact final SHA and pin ORCH_BASE_COMMIT.`
4. `Back up staging; reconcile and apply only missing migrations 0028-0037.`
5. `Prove one Claude and one Codex dispatch, then prove actual overlap.`
6. `Prove kill, CAS, retry/dead-letter, artifact retrieval, and patch cleanup.`
7. `Run the isolated staging restore drill.`
8. `Run ConnectorPassport, Hermes, M9, and authorized Phase 1-6 pilots.`
9. `Owner decide the quarantined Architect Gate contract.`
10. `Review the completed staging evidence; keep production closed until then.`
