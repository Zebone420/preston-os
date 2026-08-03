# VERIFICATION REGISTER - V3/V4/V5/V8 EVIDENCE + RECOMMENDATIONS

Date: 2026-08-02. Author: build agent (evidence only - RULINGS ARE
OWNER-ONLY). Sources: repo code at c24a7e5, read-only TEST-base
inspection 2026-08-02 (see AIRTABLE_TEST_CORRECTIONS_OWNER_PACKET.md),
Verification Register v1.

Format per item: current status / evidence / decision needed /
recommendation. Nothing below enters context/ or client-facing math
until the owner records a dated ruling.

## V3 - Credit-card fee (PENDING_OWNER_RULING)

Evidence:
- Live TEST formula (Payments Received.Value After Credit Card
  Comission): card payments DIVIDE by 1.035; wire payments subtract a
  flat $15; description claims it multiplies. Full text in the
  corrections packet.
- Repo code: NO credit-card fee math exists anywhere in
  lib/business (verified by search at c24a7e5). The quote engine has
  no fee input, so a ruling creates new code surface, not a fix.
- Owner math note (register): x1.035 adds 3.5 pct; /1.035 reduces;
  net-fee recovery would divide by 0.965.

Decision needed - pick the INTENT, the math follows:
  a) Surcharge model: customer price already includes a 3.5 pct
     card surcharge added at quote time. Then base = paid / 1.035 and
     the live formula is CORRECT (only the description is wrong).
     But no quote-side surcharge exists in repo or TEST base today,
     which argues against this being the operating model.
  b) Processor-net model: the processor keeps ~3.5 pct of the charge;
     net = paid * 0.965. Then the live formula UNDERSTATES net by
     ~0.12 pct of payment value and must change to * 0.965.
  c) Whatever is ruled: is the flat $15 wire deduction correct?
     It is unregistered - recommend adding it as a new register fact
     (V10 suggested) with its own ruling.

Recommendation: rule (b) unless quotes are supposed to carry a card
surcharge; simultaneously rule the wire fee; then one owner-run edit
fixes formula + description together (TEST, then PROD gate).

## V4 - Markup rule (PENDING_OWNER_RULING)

Evidence:
- Register: 25 pct over $75,000 pre-tax material is NOT canonical;
  percentage, threshold, and basis undecided.
- Repo code is ruling-ready and fail-safe: no default markup is ever
  applied; any nonzero explicit markup is flagged
  (FLAG_MARKUP_UNVERIFIED = 'markup_rule_unverified_v4',
  quote-engine.ts); MarkupMode supports 'percent_milli' and
  'fixed_cents' (types.ts), so any ruling maps to existing inputs.
- TEST base: ZERO markup fields exist (schema scan 2026-08-02) -
  consistent with the register's "no Airtable markup field yet".

Decision needed (three numbers + one word):
  percentage; threshold; basis = full amount vs amount above
  threshold; applies to = material only vs material+labor.

Recommendation: no code or Airtable change until ruled. When ruled,
the bounded gate is: encode as milli-percent constant + threshold in
types.ts, drop the unverified flag for compliant quotes, add engine
tests pinning the ruled example values, THEN (optionally) an Airtable
field in its own gate.

## V5 - NJ sales tax 6.625 pct (UNVERIFIED)

Evidence:
- Statutory NJ state sales and use tax rate is 6.625 pct (multiplier
  1.06625), unchanged since 2018-01-01.
- Repo code already encodes NJ: 6625 milli-percent (types.ts) as
  PROMPT-CANONICAL ONLY, with a mandatory owner-confirmation flag on
  every NJ quote until V5 is ruled (types.ts comment + quote-engine
  flag) - owner-validated behavior in the Phase 6 V0-V7 gate.
- Scope caveat worth capturing in the ruling: NJ Urban Enterprise
  Zones allow half rate (3.3125 pct) for qualified sellers, and NJ
  has capital-improvement exemption interplay (relates to V7 ST-124).
  Recommend ruling the STATEWIDE default and explicitly deferring
  UEZ/exemption handling.

Recommendation: rule V5 = 6.625 pct / 1.06625 statewide default,
defer UEZ + exemptions (tie to V7). Follow-up bounded gate: remove
the mandatory NJ confirmation flag; keep it until then.

## V8 - Primary address and domain (PENDING_OWNER_RULING)

Evidence (identity usage as of 2026-08-02, none of it canonical):
- preston.nyc is already the OPERATING identity everywhere the
  system authenticates: owner email info@preston.nyc (Supabase owner
  allowlist + auth user, git identity, Google OAuth test identity).
- prestonwd.com currently serves legacy automation
  (automation.prestonwd.com = public n8n console, finding LA-1) -
  its disposition is entangled with the legacy retirement audit.
- Address candidates 433 Broadway vs 1123 Ave Z: NO repo evidence
  exists to prefer either; this is pure owner knowledge. DNS/registrar
  facts arrive with Evidence Session D (item 5 DNS + R1-3 MX/mailbox
  hosting - note preston.nyc mail hosting is itself undocumented,
  a lockout risk flagged in the retirement audit).
Blocked by V8 until ruled: OAuth consent-screen branding, quote/doc
templates, signatures, context/ seeds.

Recommendation: rule the DOMAIN now (preston.nyc as primary is the
low-risk ruling consistent with all live auth identities; prestonwd
.com stays as redirect-only pending the legacy audit). Defer the
ADDRESS ruling to the same sitting as Evidence Session D if needed,
but note nothing technical blocks ruling it immediately.

## Suggested register updates once ruled (owner edits, dated)

- V3: status + chosen model + formula-correction requirement.
- V10 (new): wire-payment flat fee $15 - confirm or reject.
- V5: OWNER_RULED statewide 6.625 pct; UEZ deferred (link V7).
- V8: domain ruling now; address ruling when chosen.
