# PHASE 6 - DEFECT REGISTER
# Business Command Center V1 + Quote-Draft Agent

Date: 2026-07-21. Source: three independent audit subagents
(security/RLS, business logic/math, architecture/ops) plus build
findings. Severities as reported by the auditors. Disposition
FIXED = repaired in commit 7c0fbf9 and covered by a test or pin
where applicable; ACCEPTED = documented, no code change in V1.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| D1 | MED | 0009 missing anon revokes (Supabase default privileges) | FIXED - revoke all from anon, 18 tables + test pin |
| D2 | MED | Mutable tables kept default delete privilege | FIXED - revoke delete, 12 tables + test pin |
| D3 | MED | quote_versions fully mutable despite immutability claim | FIXED - column-level update grant (approval_id only) + test pin |
| D4 | MED | Idempotency TOCTOU: duplicate submits can double-create; run row written last | PARTIALLY FIXED - approval-after-entities ordering removes orphan approvals; final-run race detected + audited; check-then-act window ACCEPTED (owner-only, arbitrated by unique key) |
| D5 | MED | Partial failure left orphan pending approvals / version pointer holes | FIXED - persistence reorder + no-orphan test |
| D6 | MED | Recommendation engine had no production caller; UI implied a running agent | FIXED - owner-triggered generation action, audited, idempotent; truthful labels |
| D7 | MED | Safety posture card could not distinguish unreadable controls from stopped | FIXED - readSystemControlsChecked + UNREADABLE banner |
| D8 | MED | Project payment summaries unpopulatable from agent data (schedule linked to version, not project) | FIXED - quote_id fallback to newest version in read model |
| D9 | MED | Stale hidden form key could silently discard a new submission (bfcache) | MITIGATED - duplicate outcome now states nothing new was saved and instructs a fresh form; ACCEPTED residual |
| D10 | MED | Quote header approval badge stale after re-draft | FIXED - CAS bump attaches new approval_id |
| D11 | MED | quotes.project_id lacked FK; stated rationale wrong | FIXED - guarded FK constraint added |
| D12 | MED | Aggregate money bound only enforced mid-engine as internal error | FIXED - named validation error totals_exceed_supported_bounds + test |
| D13 | MED | Line totals never asserted; a per-line bug would pass all tests | FIXED - explicit line-total tests + engine reconciliation invariant |
| D14 | MED | Milestones unique(project_id, kind) forbids repeats | ACCEPTED - V1 modeling documented in data dictionary |
| D15 | MED | Master-plan quote-spine fields absent (measurements, client decision, win/loss reason, documents) | ACCEPTED - explicit deferrals recorded in data dictionary |
| D16 | LOW | Percent markup float conversion rejected ~1.5% of valid inputs; half-cent rounding inconsistent | FIXED - digit-wise parsers |
| D17 | LOW | activity simulation_state not CHECK-pinned | FIXED - CHECK added + test |
| D18 | LOW | Unencoded redirect params; /business/quotes/undefined redirect | FIXED |
| D19 | LOW | No length caps on free-text inputs | FIXED - clip caps in agent |
| D20 | LOW | Empty-key failed runs deduped into one row (audit-trail loss) | FIXED - unique fallback keys + test |
| D21 | LOW | failed_error paths not audited | FIXED - audit call in failError |
| D22 | LOW | Executive summary counted archived quotes/won leads; outstanding included closed projects | FIXED |
| D23 | LOW | localeCompare sort; comm tie-break order dependence | FIXED (codepoint sort); tie-break ACCEPTED (stable sort, fixture-deterministic) |
| D24 | LOW | Duplicate-insert returns attempted id, not stored-row read-back | ACCEPTED - documented; replay path reads the stored row first |
| D25 | LOW | Approvals page reads business store directly (layering exception); entity_id rendered into href without UUID validation | ACCEPTED - server-generated UUIDs only today; React-escaped, same-origin path; noted for the next UI pass |
| D26 | LOW | Read limits silently truncate aggregates; approval badge window | ACCEPTED - documented (arch doc 5b); activity card labels truncation |
| D27 | LOW | No error.tsx/loading.tsx; outage renders login prompt | ACCEPTED - app-wide convention, documented |
| D28 | LOW | business_contacts schema-only; searchParams typing narrower than framework contract | ACCEPTED - documented |
| D29 | LOW | client_response rule suppressed by unsent drafts | ACCEPTED - assumption line added to the recommendation itself |
| D30 | COS | Test comment/name errors (6.625 rounding note, "basis points") | FIXED |

Unresolved CRITICAL: none. Unresolved HIGH: none.
Open MEDIUM residuals: the D4 check-then-act window (detected +
audited when it fires) and D9 bfcache resubmission UX - both
single-owner usability/consistency risks, not safety risks; no
execution, send, or production surface exists in any of them.
