# CI Status Check

Repo C:\dev\preston-os, branch master. Workflow: .github/workflows/ci.yml.

## Current status: GREEN

- guards (typecheck + tests): GREEN
- dashboard (typecheck + tests): GREEN
- Confirmed by the owner on the Actions run for commit ff1ebe5.

## What CI runs (per job, on push + PR to master)

1. actions/checkout@v4
2. actions/setup-node@v4 with node-version-file: .nvmrc (Node 24)
3. npm ci
4. npx tsc --noEmit -p tsconfig.json
5. npm test (vitest run)

Jobs: guards (packages/guards) and dashboard (apps/dashboard).

## The dashboard failure and the fix

- Symptom: dashboard job failed (2 annotations); guards job passed.
- Local reproduction on Node 24.13.0 passed every CI command (npm ci, a true
  clean-room tsc with .next + tsbuildinfo removed, and npm test 70/70), so the
  failure was NOT a lockfile, test, or generated-types problem on Node 24.
- The only environment delta was CI Node 20 vs local/repo Node 24.
- Fix commit ff1ebe5: added repo-root .nvmrc (24) and switched both jobs to
  node-version-file: .nvmrc, aligning CI to the proven-working Node version.
- Result: the next run (ff1ebe5) went green on both jobs.

## How to read a future run

- Actions tab -> latest run -> each job shows steps 1-5 above.
- A red job: open the failing step, read the last ~20 lines (no secrets appear
  in these logs). Patch the confirmed step; do not guess.

## Local pre-push parity (matches CI)

    # guards
    (cd packages/guards && npm ci && npx tsc --noEmit -p tsconfig.json && npm test)
    # dashboard
    (cd apps/dashboard && npm ci && npx tsc --noEmit -p tsconfig.json && npm test)

Both should be green before pushing. Node version is pinned by .nvmrc (24).

## Notes

- The .ps1 secret/RED scans are local pre-commit guards, NOT part of CI.
- npm audit reports 2 moderate (transitive postcss via next); deferred, no
  --force fix (see reports/NPM_AUDIT_REVIEW.md).
