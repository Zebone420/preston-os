# PRESTON AI VERIFICATION REGISTER v1

Status: Phase 0A document. Facts below are unverified, conflicted, or
provisional. They must not appear in client-facing calculations, documents,
messages, quote outputs, payment requests, or production automations until
cleared by the owner. New unverified facts discovered mid-build receive a
V-number here.

## Register

| # | Fact | Source A | Source B | Status |
|---|---|---|---|---|
| V1 | Payment schedule | Airtable workflow policy: 25/25/50 | ChatGPT plan: 50/25/25 install, 75/25 product-only | CONFLICT - owner ruling needed |
| V2 | NYC sales tax multiplier | Airtable formula: 1.08876 | Statutory: 1.08875 (8.875%) | CONFLICT - fix formula or confirm intent |
| V3 | Credit-card fee | Field description: multiply x1.035 | Actual formula: divide by 1.035 | CONFLICT - high financial impact |
| V4 | Markup rule | 25% on pre-tax material over $75,000 | No markup field exists in base | UNVERIFIED - confirm rule and threshold |
| V5 | NJ sales tax 6.625% | ChatGPT plan | Not represented in base | UNVERIFIED |
| V6 | Financing process | Prior modules | No schema representation | UNVERIFIED |
| V7 | ST-124 capital improvement handling | Both plans reference | Workflow-level only | UNVERIFIED - document actual process |
| V8 | Primary address and domain | 433 Broadway vs 1123 Ave Z; prestonwd.com vs preston.nyc | Longstanding open item | UNVERIFIED - owner ruling |
| V9 | MVP0 / Stage 5C status claims | Prior ChatGPT status section | Not independently verified | ACCEPTED PROVISIONALLY - re-confirm at Phase 4 entry |

## Owner Session Checklist (Gate 0A-5, about 30 minutes)

Required: V1, V2, V3, V4, V8. Recommended: V5, V6, V7. V9 at Phase 4 entry.

- [ ] V1: Which payment schedule is correct, per job type?
- [ ] V2: Correct tax multiplier (1.08876 vs 1.08875), and where to fix it.
- [ ] V3: Credit card fee: multiply x1.035 or divide by 1.035?
- [ ] V4: Is the 25% markup over $75,000 pre-tax material a real rule?
      Confirm threshold and where it applies.
- [ ] V8: Primary address (433 Broadway vs 1123 Ave Z) and primary domain
      (prestonwd.com vs preston.nyc).

## Ruling Format

Each resolved fact records: ruling, date, decider, source or evidence.
Only after a ruling may the fact enter context/ (see context/README.md).

## Rulings

(None yet. Owner session pending at Gate 0A-5.)
