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

## Second CI failure (distinct) - npm ci lockfile out of sync (@emnapi)

After the Node alignment (ff1ebe5) turned CI green, a later run (on commit
13f7e31) failed again - but at a DIFFERENT step. The owner's initial read was
"npm test"; the pasted log showed the real failing step was `npm ci`:

    npm error code EUSAGE
    npm error `npm ci` can only install packages when your package.json and
    npm error package-lock.json ... are in sync.
    npm error Missing: @emnapi/runtime@1.11.2 from lock file
    npm error Missing: @emnapi/core@1.11.2 from lock file

Root cause: apps/dashboard/package-lock.json was missing the nested
node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/* deps
(@napi-rs/wasm-runtime, @emnapi/wasi-threads, @tybys/wasm-util, tslib) that the
Linux WASM oxide fallback needs. @emnapi/runtime 1.11.2 was published after the
lockfile was generated, so CI's Linux npm ci resolved that edge to a version
missing from the lockfile. Windows npm ci uses the native oxide-win32 variant
and never evaluates that edge - which is why it passed locally.

Fix: regenerated the lockfile with `npm install --package-lock-only` (lockfile
only; node_modules untouched; package.json unchanged). Diff: +46 lines, 0
removed - it added the previously-missing nested wasm32-wasi dependency entries.

Local validation after the fix: npm ci OK, tsc --noEmit OK, npm test 76/76 OK.
Final confirmation is the next CI run (a lockfile-consistency fix can only be
fully proven on the Linux runner).
