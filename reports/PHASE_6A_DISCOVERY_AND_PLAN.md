# PHASE 6A - DISCOVERY AND IMPLEMENTATION PLAN
# Business Command Center V1 + Quote-Draft Agent (Simulation Mode)

Date: 2026-07-21
Author: Claude Code (implementation engineer)
Master goal: owner-approved Business Command Center V1 plus first
quote-draft business agent in simulation mode. No live sends, no
business writes outside staging fixtures, owner approval required,
execution disabled by default.

Starting commit: 04c3c75ef9209310e992a11d095d569776144b19 (clean)
Branch: master. Baseline validation at starting commit:
545 tests total, 543 pass, 2 fail (worktree-prep.test.ts bash
scanner subprocess timeouts on Windows; known environment
limitation, not code defects; Phase 5 closeout recorded the same
class of failure).

## 1. Current-state inventory (condensed)

### 1.1 Database (supabase/migrations 0001-0008)

Applied to staging (owner-run): 0001, 0002, 0003, 0004, 0005, 0006.
Authored, NOT applied: 0007 (runtime_roles), 0008 (job envelope).
Nothing new in this phase may depend on 0007 or 0008.

Existing tables cover: approvals, audit_log (append-only),
access_events, tasks, briefs, department_configs, legacy
command_packets, agents, agent_memory, locks, execution_queue,
os_events, runtime_command_packets, os_jobs, worker_leases,
job_attempts, job_checkpoints, dead_letters, repository_worktrees,
orchestration_decisions, system_controls, telegram_updates.

NO tables exist for: clients, contacts, properties, leads, quotes,
quote versions, quote items, projects, milestones, vendor orders,
installations, payment schedules, payment events, communications,
business activity ledger, agent recommendations, quote draft runs.
All business entities are greenfield. Business records currently
live only in the Airtable TEST/DEV base (read-only PAT).

Conventions to follow (from 0003-0006): snake_case, uuid pk default
gen_random_uuid() for FK-target entities, text pk for natural keys,
created_at timestamptz not null default now(), updated_at on
mutable tables, correlation_id text on runtime/append tables,
inline CHECK constraints (no enums), fail-closed booleans with
CHECK pins where invariant, owner-only RLS via public.is_owner(),
explicit grants to authenticated only (never anon), append-only =
insert+select policies plus revoke of update/delete, idempotency
via unique keys, additive and idempotent DDL only.

Name-collision warning: legacy command_packets (0001) proves
create-table-if-not-exists collides silently. All new tables use
the business_/sales_/quote_/project_/vendor_/installation_/
payment_/communication_/agent_ prefixes; none collide with the 22
existing tables.

### 1.2 Application (apps/dashboard, Next.js 16 App Router)

Pages (server components, force-dynamic, dark slate Tailwind v4):
/ (cards), /login, /approvals (+ server action decideApproval),
/audit, /brief, /os, /remote. No shared component directory; each
page repeats its own header/nav markup.

API routes: api/health, api/google/oauth/callback, api/telegram,
api/os/{status,queue,command,control,enqueue,jobs/cancel,chatgpt}.
All owner-gated via resolveOwner() except health/chatgpt/telegram
(self-authenticating or disabled by default).

Auth stack (4 layers): proxy.ts cookie gate -> owner-auth.ts
allowlist -> resolveOwner() in-handler re-check -> Supabase RLS
(is_owner()). New pages get proxy cover automatically; new server
actions must re-check owner inside the action.

Adapters: airtable.ts (read-only, writes throw), google.ts
(read-only, mock-by-default), supabase server/client (anon key,
RLS-bound, no service role in app), guards package (shutoff flags,
neutralizeUntrusted for external content).

Test stack: vitest 4, 40 files, 545 tests, injectable fakes, no
network, injected clocks, structural text pins (non-execution,
migrations, classifier contract, route auth).

### 1.3 AI-OS runtime (lib/ai-os, os-runtime)

Reusable as-is for this phase: approvals-store CAS decision +
audit, logAudit append-only writer, insertEvent idempotent event
pipeline with secret rejection, correlation id regex
(RUNTIME_ID_RE), controls fail-closed reads, agents registry.
The runtime job queue (os_jobs/leases/candidates) is NOT used by
the V1 quote agent (see ADR-3).

Non-execution posture already pinned by tests across 19 files:
execution_enabled false everywhere, no process spawning in 13
runtime files, all six os routes 401 non-owner, GREEN-only
enqueue, Hermes observe-only.

### 1.4 Business rules ground truth

Owner-ruled and usable (context/ + Verification Register):
- V1 payment schedules: install 50/25/25, product-only 75/25.
- V2 NYC sales tax 8.875%, multiplier 1.08875 (1.08876 is a typo).

Deferred/unverified (must not silently enter quote math):
- V3 credit-card fee: no canonical formula.
- V4 markup: no canonical rule. Markup must be an explicit
  configurable input flagged for owner confirmation.
- V5 NJ sales tax 6.625%: the master-goal prompt lists it as an
  owner-verified current rule; the repository register still says
  UNVERIFIED. Resolution (ADR-6): engine supports NJ 6.625% as a
  prompt-canonical rate, and every NJ draft carries a mandatory
  owner-confirmation assumption flag. Recorded for a dated
  register ruling at closeout.
- V7 ST-124: tracking fields only; no automatic legal or tax
  determination (both sources agree).

No pricing, quote math, or business calculations exist anywhere in
code today. The quote engine is net-new.

### 1.5 Scanner constraints for all new files

- RED scan (.ts/.tsx/.js/.mjs/.sql/.json/.sh/.ps1): never include
  the tokens for dropping/truncating tables or bulk SQL deletes,
  shell recursive-remove, sudo, no-verify, active:true JSON, curl/
  wget http, ssh/scp user-at-host, outbound PowerShell web calls.
  Markdown is exempt.
- Secret scan (all text files INCLUDING markdown): no assignments
  shaped like password/secret/api_key/apikey/auth_token followed
  by 20+ token chars; no JWT/PAT/key-shaped strings anywhere.
- Follow existing migration phrasing for append-only revokes
  (matches 0001-0006, which pass the scanners).

### 1.6 Obsolete documentation found (to reconcile at closeout)

- NEXT_GATES.md backlog lines still claim the CLAUDE.md master
  plan line is outdated; CLAUDE.md was already fixed. Stale.
- docs/PHASE_5_REMOTE_DRILL_RUNBOOK.md carries its superseded
  banner (correct, keep).
- reports/PHASE_6_CLOSEOUT_SKELETON.md superseded by
  PHASE_6_FINAL_READINESS_PACKET.md (stated in header; keep).
- Historical status trackers (MASTER_STATUS_REPORT,
  MILESTONE_100_TRACKER) are snapshots; no edits needed.
This phase adds business docs; it does not rewrite historical
gate reports.

## 2. Gap analysis (what must be built)

| Module | Existing | To build |
|---|---|---|
| Executive dashboard | card idiom only | new read models + page |
| Activity ledger | audit_log/os_events idiom | business_activity_events table + emitters + page |
| Sales pipeline | Airtable read-only cards | sales_leads table + stages + page |
| Quote management | none | quotes/quote_versions/quote_items + engine + page |
| Project operations | none | projects/milestones + page |
| Orders/installs | none | vendor_orders/installation_events + page |
| Payments/margins | none | payment_schedules/payment_events + margin read model + page |
| Approval Center | approvals table + CAS + UI | approval_links bridge + business approval kinds + surface drafts |
| Agent ops panel | agents table, os_jobs | quote_draft_runs + panel page |
| Communications | google/telegram read-only | communication_records table + page (display/draft only) |
| AI recommendations | none | agent_recommendations table + rule engine |
| Quote-draft agent | none | deterministic engine + agent service + versioning |

## 3. Architecture decision records

ADR-1 Supabase remains system of record; one required additive
migration 0009_business_foundation.sql creates all business
tables. Rationale: entities are one dependency-ordered unit; the
goal forbids bundling unrelated changes, and these are one
cohesive business foundation. Optional fixture SQL ships
separately (supabase/fixtures/, owner-run, never a migration).
Depends only on 0001/0002 (approvals, is_owner). No dependency on
0007/0008.

ADR-2 Money is stored and computed in integer cents (bigint).
Tax rates are stored per quote version as basis points (integer,
e.g. 8875 for NYC 8.875 pct) with a source label. All arithmetic
is integer cents with round-half-up at defined points (per line,
then per aggregate step). No floating point in totals. Rationale:
determinism requirement 4/5 of the agent acceptance criteria.

ADR-3 The V1 quote-draft agent is an in-process deterministic
service invoked synchronously by an owner-gated server action.
It is NOT wired into the os_jobs/lease/worker runtime. Rationale:
the runtime queue adds distributed-state complexity with zero V1
benefit (draft generation is fast, local, and simulation-only);
non-execution is structurally trivial to prove for a pure
function + store writes; the runtime remains available for a
future gate. The run is still recorded (quote_draft_runs +
activity + os_events-style audit) with correlation ids so the
Agent Operations Panel and evidence trail work the same way.

ADR-4 Approvals reuse the existing approvals table and CAS
decision flow unchanged. A new approval_links table maps
approval_id -> (entity_type, entity_id, kind) so business drafts
attach to approvals without altering the 0001 schema. Approval of
a quote draft records a decision ONLY; no execution path exists
(evaluateExecution has no live path for any business action, and
the new business kinds are draft-record kinds by construction).

ADR-5 The activity ledger is a new append-only
business_activity_events table (text pk with deterministic-id
option, idempotency_key unique, correlation_id, provenance
jsonb, simulation_state), not a reuse of audit_log. Rationale:
audit_log is the governance ledger with a fixed shape;
business events need entity_type/entity_id/summary and
owner-facing rendering. Emitters write both where appropriate
(governance action -> audit_log; business fact -> activity).

ADR-6 Tax jurisdictions: NYC 8875 bp (owner-ruled V2) and NJ
6625 bp (prompt-canonical, register V5 pending) are the only
supported jurisdictions. NJ drafts always carry assumption flag
nj_tax_rate_pending_register_ruling and set
owner_confirmation_required true. ST-124: quote versions carry
capital_improvement_tracking fields only; engine never decides
tax treatment from them. Unknown jurisdiction = validation error
(fail closed).

ADR-7 Markup: quote input requires an explicit markup mode
(none | percent_bp | fixed_cents). Because V4 is deferred, any
nonzero markup sets assumption flag markup_rule_unverified and
owner_confirmation_required true. The engine never applies a
default markup.

ADR-8 UI: new /business route group of server components reusing
the existing dark-slate idiom, force-dynamic, proxy-gated, with
per-page owner re-check for any action. Pages: /business
(executive dashboard + recommendations), /business/pipeline,
/business/quotes (list + draft detail + agent form),
/business/projects (projects + orders + installations),
/business/payments, /business/activity (ledger + communications),
/business/agents (agent operations). Approval Center: /approvals
extended to render business approval context via approval_links.
A small shared components module (src/components/business/) is
introduced for header/nav/cards to stop the copy-paste drift, but
no design-system rewrite.

ADR-9 All new business store writes go through a
business-store.ts adapter in the ai-os store idiom: injectable
RLS-bound client, validate -> idempotent insert (unique violation
= duplicate:true) or CAS update -> audit/activity emission,
fail-closed reads. Browser code never receives a service-role
key (unchanged; app has none).

ADR-10 Simulation labeling: every agent-produced record persists
simulation_state = 'simulation' and execution_eligible = false
with DB CHECK pins (execution_eligible = false CHECK, and
simulation_only = true CHECK on quote_draft_runs), mirroring the
0008 pin style. The UI renders a visible SIMULATION badge wherever
agent output appears.

## 4. Data model (migration 0009, required)

All tables: RLS owner-only via is_owner(); grants to authenticated
only; anon gets nothing. Append-only tables get insert+select
policies plus the standard revoke phrasing. Common columns:
id uuid pk default gen_random_uuid() unless noted, created_at,
updated_at (mutable tables), source text, source_record_id text,
provenance jsonb default '{}', archived boolean default false
(mutable entities), correlation_id where events/runs.

- business_clients: display_name, client_type CHECK
  (residential|commercial|institution|other), primary_email,
  primary_phone, notes.
- business_contacts: client_id FK, full_name, role, email, phone.
- business_properties: client_id FK, address_line, unit, city,
  region CHECK (NYC|NJ|OTHER), postal_code, landmark_flags
  (lpc_review boolean default false, dob_permit boolean default
  false), access_notes.
- sales_leads: client_id FK null, property_id FK null,
  display_name, stage CHECK (lead|qualified|site_visit|
  quote_requested|quote_drafted|quote_sent|follow_up|negotiation|
  won|lost|deferred), stage_changed_at, source, owner_next_action.
- quotes: client_id FK, property_id FK null, project_id uuid null,
  title, status CHECK (draft|pending_approval|approved|rejected|
  superseded|archived), current_version int default 0,
  approval_id uuid null.
- quote_versions: quote_id FK, version int, unique(quote_id,
  version), product_line, scope_type CHECK (installation|
  product_only), jurisdiction CHECK (NYC|NJ), tax_rate_bp int,
  material_cents bigint, labor_cents bigint, fees_cents bigint,
  markup_mode CHECK (none|percent_bp|fixed_cents),
  markup_value bigint default 0, markup_cents bigint,
  subtotal_cents bigint, tax_cents bigint, total_cents bigint,
  margin_cents bigint, payment_schedule jsonb, assumptions jsonb,
  exclusions jsonb, missing_fields jsonb, st124_tracking jsonb,
  draft_provenance jsonb, simulation_state text default
  'simulation' CHECK (simulation_state = 'simulation'),
  approval_id uuid null, correlation_id, created_by.
  (Simulation CHECK pin is V1-intentional; a future owner gate
  migrates the CHECK when real quotes are authorized.)
- quote_items: quote_version_id FK, position int, opening_label,
  product_line, description, quantity int, unit_material_cents
  bigint, unit_labor_cents bigint, line_fees_cents bigint,
  line_total_cents bigint, item_flags jsonb.
- projects: client_id FK, quote_id FK null, title, status CHECK
  (pending_contract|contracted|in_progress|punch_list|
  final_inspection|closed|cancelled), contract_status,
  deposit_status, milestone_summary jsonb.
- project_milestones: project_id FK, kind CHECK (contract|deposit|
  measurement|ordering|permit_lpc|permit_dob|delivery|
  installation|punch_list|final_inspection|final_payment|
  warranty_closeout), status CHECK (pending|in_progress|blocked|
  done|not_applicable), due_date date null, completed_at, note.
- vendor_orders: project_id FK, vendor, order_number, order_date,
  expected_ship_date, actual_ship_date, delivery_status CHECK
  (not_ordered|ordered|in_production|shipped|delivered|
  backordered|exception), backordered boolean default false,
  exception_note.
- installation_events: project_id FK, scheduled_date, crew,
  site_ready boolean default false, status CHECK (tentative|
  scheduled|in_progress|completed|rescheduled|cancelled), note.
- payment_schedules: quote_version_id FK null, project_id FK null,
  schedule_type CHECK (installation_50_25_25|product_only_75_25),
  stages jsonb (deterministic split, cents), total_cents bigint.
- payment_events (append-only): project_id FK null, quote_id FK
  null, kind CHECK (deposit_recorded|payment_recorded|
  adjustment_recorded), amount_cents bigint, method, recorded_by,
  note, correlation_id, idempotency_key unique.
- communication_records: client_id FK null, project_id FK null,
  channel CHECK (email|sms|whatsapp|phone|in_person|other),
  direction CHECK (inbound|outbound_draft), subject, summary,
  occurred_at, source_link, message_state CHECK (draft|received|
  logged) (no sent state exists in V1), approval_id uuid null.
- business_activity_events (append-only): id text pk default
  gen_random_uuid()::text, source, entity_type, entity_id text,
  action, summary, actor, provenance jsonb, correlation_id,
  approval_id uuid null, simulation_state text default
  'simulation', idempotency_key text unique.
- agent_recommendations: kind CHECK (quote_follow_up|
  missing_payment|stalled_project|delayed_order|
  installation_risk|missing_document|margin_anomaly|
  client_response), entity_type, entity_id text, evidence jsonb,
  assumptions jsonb, confidence CHECK (low|medium|high),
  suggested_next_step, approval_required boolean default true,
  status CHECK (open|acknowledged|dismissed|superseded),
  correlation_id, idempotency_key unique.
- quote_draft_runs: agent_name text default 'quote-draft-agent',
  input jsonb, input_missing_fields jsonb, quote_id FK null,
  quote_version_id FK null, status CHECK (completed|
  failed_validation|failed_error), failure_reason,
  assumptions jsonb, simulation_only boolean not null default
  true CHECK (simulation_only = true), execution_eligible boolean
  not null default false CHECK (execution_eligible = false),
  correlation_id, idempotency_key unique, created_by.
- approval_links: approval_id uuid FK -> approvals(id),
  entity_type, entity_id text, link_kind CHECK
  (quote_draft_approval|communication_approval|
  data_change_proposal|agent_recommendation), unique(approval_id,
  entity_type, entity_id).

Dropped from the candidate list (consolidation): sales_
opportunities (sales_leads carries the pipeline), agent_runs
(quote_draft_runs is the concrete V1 run record; generic runs
stay in os_jobs land).

## 5. Implementation map (dependency order)

- B1 migration 0009 + static migration tests + types
  (src/lib/business/types.ts) + validation.
- B2 fixtures: deterministic in-memory fixture set
  (src/lib/business/fixtures.ts) + optional owner-run staging
  fixture SQL (supabase/fixtures/business_staging_fixtures.sql).
- C1 quote engine (src/lib/business/quote-engine.ts): pure,
  deterministic, integer cents, payment split builder.
- C2 business store adapter (business-store.ts) + activity
  emitters + read models (read-models.ts).
- C3 recommendations rule engine (recommendations.ts).
- D1 shared business UI components + /business pages (8 surfaces).
- D2 approvals page extension (approval_links context).
- E1 quote-draft agent (quote-agent.ts): input contract,
  validation, missing-field handling, versioning, provenance,
  draft persistence; server action + form on /business/quotes.
- F1 approval bridge: draft -> approvals row + approval_links;
  approve/reject records decision only; structural pins.
- G1 full test/audit/documentation/closeout per master goal.

Commits at each stable milestone (docs/discovery, schema, services,
UI, agent, controls, tests/audit, closeout). No push.

## 6. Acceptance criteria (phase-level)

- Migration 0009 passes static tests; never applied by Claude.
- Quote engine: deterministic (same input -> identical output,
  property-tested with repeated runs), integer-cents math, exposes
  material/labor/fees/markup/tax/total/margin separately, both
  payment schedules split correctly to the cent (sum of stages =
  total), V3/V4/V5-dependent inputs flagged, unknown jurisdiction
  rejected, missing material inputs fail closed.
- Agent: all 20 acceptance criteria from the master goal, each
  covered by at least one test; structural non-execution pins
  extended to business modules (no process spawn, no fetch to
  external business systems, no send functions reachable).
- UI: every page renders loading-free server-side with explicit
  empty/error states, SIMULATION badges on agent output, source +
  provenance + timestamps visible, phone-usable layout.
- Approvals: decision recording only; approving a business draft
  triggers no execution (pinned by test).
- All routes fail closed (401 non-owner) - extended route auth
  tests.
- Full matrix green: vitest, eslint, tsc via next build,
  os-runtime build, secret + RED scans, baseline 2 known
  Windows scanner-timeout failures documented.

## 7. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Migration conflicts with applied schema | additive only, new prefixed names, static collision test against 22 existing tables |
| R2 | Unverified facts leak into quote output | engine hard-codes only V1/V2; V3/V4/V5 paths force assumption flags + owner confirmation; tests pin this |
| R3 | Float rounding nondeterminism | integer cents everywhere; rounding spec tested at boundaries |
| R4 | Approval implies execution | no execution path exists for business kinds; structural pin test; approval_links is metadata only |
| R5 | Scanner blocks commits | phrase SQL/TS to avoid RED tokens; no secret-shaped strings in fixtures/docs |
| R6 | UI scope explosion (12 modules) | consolidate to 7 pages + approvals extension; card/table idiom reuse |
| R7 | RLS regression | new policies copy 0004 pattern verbatim; security audit subagent must attempt non-owner access reasoning |
| R8 | Doc drift | closeout reconciliation step; data dictionary generated from migration content |
| R9 | os_jobs coupling temptation | ADR-3 keeps agent out of runtime queue in V1 |

## 8. Owner decisions needed now

None. All material ambiguities resolved from repository context
plus the master-goal rules, with the NJ tax discrepancy handled
fail-safe (ADR-6) and recorded for a dated register ruling at
closeout. Hard stops (push, migration application, deployment,
activation, credentials) remain owner-run.
