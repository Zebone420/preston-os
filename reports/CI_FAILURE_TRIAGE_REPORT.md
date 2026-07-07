# CI Failure Triage Report - GitHub Actions dashboard job

Date: 2026-07-06. Repo C:\dev\preston-os, branch master, HEAD 4855eb1.
CI-only patch. No live systems, no production, no secrets touched.

## Symptom

Owner received GitHub Actions "run failed" emails. Per the owner:
- guards job: SUCCEEDED
- dashboard job: FAILED (2 annotations)
- Full CI log not yet available.

## Investigation (evidence-first)

- gh CLI is NOT installed locally, so the raw CI log could not be read here.
- The CI workflow (.github/workflows/ci.yml) runs, per job: npm ci ->
  npx tsc --noEmit -> npm test, in packages/guards and apps/dashboard.
- Reproduced the EXACT CI steps locally on Node 24.13.0 / npm 11.6.2:
  - guards:   npm ci OK, tsc --noEmit OK, npm test 25/25 OK.
  - dashboard: npm ci OK, tsc --noEmit OK, npm test 70/70 OK.
- Ruled out common repo-side causes:
  - Lockfiles are tracked and in sync (npm ci succeeded fresh in both).
  - No package-manager mismatch; both use npm + package-lock.json.
  - PowerShell scans are NOT in CI (they would fail on Ubuntu, but CI never
    calls them).
  - Investigated and DISPROVED a Next.js generated-types theory: next-env.d.ts
    imports ./.next/types/routes.d.ts (gitignored, absent in CI), but a true
    clean-room tsc (with .next AND tsconfig.tsbuildinfo removed) still passes
    on Node 24 - skipLibCheck tolerates the missing import.

## Root-cause assessment

- Every CI command passes locally on Node 24; the dashboard failure could NOT
  be reproduced on Node 24 by any means tried.
- The ONLY known environment delta is the Node version:
  - GitHub Actions CI pinned node-version: '20'.
  - Local/repo development runs on Node 24.13.0 (proven-passing).
- The dependency tree targets a modern Node (Next 16.2.10, React 19.2.4,
  TypeScript 6.0.3, @types/node ^26, vitest 4). The dashboard job is the one
  exercising this heavier tree (guards has no Next/React), consistent with a
  dashboard-only, Node-20-specific failure.
- NOTE: the exact failing step/annotation text is UNCONFIRMED because the CI
  log was not available. This patch aligns the CI Node version to the
  proven-working local/repo version; if the log later shows a different cause,
  a follow-up patch will address it.

## Patch

- Add repo-root .nvmrc pinning Node 24.
- .github/workflows/ci.yml: both jobs use node-version-file: .nvmrc instead of
  node-version: '20', so CI matches the local/repo Node version.
- This is a CI-configuration-only change. No app code, tests, guards, env
  values, or live systems are touched.

## Validation (local, Node 24.13.0)

- dashboard: npm ci OK, tsc --noEmit OK, npm test 70/70 OK.
- guards:   npm ci OK, tsc --noEmit OK, npm test 25/25 OK.
- secret scan: 0 findings. RED boundary scan: 0 findings.

## Follow-up if this does not fix CI

- Obtain the dashboard job log (Actions tab -> failed run -> dashboard job ->
  failing step -> last ~20 lines). No secrets appear in these logs.
- Patch the confirmed failing step directly.
