# PRESTON QUOTE CALCULATION SPECIFICATION v1

Date: 2026-07-21
Implementation: apps/dashboard/src/lib/business/quote-engine.ts
Tests: apps/dashboard/test/quote-engine.test.ts
Status: simulation-only draft math. Not a price commitment.

## 1. Units

- Money: integer cents. Bounds: 0 <= value <= 50,000,000,000
  cents (500 million dollars). Quantity: integer 0..10000.
  Items per quote: 1..200.
- Rates: integer milli-percent over the fixed denominator
  100000. 8875 = 8.875 pct. This makes the owner-ruled NYC
  multiplier exact: total = subtotal * (100000 + 8875) / 100000
  = subtotal * 1.08875.

## 2. Rounding

Single rounding primitive: mulDivRoundHalfUp(a, b, d) =
floor((a*b + floor(d/2)) / d) on non-negative safe integers.
Round-half-up is applied at exactly three places: percent markup,
tax, and non-final payment stages. Everything else is exact
integer addition/multiplication. The final payment stage takes
the remainder so stages always sum to the total.

## 3. Inputs

scope_type: installation | product_only (required)
jurisdiction: NYC | NJ (required; anything else is rejected)
items[]: opening_label, product_line, description,
  quantity (required), unit_material_cents (required),
  unit_labor_cents (required for installation; forbidden nonzero
  for product_only), line_fees_cents (optional)
quote_fees_cents: optional quote-level fees
markup_mode: none (default) | percent_milli | fixed_cents
markup_value: required when mode != none; percent capped at
  100000 (100 pct)
st124_tracking: optional jsonb passthrough (never affects math)
exclusions: string list passthrough

Validation is fail-closed: any missing or malformed material
input produces failed_validation with named missing_fields and
errors; the engine never guesses or substitutes values.

## 4. Calculation (in order, all integer)

line_material_i = quantity_i * unit_material_cents_i
line_labor_i    = quantity_i * unit_labor_cents_i   (0 for
                  product_only)
line_total_i    = line_material_i + line_labor_i +
                  line_fees_cents_i

material = sum(line_material_i)
labor    = sum(line_labor_i)
fees     = quote_fees_cents + sum(line_fees_cents_i)
base     = material + labor + fees

markup   = 0                         if mode = none
         = markup_value              if mode = fixed_cents
         = roundHalfUp(base * markup_value / 100000)
                                     if mode = percent_milli

subtotal = base + markup
tax      = roundHalfUp(subtotal * rate / 100000)
           rate: NYC 8875 (owner-ruled V2), NJ 6625 (flagged)
total    = subtotal + tax
margin   = markup  (V1 projected margin = explicit markup only;
           realized margin requires the V4 ruling + cost data)

Oversized quotes fail closed twice: validation rejects any
pre-tax base over the money bound with the named error
totals_exceed_supported_bounds (failed_validation), and the
residual percent-markup/tax overflow path still aborts with an
internal error (failed_error). Never a wrong number.

## 5. Payment schedules (owner-ruled V1)

installation_50_25_25 (scope installation):
  deposit             = roundHalfUp(total * 50000 / 100000)
  before_installation = roundHalfUp(total * 25000 / 100000)
  at_completion       = total - deposit - before_installation

product_only_75_25 (scope product_only):
  deposit                    = roundHalfUp(total * 75000/100000)
  before_delivery_or_release = total - deposit

Invariant: stage amounts always sum exactly to total.

## 6. Assumption flags (stable identifiers)

- simulation_draft_not_a_price: always present.
- margin_equals_markup_no_cost_model: always present.
- markup_rule_unverified_v4: whenever markup > 0.
- nj_tax_rate_pending_register_ruling_v5: whenever
  jurisdiction = NJ (rate is canonical per the Phase 6 master
  goal; the Verification Register V5 ruling is still pending, so
  owner confirmation is mandatory).
- st124_tracking_only_no_tax_determination: whenever ST-124
  tracking data is present. The engine NEVER changes tax
  treatment based on it.

owner_confirmation_required is true on every draft.

## 7. Determinism guarantee

Same input object always produces an identical output object
(deep equality), with no clock, randomness, locale, or I/O
involvement. Pinned by tests including a 200-case seeded
property run and hand-verified examples:

NYC installation example: material 610000 + labor 215000 +
fees 25000 = subtotal 850000; tax = 850000 * 8875 / 100000 =
75437.5 -> 75438; total 925438; stages 462719 / 231360 / 231359.

NJ product-only example: base 1000000 + fixed markup 100000 =
1100000; tax = 72875 exactly; total 1172875; stages 879656 /
293219.

## 8. Explicit exclusions from V1 math

- No credit-card fee math (V3 deferred - no formula exists).
- No default or implied markup (V4 deferred).
- No capital-improvement tax reduction (V7 - tracking only).
- No discounts, financing, or multi-currency.
Any of these appearing in a quote number is a defect.
