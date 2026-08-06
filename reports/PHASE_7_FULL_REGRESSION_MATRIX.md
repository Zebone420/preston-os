# PHASE 7 FULL REGRESSION MATRIX (STAGE 7) - PASS

Run: 2026-08-06 (UTC), local worktree at the Stage 4 close line
(cdb9668 + evidence commits), Windows dev machine, node/npm per repo
lockfile. Every command exact; every failure explained; nothing
relabeled.

## Matrix

| Command | Result | Counts | Baseline / notes |
|---|---|---|---|
| npx vitest run (full) | PASS* | 1059 pass / 1 fail / 1 expected fail (1061, 73 files) | Baseline at 87527a3 was 1038/5/1 of 1044. The single fail is worktree-prep.test.ts "secret_scan.sh ... worktree root" - the KNOWN environment class (bash script spawn on Windows; count varies 1-5 by machine; pre-existing, NOT new; compensated below). The xfail is the pinned D2-L1 case. 17 net new tests are this session's regressions. |
| npx vitest run test/worktree-prep.test.ts | 32/33 | confirms the one fail is exactly the env-class case | pre-existing |
| npx tsc --noEmit | PASS | exit 0 | clean, matches baseline |
| npm run lint (eslint) | PASS | exit 0 | clean, matches baseline |
| npm run build (next, Turbopack) | PASS | compiled, all routes dynamic | matches baseline |
| npm run build:os-runtime (tsc -p osruntime) | PASS | exit 0 | matches baseline |
| secret_scan_phase0a.ps1 | PASS | 0 findings | compensating control for the env-class vitest fail; runs on every commit via pre-commit |
| red_boundary_scan_phase0a.ps1 | PASS | 0 findings | as above |

*single env-class fail, pre-existing, compensated - the suite content
the failing test wraps (bash secret scanner) is executed directly by
the ps1 scanner above with 0 findings.

## Coverage mapping (required areas -> suites, all green)

- Composer parser/engine/deterministic plans/two-task gated shape:
  composer-engine, composer-lifecycle, composer-persist (incl. hash pin)
- Prompt-injection + ambiguous-request rejection: composer-security
- Orchestration lifecycle/drills D1-D5: orchestration-drills,
  orchestration-e2e, orchestrate-once lifecycle suites
- Approval creation/binding/visible ids/decide/replay/nonce/hash:
  orchestration-approval-decide, approvals-decide-action,
  orchestration-security-regressions (23 adversarial),
  approval-surface-crosslink (6 pins incl. visible ids + cross-links +
  expired/decided controls withheld)
- TTL/natural expiry/expired_at_execution/tamper precedence:
  orchestration-durable (unit), orchestrate-once "execution-time
  expiry" (end-to-end, cdb9668)
- Approve path incl. approve-before-park; reject path (not_approved
  never unlocks); duplicate-approval refusal: orchestrate-once
  approve-before-park suite, duplicate-response
- owner_stop + halt-before-goal-read: orchestrate-once control-plane
  gates (75 before any goal read), runtime-core halt suites
- Starvation protection / parked-goal skip / no stale rerun:
  orchestrate-once Gate D A7 suite
- Schema/migration validation: migration structural tests (0005/0006/
  0009/0010 static pins), orchestration-structural

## Regressions fixed during Phase 7 final bridge (all committed + pinned)

ba54ccc scheduler starvation; 39d2f17 approve-before-park; 0ecee8b
timestamptz hash canonicalization + refusal surfacing; a0f0119 expired
controls withheld; 1a9b053 visible binding; cdb9668 expiry-reason pins.
No open regressions attributable to Phase 7 work.

## Ruling

STAGE 7 PASS. One pre-existing environment-class failure, fully
compensated and documented; zero new failures; all builds and scanners
clean.
