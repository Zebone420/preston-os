# npm audit review - apps/dashboard

Date: 2026-07-06. Read-only review. No dependency changes were applied.

## Findings

`npm audit` in apps/dashboard reports 2 moderate severity vulnerabilities,
both from a single transitive dependency:

- postcss < 8.5.10 - moderate - XSS via unescaped `</style>` in CSS Stringify
  output (GHSA-qx2v-qp2m-jg93). Pulled in transitively through `next`
  (node_modules/next/node_modules/postcss).

## Why no fix is applied now

- The only fix npm offers is `npm audit fix --force`, which it reports "will
  install next@9.3.3, which is a breaking change" - a major, unacceptable
  downgrade of the framework. Forcing it would break the app.
- Per build rules, no `--force` fixes without owner approval.
- The advisory is a CSS stringifier XSS. The dashboard is behind owner-only
  auth on protected staging and renders no untrusted CSS, so exposure is low.

## Safe options (owner decision, later bounded gate)

1. Wait for an upstream `next` release that bundles postcss >= 8.5.10, then a
   normal dependency refresh clears it (preferred, zero risk).
2. If it must clear sooner, pin the transitive postcss via a package.json
   `overrides` entry (postcss >= 8.5.10) and re-run tests - non-breaking if the
   app's postcss usage is unaffected. Do only in a bounded gate with tests.

## Recommendation

Defer. Track upstream `next`; re-run `npm audit` at the next dependency bump.
No action required for Phase 1A/1B prep.
