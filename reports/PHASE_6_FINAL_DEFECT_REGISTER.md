# PHASE 6 - FINAL DEFECT REGISTER (staging-operational cycle)

Date: 2026-07-21. Supersedes reports/PHASE_6_DEFECT_REGISTER.md
by incorporating it: D1-D30 dispositions from the build cycle
remain as recorded there (all FIXED or ACCEPTED; open residuals
D4 idempotency window and D9 bfcache UX are both RESOLVED in this
cycle - see V-H2 below, which replaced the form flow they
described). This register adds the staging-operational
verification cycle findings (commits 7ec5b40..9ca6120): two fresh
adversarial audits (UI/owner-workflow; documentation consistency)
plus independent re-verification of every prior claim.

## Verification-cycle findings and dispositions

UI / owner-workflow audit:

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| V-H1 | HIGH | No in-product client creation: agent form dead-ends on a fresh DB; no lead/payment entry either | FIXED 9ca6120 - owner data-entry: Add client (quotes page), Add lead + stage Move (pipeline), Record payment fact (payments); all owner-checked, validated, activity-logged, audited; empty-dropdown guidance added |
| V-H2 | HIGH | Validation failure wiped the whole quote form; failed runs consumed the render-time idempotency key | FIXED 9ca6120 - client-component form with useActionState: failures return owner-readable errors and keep every typed value; pending-disabled submit; server generates a fresh key per submission (also retires build-cycle residuals D4/D9) |
| V-M1 | MED | Markup value in the wrong box (or empty for a selected mode) silently priced as zero | FIXED - explicit mismatch error; empty matching box now reaches the engine missing-field check |
| V-M2 | MED | Raw machine codes shown to the owner (items[0].unit_material_cents etc.) | FIXED - humanized wording layer (business-forms.ts) with line numbers; recommendation outcomes mapped too; unit-tested |
| V-M3 | MED | Quote detail assembled from globally-truncated reads: silent line-item loss at scale | FIXED - loadQuoteDetail fetches this quote's versions/items/approval by id |
| V-M4 | MED | Line-item rows fixed 6-column grid unusable on phones | FIXED - grid-cols-2 sm:grid-cols-7 (fees column added) |
| V-M5 | MED | Re-versioning/lead/property linkage backend-only; item fees parsed but not rendered | FIXED - optional existing-quote/lead/property selects + fees inputs in the form |
| V-M6 | MED | schedule.stages rendered without Array.isArray guard (malformed jsonb -> 500) | FIXED - guarded |
| V-L1 | LOW | Empty DB falsely labeled "STALE - over 7 days old" | FIXED - "no business records yet (nothing to be stale)" |
| V-L2 | LOW | Staleness sampled only activity/leads/quotes | FIXED - projects/payments/communications included |
| V-L3 | LOW | Quotes list lacked a SIMULATION badge | FIXED |
| V-L4 | LOW | Dangling "since " on null stage timestamp | FIXED - 'unknown' fallback |
| V-L5 | LOW | formatCents renders malformed non-integer jsonb oddly | ACCEPTED - reachable only via hand-inserted malformed data; render-safe |
| V-L6 | LOW | /approvals swallowed approval_links read errors | FIXED - visible context-unavailable note |
| V-L7 | LOW | /approvals raw ISO timestamps (pre-existing style) | ACCEPTED - pre-Phase-6 convention; cosmetic |
| V-L8 | LOW | Setup-mode fixture render of /business unreachable via HTTP (proxy redirects first) | ACCEPTED - fail-safe dead path, documented |

Documentation-consistency audit:

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C-M1 | MED | Per-file test counts wrong in test-audit report | FIXED here: current per-file counts recorded in the staging closeout; old report annotated by supersession |
| C-M2 | MED | Data dictionary claimed no FK on quotes.project_id | FIXED - dictionary corrected |
| C-M3 | MED | Architecture doc omitted refreshRecommendations | FIXED - actions list + write paths updated (now includes all seven actions) |
| C-M4 | MED | Binder/NEXT_GATES told owner to push a too-short range | FIXED - both updated; push is DONE (origin==master verified) |
| C-M5 | MED | Stale pending-owner entries after push + 0009 application | FIXED - binder E6 and NEXT_GATES record DONE with owner-reported evidence |
| C-M6 | MED | Migration verification SQL sampled only some tables/pins | FIXED - full-coverage follow-up SQL block added to the packet (all-18 RLS, all-18 anon, all-4 pins) |
| C-L1 | LOW | Closeout rollback said six commits vs eight | FIXED |
| C-L2 | LOW | Closeout file counts mixed ranges | FIXED - both ranges stated |
| C-L3 | LOW | "22 existing tables" undercount (actual 24) | FIXED in migration header + test comment |
| C-L4 | LOW | Engine comment said two rounding points (three) | FIXED |
| C-L5 | LOW | Spec missing validation-level bound error | FIXED |
| C-L6 | LOW | Contract overstated "exactly one run row" | FIXED - warning exceptions documented |

## Claim re-verification results (no defects)

HEAD == origin/master == 7ec5b40 at cycle start; tree clean.
Tests reproduced 632/630/2 at 7ec5b40 and 654/652/2 after
remediation (the 2 failures are the documented pre-existing
Windows bash-scanner subprocess timeouts, present unchanged at
04c3c75). Lint clean; Next build + typecheck pass; os-runtime
build passes and dispatcher health exits 78 no-env; secret scan 0;
RED-boundary scan 0; browser bundle (.next/static) contains no
service_role reference and no server-secret env identifier.

## Open defects

Critical: 0. High: 0. Medium: 0 open (all fixed this cycle).
Low accepted: V-L5, V-L7, V-L8 (documented above) plus the
build-cycle accepted items in PHASE_6_DEFECT_REGISTER.md
(D14, D15, D24-D29 minus the two now-resolved residuals).
