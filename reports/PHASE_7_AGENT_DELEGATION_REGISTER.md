# PHASE 7 - AGENT DELEGATION REGISTER

Date: 2026-07-22. Owner of integration: Claude Code. Coordination
is REPOSITORY-MEDIATED only (no direct agent-to-agent messaging
assumed): pinned base commits, isolated worktrees, explicit
allowed/prohibited files, evidence packets, local commits,
merge-order planning, Claude conflict-check + integration review.

## Standing rules

- Claude never edits a package's allowed files while that package
  is ASSIGNED/IN_PROGRESS. The delegated agent never edits any
  file outside its allowed list.
- No auto-merge / no auto-cherry-pick. Integration requires a
  packet: base-vs-HEAD compare, diff inspection, allowed-file
  compliance, conflict analysis, focused + affected-regression
  tests, scanners, test-quality review, reject speculative/
  duplicate tests.
- A returned defect finding is VERIFIED independently against
  repository evidence before any fix; Claude fixes the smallest
  necessary implementation and re-runs the package tests.
- Claude owns the final integration decision, architectural
  conflict resolution, authoritative docs, safety-boundary
  preservation, and exact state distinctions.

## Register

### P7-CX-01 - adversarial security regression tests
- Task ID: P7-CX-01
- Assigned agent: Codex (local, C:\dev\preston-os)
- Status: REVIEWED, DEFECTS REPRODUCED + FIXED, INTEGRATED
- Codex base commit: bd9a080 (matched observed HEAD)
- Integration HEAD before merge: bd9a080; integration commit: see
  the fix(7) commit below.
- Conflict result: NONE - single new untracked file
  (apps/dashboard/test/orchestration-security-regressions.test.ts),
  no existing file modified by Codex (verified via git status +
  ls-files --others). Allowed-file compliance: PASS.
- Review verdict: SOUND - valid current contracts, correct SHA-256
  binding coverage, correct timestamp/nonce boundaries, correct
  migration integrity assertions, no duplicate unsafe assumptions.
- Codex results: 23 tests (21 pass, 2 expected-fail defects).
- Defects reproduced + fixed by Claude (repository-evidence
  verified, not accepted on assertion alone):
  A. Forged approval_id could unlock a gated job. FIX: the
     completion engine NEVER runs a job while requires_approval is
     true (a non-null approval_id is not authorization); the
     durable driver clears requires_approval ONLY via
     verifyAuthoritativeApproval (approval_id + approved status +
     owner + action_hash + job/goal/environment scope + nonce +
     non-expired). +11-case store test.
  B. Re-entrant worktree holder could rebind scope. FIX:
     decideAcquire now allows a same-owner/token refresh ONLY for
     an IDENTICAL binding; any change to job/base/branch/paths/
     repo/worktree_id => lock_binding_mismatch (no scope widening).
  Both it.fails converted to passing it() with assertions
  UNCHANGED.
- Tests after integration: focused Codex 23/23; full orchestration
  + migration + driver + durable + approvals suites 131/131;
  lint clean; build/typecheck pass; secret scan 0; RED scan 0.
- Merge decision: INTEGRATED (no auto-merge - repaired then
  committed the file + fixes together).
- Pinned base commit: 1778a11 (newest clean HEAD; was df018fc at
  approval - Claude's durable-driver group df018fc..1778a11 does
  NOT touch P7-CX-01's allowed file, so either pin is conflict-
  free; use the newest so tests run against the latest code)
- Allowed files (Codex may create/edit ONLY):
  - apps/dashboard/test/orchestration-security-regressions.test.ts
- Prohibited scope (Codex must NOT touch):
  - all existing files; NEXT_GATES.md;
    supabase/migrations/0010_phase7_orchestration.sql;
    apps/dashboard/src/lib/ai-os/orchestration/**;
    apps/dashboard/src/app/os/orchestration/page.tsx;
    all existing tests; Phase 7 reports + architecture docs;
    worktree/runner/Hermes/ChatGPT/Telegram/deployment/control
    files.
- Acceptance criteria:
  - additive test file ONLY; imports the orchestration modules
    read-only; no production-code change.
  - exercises adversarial matrices without weakening any pin:
    approval replay/expiry/hash/actor/self-approval; timestamp
    fuzz (NaN/reversed/pre-creation/future-skew); contract
    default-deny + universal-prohibition fuzz; policy obfuscation
    inputs (unicode/spacing/casing/synonyms) as defense-in-depth
    for the classifier gap (audit F3); worktree-lock fencing +
    path-escape; migration static-pin cross-checks.
  - MUST NOT duplicate assertions already covered in
    test/orchestration*.test.ts / test/migration-0010.test.ts
    (Claude rejects duplicates at review).
- Test requirements: all new tests green; no reliance on network,
  clock, or real execution; deterministic.
- Expected evidence: the new test file + a short note of which
  adversarial matrices are covered and which existing tests were
  checked to avoid duplication.
- Merge order: after Claude's in-flight durable-driver work
  commits (Claude's next commits touch orchestration/** and are
  NOT in P7-CX-01's allowed scope, so there is NO file overlap).
  Integrate P7-CX-01 whenever it returns; conflict risk is zero
  by construction (single new file).
- Conflict check: allowed file does not exist yet on HEAD; no
  Claude commit creates it. Zero overlap.

## Claude in-flight work (NOT delegated; may proceed in parallel)

- store-backed lock persistence wrappers (reuse `locks` table)
- restart-safe driver INTERFACE + persistent worker CONTRACT
  (pure, fake-client tested)
- migration-applied activation packet + durable worker deployment
  packet + owner-run validation plan
These touch orchestration/** and reports/**, disjoint from
P7-CX-01's single allowed file. No coordination conflict.

## Merge-order plan

1. Claude durable-driver group (orchestration/** + reports/**) -
   COMMITTED df018fc..1778a11.
2. P7-CX-01 (single new test file) - integrate on return via an
   integration packet; re-run full orchestration suite + scanners.
Future packages appended here with the same fields.
