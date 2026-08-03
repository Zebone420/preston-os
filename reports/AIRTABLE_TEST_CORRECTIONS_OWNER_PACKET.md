# AIRTABLE CORRECTIONS PACKET - V1 / V2 / V3 SURFACES (2026-08-02)

Scope: read-only inspection of the TEST/DEV base "PRESTON ACTIVE -
AI/N8N TEST" (appI3Pw1EMy9RugOp) performed 2026-08-02 via the Airtable
MCP connection. 36 tables, all formula fields and all 16 automations
enumerated. NOTHING was changed: the one attempted TEST-base formula
correction was DENIED by the local permission layer (mutating MCP is
H-6-scoped), so every correction below is owner-run or a later
explicitly approved gate. The PROD base was not touched or queried
(H-1).

## 1. V2 - 1.08876 tax multiplier: EXACTLY LOCATED (TEST base)

Table: Projects (tblkbhAUEEYhyGfPc)
Field: Total Deal Value (fldjHvpcN7RGAkHBO), formula, currency result.
Defect: THREE occurrences of `* 1.08876` (owner-ruled value: 1.08875),
one per component, each gated by its tax checkbox:

- component flde5LI2cpB47uxwF gated by fldjzHiPa7WwveDGp
  (Installation Taxes)
- component flditYWaxsaa5QPBZ gated by fldZz2Az0NzfXHZx1
  (Total Products Sold Taxes)
- component fldBlY65YzyYSXBoV gated by fldbKxDTkJfvX11NZ
  (LPC Filling Taxes)
- minus fldA2yoYHBFpdGc0D at the end.

Current formula (captured verbatim 2026-08-02, line breaks as stored):

```
IF({flde5LI2cpB47uxwF},
  IF({fldjzHiPa7WwveDGp}, {flde5LI2cpB47uxwF} * 1.08876, {flde5LI2cpB47uxwF}),
  0
) +
IF({flditYWaxsaa5QPBZ},
  IF({fldZz2Az0NzfXHZx1}, {flditYWaxsaa5QPBZ} * 1.08876, {flditYWaxsaa5QPBZ}),
  0
) +
IF({fldBlY65YzyYSXBoV},
  IF({fldbKxDTkJfvX11NZ}, {fldBlY65YzyYSXBoV} * 1.08876, {fldBlY65YzyYSXBoV}),
  0
)
- {fldA2yoYHBFpdGc0D}
```

Correction (owner-run, TEST base first, then PROD in its own gate):
replace all three `1.08876` with `1.08875`. Nothing else changes.
Downstream consumers that recompute automatically: Balance
(fldYqv3YrBAvDiuWW = payments received - Total Deal Value). Expect
Balance/Total Deal Value to shift by 0.001 pct of each taxed component
on existing records - this is the intended correction, not damage.

Verification after the owner edit (read-only): re-read the field
config and confirm zero `8876` occurrences and three `1.08875`; spot
check one taxed project: Total Deal Value = taxed components * 1.08875
+ untaxed components - discount.

NOTE: an identical formula presumably exists in the PROD base. The
PROD edit is production access = RED gate, owner-run only, after the
TEST edit is verified.

## 2. V1 - 25/25/50 payment schedule: NOT ENCODED in the TEST base

Exhaustive scan result (2026-08-02): no field, formula, select option,
or automation in appI3Pw1EMy9RugOp encodes a 25/25/50 (or 50/25/25)
payment schedule. All 16 automations are undeployed and none computes
payment stages.

Implication: the "Airtable workflow policy encoding 25/25/50" (V1
ruling backlog) lives OUTSIDE this base - candidates, in likelihood
order: (a) the 7 legacy n8n workflows on automation.prestonwd.com
(exports = Evidence Session B, credential-excluded), (b) prod-base
interfaces/automations not present in the TEST copy, (c) a document
template. ACTION: close this item during Evidence Session B review;
no TEST-base correction exists to make. Repo code already implements
the ruled 50/25/25 and 75/25 (quote-engine.ts, owner-validated
Phase 6).

## 3. V3 - credit-card fee: LIVE FORMULA CONTRADICTS ITS DESCRIPTION

Table: Payments Received (tblhXxUZsHBGNHf0D)
Field: Value After Credit Card Comission (fldEXYBOR5uGbNt2X)
Description says (Spanish): "Multiplica el valor de pago por 1.035 si
se pago con tarjeta de credito" (multiplies by 1.035).
Actual formula (captured verbatim):

```
IF(
  {fldAwEed80AXKBDuM},
  {fldDSYXysWuClhd24} - 15,
  IF(
    {fldQjgFITRG6ZoYDx},
    {fldDSYXysWuClhd24} / 1.035,
    {fldDSYXysWuClhd24}
  )
)
```

Where: fldAwEed80AXKBDuM = Paid By Wire (checkbox), fldQjgFITRG6ZoYDx
= Paid By Credit Card (checkbox), fldDSYXysWuClhd24 = Payment Value.

Findings feeding the V3 ruling (see the companion evidence doc):
- It DIVIDES by 1.035 (does not multiply). Description is wrong
  either way.
- NEW, unregistered fact: wire payments subtract a FLAT $15. This is
  not in the Verification Register; recommend a new V-number.
- Rollup consumer: Accountability Reports "Total Payments Received
  (After Credit Card Comission)" (fldTvsYzSN7nleVf2) feeds Monthly
  Profit - the ruling therefore affects reported profit.

No correction is possible until the owner rules V3 (see evidence doc
section V3 for the decision menu). Then: fix formula AND description
together in one owner-run edit (TEST first, then PROD gate).

## 4. Register / doc follow-ups after owner action

- docs/PRESTON_AI_VERIFICATION_REGISTER_v1.md: on V2 PROD completion,
  clear AIRTABLE_FORMULA_CORRECTION_REQUIRED; on V3 ruling, record
  ruling + the wire-fee fact.
- context/nyc_sales_tax.md + context/payment_schedule.md: update the
  "pending Airtable correction" notes when the respective fixes land.
- NEXT_GATES.md lines 9-10 stay open until PROD edits are done.
