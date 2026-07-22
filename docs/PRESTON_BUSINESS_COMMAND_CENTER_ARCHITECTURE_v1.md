# PRESTON BUSINESS COMMAND CENTER - ARCHITECTURE v1

Date: 2026-07-21
Status: coded and tested at Phase 6; staging deployment owner-run.
Scope: Business Command Center V1 + quote-draft agent (simulation).

## 1. Position in the system

The Business Command Center is a read-oriented owner dashboard over
new business tables in Supabase staging, plus one simulation-only
business agent. It reuses the existing platform layers unchanged:

- Auth: proxy.ts cookie gate -> owner-auth allowlist ->
  resolveOwner() in-handler re-check -> owner-only RLS
  (public.is_owner()).
- Governance: approvals table + decideApprovalRow (CAS) + audit_log
  via logAudit. Execution remains impossible (evaluateExecution has
  no live path; system_controls.execution_enabled=false).
- The AI-OS runtime (os_jobs/leases/Hermes) is NOT used by V1
  business agents (ADR-3 in reports/PHASE_6A_DISCOVERY_AND_PLAN.md).

## 2. Module map

Library (apps/dashboard/src/lib/business/):
- types.ts        - domain types mirroring migration 0009; money =
                    integer cents; rates = milli-percent /100000.
- quote-engine.ts - pure deterministic pricing (validate, price,
                    payment split). No I/O, no clock.
- quote-agent.ts  - simulation-only draft agent: validate ->
                    price -> persist quote/version/items/schedule ->
                    approval request + links -> run record ->
                    activity event. Idempotent by run key.
- business-store.ts - Supabase adapters in the ai-os store idiom:
                    injectable RLS-bound client, idempotent
                    inserts, CAS updates, fail-closed reads.
- read-models.ts  - pure aggregation (executive summary, payments,
                    margins, pipeline, staleness, formatting).
- recommendations.ts - deterministic advice rules; approval always
                    required; stable idempotency keys.
- fixtures.ts     - deterministic labeled fixture dataset; quote
                    numbers computed by the engine at module load.
- page-data.ts    - page loader: connected mode reads all surfaces
                    via RLS client; setup mode serves fixtures.

UI (apps/dashboard/src/app/business/ + components/business/ui.tsx):
- /business            executive dashboard + recommendations
- /business/pipeline   sales pipeline stage board
- /business/quotes     quote list + quote-draft agent form
- /business/quotes/[id] quote versions, items, schedule, flags
- /business/projects   projects + milestones + orders + installs
- /business/payments   payments, outstanding, margins
- /business/activity   append-only ledger + communications
- /business/agents     agent operations + safety posture
- actions.ts           server actions: createQuoteDraft,
                       decideRecommendation (owner re-checked)
- /approvals (extended) renders approval_links context and
                       deep-links quote drafts.

Data: supabase/migrations/0009_phase6b_business_foundation.sql
(18 tables; see docs/PRESTON_BUSINESS_DATA_DICTIONARY_v1.md).

## 3. Data flow

Read path: page (server component, force-dynamic) ->
resolveBusinessPageContext (owner check / setup detection) ->
loadBusinessData (parallel bounded selects, per-table error
capture) -> pure read models -> render with explicit empty/error
states and SIMULATION labels. Setup mode renders the fixture
dataset behind a visible SETUP MODE badge; fixture rows carry
provenance fixture:true.

Write paths (all owner-gated, all audited):
1. createQuoteDraft action -> runQuoteDraftAgent (see agent
   contract doc). Writes: quotes, quote_versions, quote_items,
   payment_schedules, approvals(+links), quote_draft_runs,
   business_activity_events, audit_log.
2. decideRecommendation action -> CAS status update on
   agent_recommendations + audit_log.
3. Approval decisions stay on the existing /approvals action.

## 4. Invariants

- Money is integer cents end to end; rounding only in
  mulDivRoundHalfUp (markup, tax, schedule stages).
- Only owner-ruled facts are hard-coded: V1 payment splits and
  NYC 1.08875. NJ is flagged for owner confirmation on every
  draft; markup is always an explicit flagged input (V4 deferred);
  ST-124 is tracking-only.
- Simulation pins: DB CHECKs force quote_versions.simulation_state
  = 'simulation', quote_draft_runs.simulation_only = true and
  execution_eligible = false. App code re-forces the same values.
- Append-only ledger: business_activity_events has no update or
  delete privilege.
- No business module can send, spawn processes, or reach external
  business systems (structural pin
  test/business-non-execution.test.ts).
- Every write validates first and is idempotent where a unique key
  exists; reads fail closed to empty lists with visible errors.

## 5. State terminology (Phase 6, as of this document)

- designed, coded, tested, audited, documented, committed: YES for
  everything above.
- pushed: NO (owner pushes).
- deployed: NO (owner-run; see staging deployment packet).
- migration 0009 applied: NO (owner-run; see migration packet).
- activated: not applicable - there is nothing to activate; the
  agent runs only when the owner submits the form, and execution
  remains disabled globally.
- production-ready: NO, and not claimed. Staging-only by design.

## 5b. Known V1 limits (accepted, documented)

- Read limits: pages load bounded row sets (default 200; items/
  milestones 500; activity/approvals 100). Past those caps the
  newest rows win and the activity card labels truncation; other
  aggregates silently reflect the loaded window. Owner-scale data
  stays far below these bounds; revisit before any multi-user use.
- The quote detail page resolves its approval badge from the
  newest 100 approvals; older approvals show version-level state
  only.
- A Supabase outage at the auth step renders the login prompt
  (resolveOwner cannot distinguish outage from signed-out); table
  read outages degrade to visible per-table error notes.
- No error.tsx/loading.tsx boundaries exist app-wide (consistent
  with the pre-existing app); unexpected render throws hit the
  default Next error surface.
- Duplicate-insert outcomes return the attempted id (or empty for
  DB-generated ids), not a read-back of the stored row; the one
  path that needs the stored row (agent idempotent replay) does an
  explicit read first.
- Dismissed recommendations never re-fire for the same
  (kind, entity) pair - an owner dismissal is a ruling (see
  recommendations.ts header).
- searchParams values are typed as strings; array-valued repeats
  of a query param render harmlessly but are not modeled.

## 6. Future gates (not in V1)

- Real (non-simulation) quote issuance: requires owner gate +
  migration altering the simulation CHECKs + proposal/PDF path.
- Airtable/Google import into business tables (connector gate).
- Realized-margin cost model (needs V4 markup ruling).
- Outbound communication drafts -> send path (separate RED gate,
  approval + audit + template review per master plan).
- Wiring business jobs into the os_jobs runtime if long-running
  agent work ever appears.
