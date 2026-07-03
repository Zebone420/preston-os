# PRESTON AI VERIFICATION REGISTER v1

Status: Phase 0A document. Facts marked PENDING_OWNER_RULING must not
appear in client-facing calculations, documents, messages, quote
outputs, payment requests, or production automations. New unverified
facts discovered mid-build receive a V-number here.

## Register

| # | Fact | Status |
|---|---|---|
| V1 | Payment schedule | OWNER_RULED 2026-07-03 |
| V2 | NYC sales tax multiplier | OWNER_RULED 2026-07-03 |
| V3 | Credit-card fee | PENDING_OWNER_RULING (deferred 2026-07-03) |
| V4 | Markup rule | PENDING_OWNER_RULING (deferred 2026-07-03) |
| V5 | NJ sales tax 6.625% | UNVERIFIED |
| V6 | Financing process | UNVERIFIED |
| V7 | ST-124 capital improvement handling | UNVERIFIED |
| V8 | Primary address and domain | PENDING_OWNER_RULING (deferred 2026-07-03) |
| V9 | MVP0 / Stage 5C status claims | ACCEPTED PROVISIONALLY - re-confirm at Phase 4 entry |

## Rulings

Recorded 2026-07-03. Decider: owner.

### V1 - Payment schedule: OWNER_RULED

- PAYMENT_SCHEDULE_STATUS = OWNER_RULED
- INSTALL_PAYMENT_SCHEDULE = 50 / 25 / 25
- PRODUCT_ONLY_PAYMENT_SCHEDULE = 75 / 25
- APPLIES_BY_JOB_TYPE = TRUE
- The 25/25/50 schedule is non-canonical and excluded from quote math,
  payment reminders, templates, and context/ seeds.
- Backlog: the Airtable workflow policy encoding 25/25/50 contradicts
  this ruling and needs correction in a later bounded gate.

### V2 - NYC sales tax: OWNER_RULED

- NYC_SALES_TAX_STATUS = OWNER_RULED
- NYC_SALES_TAX_RATE = 8.875%
- NYC_SALES_TAX_MULTIPLIER = 1.08875
- AIRTABLE_FORMULA_CORRECTION_REQUIRED = TRUE
- The Airtable formula using 1.08876 is a typo/rounding error, to be
  corrected in a later bounded formula-correction gate.

### V3 - Credit-card fee: DEFERRED

- CREDIT_CARD_FEE_STATUS = PENDING_OWNER_RULING
- CREDIT_CARD_FEE_FORMULA_CANONICAL = FALSE
- AIRTABLE_CC_FEE_CORRECTION_REQUIRED = PENDING_OWNER_RULING
- Owner math note: multiplying x1.035 adds 3.5%. Dividing by 1.035
  reduces the amount, it does not add 3.5%. If the intent is net-fee
  recovery that would usually divide by 0.965, but that is not
  approved. No formula change yet except a backlog placeholder.

### V4 - Markup rule: DEFERRED

- MARKUP_RULE_STATUS = PENDING_OWNER_RULING
- The 25% markup over $75,000 pre-tax material rule is not canonical.
- Percentage, threshold, and basis (full amount vs amount above
  threshold) await owner decision.
- No Airtable markup field or formula yet except a backlog placeholder.

### V8 - Primary address and domain: DEFERRED

- PRIMARY_ADDRESS_STATUS = PENDING_OWNER_RULING
- PRIMARY_DOMAIN_STATUS = PENDING_OWNER_RULING
- Address candidates: 433 Broadway; 1123 Ave Z.
- Domain candidates: prestonwd.com; preston.nyc.
- Neither may be used as canonical in templates, OAuth branding,
  signatures, or context/ seeds until the owner rules.

## Owner Session Checklist (Gate 0A-5) - COMPLETE 2026-07-03

- [x] V1 ruled.
- [x] V2 ruled.
- [x] V3 explicitly deferred.
- [x] V4 explicitly deferred.
- [x] V8 explicitly deferred.

V5-V7 remain open (recommended, not required). V9 re-verifies at
Phase 4 entry.

## Ruling Format

Each resolved fact records: ruling, date, decider, source or evidence.
Only after a ruling may the fact enter context/ (see context/README.md).
