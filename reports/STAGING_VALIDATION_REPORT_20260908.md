# PRESTON AI OS - STAGING VALIDATION REPORT

Evidence date: 2026-09-08 America/New_York / 2026-09-09 UTC on host

Verdict: **STAGING VALIDATION BLOCKED AT OWNER-RUN DEPLOYMENT GATE.**
Repository validation passed, read-only staging inspection succeeded, and no
production or staging data was mutated. Live staging PASS is not claimed.

## A. STAGING COMMIT / BUILD

| Item | Observed truth |
|---|---|
| Local branch | `feature/hermes-native` |
| Local candidate | `644e2df82758e33c9a90c2ba94ee88c1019975dc` |
| Implementation revision | `0726b1d` |
| GitHub branch | `2d447d52077719c76dd2d611958d3e774abb5b4a` |
| Staging checkout | clean, detached `f9747d7a9c59bc160d28ec0c8c5cf3a6c7bb0936` |
| Candidate on host | NO; both `0726b1d` and `644e2df` are absent |
| Push safety | `2d447d5` is an ancestor; authenticated dry-run reports a normal fast-forward to `644e2df` |
| Local candidate build | PASS: Next production build and OS runtime build |
| Staging candidate build | FAIL / NOT RUN: candidate is unavailable on host |

The current no-agent-push rule in the completion report makes the real push an
owner action. No force push is needed or permitted. After this report is
preserved, the owner must push the then-current branch HEAD and verify GitHub
returns the same full SHA before the host fetch.

## B. MIGRATION STATE

- Staging checkout contains repository migrations only through `0027`.
- The live staging database migration ledger was not accessible to the
  non-root SSH identity and is therefore **UNKNOWN**, not assumed to equal the
  checkout.
- No migration was applied.
- Candidate migrations 0028-0036 and owner-run rollback texts are present
  locally. Apply only after the owner compares the live ledger, in numeric
  order, to the staging project.

Candidate migration SHA-256 inventory:

```text
0028 3381f28d537987358b34cb7ac99e6b9731e7418a6c23d125f5abfb0b2f46b0bc
0029 d1f000cf6fcb3cd6bcc8abb62f184e75918ff296bd8532373998ff30e86329a1
0030 cbc59f24c7f712bb34683fb489cbe7b0e1ec0f2c3d0fe80a21c29c7281cdd9f2
0031 97c0fa45d44e5d21b8eab8b7ae820a50760b7dba02c4df15006f045c87bc834b
0032 91db3184cc9811437e7a86c965b5b7a308af2291331f5839ffc7ad7da1bbec17
0033 d3de04ac2d2b00eba4166233b3e75a90e1db079d839a835b83e68161761abe65
0034 6d43168508743393573af44519e6eee9ea6bf05f9233a5d9204090db36b2da0d
0035 7eccfec73a33f15dbe6b163e16dcdaef3ccce0964a468f27d7e7d171467b7ff4
0036 5f24f7f336ba13a86fd3127f33648851e29e3acaca880f864ae2bdb652f03418
```

## C. CLAUDE WORKER PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Claude Code `2.1.216` is visible to the `grann`
account, but service-account PATH, HOME/config and authentication could not be
verified without owner sudo. No real staging Claude dispatch was attempted on
the stale host revision.

## D. CODEX WORKER PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Codex CLI `0.142.5` is visible to `grann`.
Service-account PATH, no-secret child environment and authentication remain
unverified. No credential was read or changed, and no reauthentication was
attempted.

## E. TRUE CONCURRENCY PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Local concurrency and executor tests pass, but no
two real staging runs occurred. There is no evidence of wall-clock overlap,
distinct live leases/worktrees/logs, or independent live artifacts.

## F. WORKTREE ISOLATION PASS/FAIL

**FAIL / NOT PROVEN AT CANDIDATE.** `/srv/worktrees` exists and is owned by
`preston-worker`; `/srv/worktrees/patches` is absent. The deployed systemd
unit grants only `/var/lib/preston/worker`, `/srv/worktrees`, and
`/srv/preston-os/.git` as writable paths, which is the intended boundary, but
the candidate worktree flow has not run.

## G. LEASE/CAS PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Local focused tests pass. No candidate-version
staging lease, CAS conflict, stale fence, retry, dead-letter, or starvation
drill was run.

## H. KILL/OWNER-STOP PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Local adapter and staging-cancel tests pass. No
staging process was started, so no live kill/owner-stop boundary was tested.
The existing timers were left active and the system was not left halted.

## I. STATUS/EVENT/APPROVAL TRUTH PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Local expired-approval and read-model tests pass.
The candidate schema/runtime is not deployed, so job/goal/approval/event,
Hermes and notification state were not reconciled against live staging rows.

## J. ARTIFACT/EVIDENCE PASS/FAIL

**FAIL / NOT PROVEN LIVE.** Local patch preservation, artifact retrieval and
evidence tests pass. The required staging patch directory is absent, and no
candidate worker run produced a durable patch or retrieval proof.

## K. BACKUP/RESTORE PASS/FAIL

**FAIL / BLOCKED SAFELY.** The staging host has Docker but no `psql`,
`pg_dump`, `pg_restore`, local PostgreSQL service, PowerShell, or deployed
restore-drill script. No dump credential was available. No production or
staging database was used as a destructive restore target.

## L. CONNECTORPASSPORT PASS/FAIL

**FAIL LIVE / PASS LOCAL.** The focused M8/M9/capability matrix passes, but
migration 0036 is not in the staging checkout and live passport provenance or
stale-source refusal has not been exercised in staging.

## M. HERMES LIVE-READ PASS/FAIL

**FAIL / NOT PROVEN ON CANDIDATE.** The Hermes timer is active on the old
checkout, but the candidate owner-view endpoint/plugin is absent. Today,
Project, Approvals, AI Workforce and Evidence/Incidents were not claimed from
old-runtime results.

## N. M9 SOFT-LAUNCH PASS/FAIL

**FAIL FOR STAGING; `REPOSITORY_READY` REMAINS CORRECT.** Live reads,
draft-only staging flows and required S1-S9 evidence are incomplete.
Production readiness remains false. No send, money movement, order placement,
or autonomy promotion occurred.

## O. PHASE 1-6 PILOT STATUS

- Local deterministic pilot/model matrix: **PASS, 56 files / 722 tests**.
- Staging Project ID/identity, document/Drive, knowledge, Gmail read-only,
  Deal Intelligence, proposal/draft, contract/payment models, final measure,
  order eligibility/PO preparation and install/closeout pilots: **NOT RUN**.
- No staging fixture was inserted because the candidate migrations and
  runtime are not deployed and the authorized staging dataset is unspecified.

## P. TEST MATRIX WITH EXACT COUNTS

| Validation | Result |
|---|---|
| Dashboard full suite | PASS: 208 files; 2,931 passed; 1 expected-failure sentinel; 0 failed |
| Staging-critical control/worker matrix | PASS: 19 files; 379 tests |
| M8/M9/owner-view/capability matrix | PASS: 8 files; 234 tests |
| Phase 1-6 pilot/model matrix | PASS: 56 files; 722 tests |
| Hermes TypeScript | PASS: 4 files; 48 tests |
| Hermes Python | PASS: 34 tests with ResourceWarning treated as error |
| Shared guards | PASS: 1 file; 25 tests |
| Dashboard TypeScript | PASS: `npx tsc --noEmit` |
| Hermes TypeScript | PASS: `npm run typecheck` |
| Guards TypeScript | PASS: `npx tsc --noEmit` |
| ESLint | PASS: 0 errors, 0 warnings |
| OS runtime build | PASS |
| Next production build | PASS after approved font-network rerun |
| Secret scanner | PASS: 0 findings |
| RED-boundary scanner | PASS: 0 findings |

The first Next build attempt failed only because the restricted sandbox could
not fetch the configured Geist fonts. It was rerun with approved network
access and passed. This failure is recorded and not treated as a code defect.

## Q. DEFECTS FOUND/FIXED

No new repository defect was found. Operational gaps found, not silently
fixed or bypassed:

1. GitHub staging branch is behind the validated local branch.
2. Staging host is detached on an older commit and does not contain the
   candidate commits or migrations 0028-0036.
3. The deployed unit still describes the old simulation-only runtime.
4. Candidate patch-preservation directory is absent.
5. Protected worker configuration and worker-identity CLI execution require
   owner sudo; the current SSH identity correctly cannot read them.
6. Staging restore prerequisites and database credentials are unavailable.

## R. REMAINING OWNER GATES

1. From the clean local checkout, owner runs a normal, non-force push:
   `git push --set-upstream origin feature/hermes-native`.
2. Verify GitHub branch SHA exactly equals local `git rev-parse HEAD`.
3. Approve owner-sudo staging window; stop the two staging timers before
   checkout/config/migration work and restore them after validation.
4. Fetch and checkout the exact verified SHA on `/srv/preston-os`; rebuild the
   OS runtime; create `/srv/worktrees/patches` as `preston-worker`.
5. Reconcile the live staging migration ledger and owner-apply only missing
   0028-0036 in order, preserving preflight and rollback evidence.
6. Verify environment **names** and paths, repin `ORCH_BASE_COMMIT` to the
   exact deployed SHA, and verify service-account HOME/config/CLI access.
7. Reauthenticate Codex as the service identity only if its safe auth probe
   proves it necessary; do not expose credentials.
8. Authorize named staging-only fixture/project IDs for S1-S10 and Phase 1-6
   pilots, then execute the live proof matrix.
9. Provide an isolated local PostgreSQL restore target and staging dump access
   for S8.

## S. PRODUCTION READINESS

**NO.** Production was not contacted or modified.

## T. EXACT BLOCKERS IF NO

- Owner-run branch push has not happened.
- Candidate is absent from the staging host.
- Live migration ledger and worker configuration are protected by owner sudo.
- Candidate runtime/build/config/pin are not installed.
- Real Claude, Codex, concurrency, stop, truth, artifact, backup/restore,
  ConnectorPassport, Hermes and Phase 1-6 staging evidence do not exist.

## U. SHORT ATOMIC PRESTON CONTROL GOALS FOR NEXT STEP

1. `Owner fast-forward-push feature/hermes-native and attach the remote SHA.`
2. `Owner open a bounded sudo staging window and halt both timers.`
3. `Deploy and build the exact candidate SHA; repin ORCH_BASE_COMMIT.`
4. `Reconcile and apply missing staging migrations 0028-0036 only.`
5. `Verify Claude and Codex under the preston-worker identity.`
6. `Run S1-S7 and capture distinct concurrent-run evidence.`
7. `Run the isolated restore drill and M8/M9/Hermes proofs.`
8. `Run authorized Phase 1-6 staging pilots; keep every side effect disabled.`

## Safety attestation

- Production deploy/data/credentials: untouched.
- Live customer/vendor/DocuSign sends: none.
- Payments, refunds, order placement: none.
- RLS/approval/lease/CAS/kill controls: not weakened.
- Autonomy: not expanded.
- Paid services: not activated.
- Force push/destructive data operations: none.
