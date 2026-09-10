# PRESTON AI OS — FINAL MASTER BUILD PLAN v1
## Council-Reconciled, Repo-Grounded, Drive/Gmail-Informed Implementation Blueprint

**Date:** 2026-09-03  
**Status:** Candidate authoritative implementation contract  
**Execution authorization:** NONE — this document defines the build. Consequential execution remains separately owner-gated through Preston Control.

---

# 0. EXECUTIVE VERDICT

Preston should now stop redesigning the control plane and finish the system by building a **complete governed business operating spine** on top of the Preston Control foundation already in place.

The final architecture is:

```text
OWNER
  │
  │ voice / chat / secure approvals
  ▼
CHATGPT SUPERVISOR
  │
  │ Preston tool calls / structured goals
  ▼
PRESTON CONTROL
  ├── goals / jobs / routing
  ├── policy / risk
  ├── approvals / step-up
  ├── capability registry
  ├── deterministic business runner
  ├── Claude / Codex worker contracts
  ├── side-effect ledger
  ├── events / notification state
  ├── evidence / artifacts
  └── kill controls
          │
          ├─────────────┬─────────────────┐
          ▼             ▼                 ▼
       CLAUDE         CODEX        BUSINESS ADAPTERS
                                      │
                   Gmail / Calendar / Drive / DocuSign /
                   Home Depot / IQ+ / payments / future systems
          └─────────────┬─────────────────┘
                        ▼
                  SUPABASE BUSINESS SSOT
                        │
             ┌──────────┴───────────┐
             ▼                      ▼
       GOOGLE DRIVE               KNOWLEDGE FABRIC
   original business files     indexed/cited knowledge
             │                      │
             └──────────┬───────────┘
                        ▼
                   HERMES READ MODEL
                        │
                        ▼
              NEXT.JS SECURE ACTION CENTER
```

The governing doctrine is:

> **ChatGPT supervises. Preston authorizes. Deterministic systems own critical truth. AI workers perform bounded reasoning/work. Supabase owns business state. Google Drive owns original business files. Hermes compresses the business into decisions.**

The build objective is:

> **Maximum safe automation + minimum human handling + one-owner operability.**

---

# 1. WHAT THE CURRENT BUILD ALREADY GIVES US

Do not rebuild the following unless fresh evidence proves a defect.

## 1.1 Preston Control foundation

Preserve and harden:

- goals;
- jobs;
- routing;
- approval gates;
- owner confirmation;
- retries;
- dead letters;
- evidence;
- artifact retrieval;
- remote runner;
- worker isolation;
- fail-closed behavior;
- production/staging separation;
- event feed / supervisor bridge;
- capability contract pattern;
- side-effect/idempotency controls;
- Claude/Codex worker architecture.

## 1.2 Existing Supabase Business Foundation

The current business schema already models substantial operational state:

- clients;
- contacts;
- properties;
- leads;
- quotes;
- immutable quote versions;
- quote items;
- projects;
- project milestones;
- vendor orders;
- installation events;
- payment schedules;
- payment events;
- communication records;
- activity events;
- agent recommendations;
- approval links.

This is a strong base.

## 1.3 Explicit missing business-document layer

The current repo explicitly defers documents/photos; there is no general `documents` business table yet.

That is now promoted from a deferral to a **core foundation requirement**.

## 1.4 Existing Andersen knowledge-layer design

A source-cited, owner-only Andersen knowledge architecture was previously designed but not implemented.

The Drive audit now shows that the raw Andersen corpus is already much richer than the old plan expected.

Therefore:

> **Do not recreate the Andersen corpus. Ingest and operationalize the existing Drive corpus.**

---

# 2. FINAL AUTHORITY MODEL

## 2.1 Owner

The owner is the ultimate authority.

Owner-only / owner-gated by default:

- production deployment;
- DB production migrations;
- credential/secret changes;
- live customer/vendor sends until graduated;
- contracts/signatures;
- payments/refunds;
- purchase orders / order placement;
- destructive actions;
- RLS/policy weakening;
- force push;
- new service activation;
- autonomy promotion;
- unrestricted execution.

## 2.2 ChatGPT

ChatGPT is the owner-facing supervisor.

ChatGPT may:

- query Preston;
- explain state;
- reason across departments;
- submit goals;
- coordinate Claude and Codex through Preston;
- present approvals;
- relay explicit owner decisions;
- summarize evidence;
- recommend next work;
- perform voice-first supervision.

ChatGPT must not bypass Preston Control for consequential execution.

## 2.3 Preston Control

Preston Control is the sole authority for:

- orchestration;
- policy;
- capability authorization;
- business step execution;
- approvals;
- state transitions;
- retries;
- leases;
- concurrency;
- idempotency;
- event generation;
- evidence;
- actor attribution;
- kill controls.

No department, Hermes module, worker, Gmail process, or Drive automation becomes a second control plane.

## 2.4 Claude / Codex

Claude and Codex are bounded engineering/reasoning workers.

They do not become business transaction engines.

Use them for:

- code;
- architecture;
- document analysis;
- extraction/reconciliation candidates;
- review;
- drafting;
- research;
- complex exception analysis.

## 2.5 Deterministic Business Runner

Create/use a separate deterministic execution path for repeatable business workflows.

Examples:

```text
check_clock
check_stage
check_identity
evaluate_gate
render_document
propose_capability
wait_for_event
advance_state
```

Do not invoke an LLM where ordinary code can safely do the job.

## 2.6 Hermes

Near-term:

**Hermes remains read-only.**

Hermes is the business command center for:

- Today;
- Projects;
- Pipeline;
- Approvals;
- AI Workforce;
- Documents;
- Evidence/Incidents;
- metrics.

Consequential actions deep-link to the authenticated Preston/Next.js action surface.

---

# 3. SINGLE SOURCE OF TRUTH

# 3.1 Supabase = Canonical Business SSOT

Supabase becomes authoritative for:

- client identity;
- property identity;
- Project ID;
- lead/opportunity state;
- project stage;
- clocks;
- milestone predicates;
- quotes and versions;
- payment eligibility/state;
- final measurement state;
- compliance gates;
- order eligibility/state;
- installation state;
- workflow state;
- communication metadata;
- attention findings;
- approvals;
- document registry;
- knowledge provenance metadata.

## 3.2 Google Drive = Original Business File Repository

Drive stores human-readable originals:

- plans;
- photos;
- measurements;
- vendor quotes;
- proposals;
- contracts;
- receipts;
- LPC/DOB/board documents;
- orders;
- delivery documents;
- install photos;
- closeout;
- warranties.

Drive is **not** the workflow database.

Supabase stores the Drive File ID and document metadata.

## 3.3 Airtable

Airtable becomes:

- transitional source;
- optional team-facing surface;
- controlled mirror where useful.

Every synchronized field must have exactly one owner.

No ambiguous two-way authority.

## 3.4 Gmail

Gmail remains the primary communication source.

Supabase stores:

- message/thread references;
- project links;
- structured communication facts;
- derived attention findings;
- attachment/document references.

Do not duplicate every message body into Drive.

## 3.5 Knowledge Fabric

Reusable knowledge is distinct from live project documents.

Examples:

- Andersen official docs;
- LPC official rules;
- approved precedents;
- Preston SOPs;
- approved templates;
- installation knowledge.

---

# 4. CANONICAL IDENTITY & PROJECT MODEL

## 4.1 Internal keys

Keep UUID primary keys internally.

## 4.2 Human Project ID

Add immutable database-minted codes:

```text
P26-0001
P26-0002
P26-0003
```

Requirements:

- unique;
- never reused;
- non-AI generated;
- permanent;
- visible in Drive folders;
- visible in documents;
- available in Gmail subject normalization;
- visible in Hermes;
- used in vendor reconciliation.

## 4.3 Identity confidence ladder

```text
orphan
  ↓
candidate
  ↓
linked_auto
  ↓
confirmed
```

Rules:

- deterministic identifiers first;
- model matching can propose;
- human confirmation for ambiguous merges;
- EXTERNAL / STEP_UP actions require confirmed identity.

## 4.4 Matching signals

Use in priority order:

1. exact Project ID;
2. exact source-system external ID;
3. existing Gmail thread mapping;
4. quote/order number;
5. exact property + confirmed client;
6. exact known contact;
7. approved deterministic alias;
8. AI candidate match.

AI alone never authorizes a merge.

---

# 5. PRESTON PROJECT DOCUMENT & DRIVE REGISTRY

This becomes a CORE architecture component.

## 5.1 New-project automation

When a qualified lead/project is created:

```text
lead/project created
    ↓
mint Project ID
    ↓
create Drive client/project folder
    ↓
create standard subfolders
    ↓
save Drive folder id to Supabase
    ↓
register future files against project
```

## 5.2 Recommended Drive structure

```text
PRESTON BUSINESS FILES/
└── Clients/
    └── <Client Display Name>/
        └── P26-0041 — 123 W 78th St Apt 4A/
            ├── 00 Intake
            ├── 01 Site Photos
            ├── 02 Measurements
            ├── 03 Plans & Design
            ├── 04 Product & Vendor
            ├── 05 Quotes & Proposals
            ├── 06 Contract
            ├── 07 Payments & Receipts
            ├── 08 LPC DOB & Building
            ├── 09 Purchase Order
            ├── 10 Order & Delivery
            ├── 11 Installation
            ├── 12 Punch & Closeout
            └── 13 Warranty
```

Drive folder names are human convenience.

Supabase IDs remain authoritative.

## 5.3 Do not mass-move the old Drive

Migration strategy:

### Stage A — Inventory only
Traverse and classify.

### Stage B — New structure
All new projects use the new pattern.

### Stage C — Active projects
Move/copy/link active project documents carefully.

### Stage D — Historical
Index first; physically reorganize only when beneficial.

Do not perform a giant destructive Drive reorganization.

## 5.4 `documents` registry

Create a canonical Supabase table with fields such as:

```text
id uuid
project_id uuid
client_id uuid nullable
property_id uuid nullable

drive_file_id text
drive_parent_id text
source_system text
source_message_id text nullable

document_type text
document_subtype text nullable
original_filename text
canonical_filename text

mime_type text
sha256 text
file_size_bytes bigint

version integer
is_current boolean
supersedes_document_id uuid nullable

authority_class text
privacy_class text
verification_status text
approved_use text

source_created_at timestamptz
source_modified_at timestamptz
registered_at timestamptz
registered_by text

metadata jsonb
```

## 5.5 Document authority classes

```text
OFFICIAL_CURRENT
OWNER_RULED_CURRENT
INTERNAL_APPROVED
PROJECT_RECORD
CLIENT_EXECUTED
THIRD_PARTY_REFERENCE
HISTORICAL
SUPERSEDED
```

## 5.6 Privacy classes

```text
PUBLIC_OFFICIAL
INTERNAL_APPROVED
CLIENT_CONFIDENTIAL
RESTRICTED_FINANCE
RESTRICTED_HR
ARCHIVE
EXCLUDE
```

## 5.7 Versioning rule

Example:

```text
Proposal V1 -> superseded
Proposal V2 -> superseded
Proposal V3 -> CURRENT
```

All versions remain available.

Only `is_current=true` may drive a current downstream action unless a workflow explicitly requests history.

## 5.8 Deterministic filenames

Example:

```text
P26-0041_VENDOR_HOMEDEPOT_QUOTE_H1256-471919_V02.pdf
P26-0041_PROPOSAL_CLIENT_V03.pdf
P26-0041_FINAL_MEASURE_V02.pdf
P26-0041_PO_V01.pdf
```

## 5.9 Hermes document experience

Project page shows logical categories, not raw folder navigation.

Hermes queries Supabase and opens Drive files using stored Drive File IDs.

---

# 6. KNOWLEDGE FABRIC

# 6.1 Source architecture

```text
Google Drive Originals
      ↓
Document Registry
      ↓
Hash / Dedupe / Version
      ↓
Extract / Chunk
      ↓
┌──────────────┬────────────────┐
│              │                │
Structured     Semantic         Original
Facts          Retrieval        Evidence
│              │                │
└──────────────┴────────────────┘
      ↓
Preston Capabilities / AI
```

## 6.2 Domains

```text
ANDERSEN_OFFICIAL
LPC_OFFICIAL
LPC_PRECEDENT
PRESTON_SOP
TEMPLATE_LIBRARY
FIELD_OPERATIONS
PRICING_POLICY
ARCHITECTURE_HISTORY
PROJECT_DOCUMENT
```

Restricted domains:

```text
FINANCE_RESTRICTED
HR_RESTRICTED
INSURANCE_RESTRICTED
```

## 6.3 Andersen Knowledge Core

Use the existing Drive Andersen database.

Do not rebuild it from web scraping.

Implement:

- master-index import;
- Drive ID/hash registry;
- source/version metadata;
- cited chunk retrieval;
- structured candidate facts;
- verification workflow;
- owner-curated QA/eval set.

Critical product/order claims require citations.

## 6.4 LPC Knowledge

Combine:

- official LPC documents;
- historic district maps;
- official guidance;
- public precedent;
- Preston approved/revised project packages;
- historical photographs;
- drawings;
- objections and final outcomes.

Create structured precedent records.

## 6.5 AI-extracted facts

State machine:

```text
EXTRACTED_CANDIDATE
    ↓
VERIFIED
    ↓
AUTHORIZED_FOR_USE
```

Quote/order/compliance-critical facts cannot skip verification.

## 6.6 Never create one unrestricted global vector index

Client/project files stay project-scoped.

Restricted finance/HR material is not available to general AI retrieval.

---

# 7. GMAIL AUDIT — ARCHITECTURE FINDINGS

The Gmail audit confirms that email is not just correspondence; it is a structured event stream for the business.

## 7.1 Andersen lead intake is machine-detectable

Repeated Andersen messages include:

- new lead;
- time-sensitive contact reminder;
- lead status reminder;
- program statement;
- product-program updates.

Build deterministic Andersen lead event parsers before browser automation.

## 7.2 Home Depot workflow is highly structured

Observed recurring sequence:

```text
Preston sends pricing request
    ↓
Home Depot Case Submitted #...
    ↓
Home Depot returns H1256-... Quote
    + Specification Sheet
    ↓
revisions / V1 / V2 / Update
    ↓
receipt
    ↓
order/pickup/delivery reminders
```

This is ideal for deterministic ingestion and reconciliation.

Extract:

- project/address;
- Home Depot case number;
- H1256 quote/order number;
- Andersen/IQ+ number;
- revision;
- quote/spec attachment pair;
- delivery/pickup state;
- supplier notes.

## 7.3 Vendor workflows exist beyond Home Depot

Gmail contains alternate supplier quote/lead-time conversations.

Use a provider-neutral `vendor_quote` model.

## 7.4 Google Voice already enters Gmail

Gmail receives:

- text-message notifications;
- missed-call notifications.

Use these as communication events.

Do not ingest authentication/OTP/security codes into model context.

## 7.5 LPC workflow is visible in Gmail

Threads contain:

- property/address;
- docket identifiers;
- official LPC staff responses;
- drawing requirements;
- review attachments;
- building-management communication.

This should feed project timeline + LPC evidence.

## 7.6 DocuSign event stream is usable

Observed event types include:

- sent/review;
- completed;
- voided.

Use verified DocuSign events to update contract state.

Do not infer signature state from ordinary email language when a provider event exists.

## 7.7 Payment/receipt emails are useful but restricted

Observed:

- payment processor correspondence;
- Home Depot receipts;
- expense receipts;
- invoice/payment communication.

These can support finance reconciliation but must be `RESTRICTED_FINANCE`.

Email is evidence, not authorization to charge/refund.

## 7.8 Bounce/failure detection is immediately valuable

Gmail contains delivery failures from invalid addresses.

Create:

```text
communication.delivery_failed
```

and a Deal Intelligence attention item.

No automation should repeatedly send to a bounced address until contact data is corrected.

## 7.9 Commitment extraction is justified by actual business behavior

Observed customer/vendor threads show:

- promised calls;
- requested callbacks;
- scheduling commitments;
- requested updates;
- expected vendor responses;
- payment/invoice clarification;
- delivery/install confirmations.

Deal Intelligence should detect commitments and overdue promises.

## 7.10 Mailbox/alias normalization

Observed business communication across multiple Preston email identities/domains.

Create an alias registry:

```text
mailbox_identity
email_address
role
active
canonical_sender
allowed_send_classes
```

Never let an LLM choose an outbound sender address.

## 7.11 Gmail ingestion classes

### INCLUDE / PROJECT

- customer;
- architect;
- contractor;
- vendor;
- LPC;
- building management;
- Andersen lead;
- quote/order;
- DocuSign project event.

### EVENT-ONLY

- bounce;
- missed call;
- order-ready notification.

### FINANCE-RESTRICTED

- receipts;
- payment processor;
- bank/card;
- insurance billing;
- SaaS invoices.

### DROP FROM AI CONTEXT

- OTP;
- password reset;
- security alerts;
- authentication links;
- promotional noise.

---

# 8. DEAL INTELLIGENCE / TODAY ENGINE

Build after Project ID and communication linking.

## 8.1 Deterministic detectors v1

1. inbound unanswered >48h;
2. first-response lag;
3. quote sent, no follow-up after configured interval;
4. stale quote;
5. stale negotiation;
6. Andersen deadline/reminder breach;
7. orphan communication;
8. explicit commitment due/missed;
9. bounced client/vendor email;
10. vendor quote requested but no return;
11. delivery/order status overdue;
12. client asks for update and no outbound response.

## 8.2 Attention item types

Reuse the best concept from old Open Loops:

```text
OUR_COMMITMENT
WAITING_ON
RISK
OPPORTUNITY
```

## 8.3 Required evidence

Every finding includes:

- project;
- source system;
- source message/event;
- timestamp;
- detector rule;
- supporting evidence;
- confidence;
- suggested next action.

## 8.4 AI role

AI may:

- summarize;
- explain;
- rank;
- draft response;
- identify probable cause.

AI does not silently close or merge project truth.

---

# 9. BUSINESS WORKFLOW / PLAYBOOK MODEL

Use versioned TypeScript playbooks, not a new workflow DSL.

Core playbooks:

```text
lead.intake
deal.intelligence
visit.schedule
visit.recap
vendor.quote_cycle
quote.client
follow_up
contract.proceed
final_measure
order.cycle
order.pending
receiving
install
closeout
dispute
lpc.research
reengagement.batch
```

Every playbook declares:

- trigger;
- required data;
- allowed capabilities;
- deterministic predicates;
- worker use;
- approvals;
- evidence;
- retries;
- exception routes;
- exit condition.

---

# 10. CAPABILITY ARCHITECTURE

## 10.1 Read capabilities

Examples:

```text
gmail.thread.read
gmail.message.search
calendar.availability.read
drive.file.lookup
vendor.quote.parse
iqplus.report.ingest
knowledge.search
```

## 10.2 Internal derived writes

```text
deal.finding.record
timeline.event.record
document.register
project.match.propose
knowledge.fact.propose
```

## 10.3 External preparation

```text
gmail.message.draft
proposal.document.render
po.document.render
calendar.event.draft
contract.package.render
```

## 10.4 External side effects

```text
gmail.message.send
calendar.event.create
drive.file.write
vendor.quote.request.send
docusign.envelope.send
```

## 10.5 High consequence / step-up

```text
payment.charge
payment.refund
vendor.order.place
production.deploy
database.migrate
autonomy.grant
kill_switch.clear
```

Every capability defines:

- schema;
- provenance;
- actor;
- policy;
- approval class;
- validation;
- idempotency;
- side-effect key;
- evidence;
- failure behavior.

---

# 11. APPROVAL MODEL

## INTERNAL

Company-internal derived state only.

May eventually be ChatGPT-confirmable.

## EXTERNAL

Something leaves Preston:

- email;
- calendar invitation;
- vendor request;
- customer communication.

Authenticated approval initially.

## STEP_UP

Money/legal/order/authority actions.

Require stronger owner authentication.

Approval binds to:

```text
actor
action
project_id
exact payload hash
document/version hash
amount where applicable
recipient where applicable
expiry
one-time nonce
```

Stale payload = stale approval = reject.

---

# 12. CHATGPT VOICE / SUPERVISOR MODEL

Target experience:

```text
Owner speaks
  ↓
ChatGPT message/voice transcript
  ↓
Preston query/goal
  ↓
Preston Control
  ↓
workers/business runner
  ↓
events/results
  ↓
ChatGPT explanation
```

Current-safe model:

- ChatGPT actively invokes Preston tools;
- Preston exposes durable event feed;
- owner receives phone notification for attention events;
- ChatGPT consumes cursor-based events when active.

Do not architect around unsupported arbitrary server-to-ChatGPT push.

---

# 13. HERMES v1

Do not build many department dashboards.

Initial high-value views:

## TODAY

- waiting on Preston;
- overdue commitments;
- owner approvals;
- vendor delays;
- failed sends;
- business exceptions.

## PROJECT

Single complete project truth page:

- client/property;
- stage;
- next action;
- communications;
- quotes;
- documents;
- appointments;
- measurements;
- LPC/building;
- payments;
- order;
- delivery;
- install;
- blockers;
- timeline;
- evidence.

## APPROVALS

Read-only list + secure action deep-link.

## AI WORKFORCE

- active Claude/Codex jobs;
- duration;
- result;
- failures;
- evidence.

## INCIDENTS / EVIDENCE

- dead letters;
- security issues;
- failed capabilities;
- rollback evidence.

Pipeline view can follow immediately after these.

---

# 14. PHASED MASTER BUILD ROADMAP

# PHASE 0 — SEAL THE CONTROL FOUNDATION

**Goal:** Stop reopening Preston Control and certify the foundation.

## Must-do only

- worker dependency-resolution contract;
- real simultaneous Claude + Codex proof;
- executor-level kill/stop proof;
- status/event truth reconciliation;
- actor/requested_by/proposer attribution;
- Supervisor event-feed proof;
- artifact retrieval proof;
- backup + restore proof;
- full test suite green;
- freeze RULED / VERIFY / OPEN registers;
- commit this master plan as authoritative architecture.

## Parallel cleanup lane — NON-BLOCKING

- stale docs;
- old reports;
- legacy comments;
- old n8n artifacts;
- superseded lane retirement;
- report hygiene.

## Exit predicate

PASS only when:

- two isolated workers execute concurrently without collision;
- deterministic failures are classified correctly;
- status/event outputs agree;
- final executor honors stop/kill;
- evidence shows actor attribution;
- restore procedure is proven;
- no critical foundation ambiguity remains.

**Complexity:** MEDIUM  
**Business value:** Indirect / foundational  
**Owner gate:** production-affecting proof only where required

---

# PHASE 1 — BUSINESS FOUNDATION

Run four parallel lanes after schema contracts are frozen.

## Lane A — Canonical Identity

- Project ID minter;
- identity confidence state;
- external ID mappings;
- aliases;
- project matching;
- stage/gate model;
- business field-ownership matrix.

## Lane B — Project Document Registry + Drive

- `documents` migration;
- Drive folder binding;
- standard folder template;
- new-project folder creation;
- document classifier;
- version/supersession;
- deterministic filenames;
- active-project pilot;
- Drive inventory metadata.

## Lane C — Knowledge Fabric Foundation

- ingest Andersen master index;
- document registry mapping;
- knowledge schemas;
- hash/dedupe;
- source authority;
- privacy classes;
- LPC official/predecessor registration;
- current-template identification.

## Lane D — Read-Only Gmail + Deal Intelligence

- Gmail importer;
- alias registry;
- communication records;
- deterministic detector suite;
- evidence timeline;
- Today attention items;
- no live sends.

## Phase result

> Preston understands who each project is, where its files are, what communications belong to it, and what needs attention.

## Exit predicate

- Project ID reliably minted;
- ambiguous matches fail closed;
- every pilot document tied to Project ID + Drive ID;
- Andersen corpus inventory imported;
- Gmail source systems remain read-only;
- every Deal Intelligence finding cites evidence;
- zero automatic false merge in gold set.

**Complexity:** VERY HIGH  
**Business value:** VERY HIGH  
**External risk:** LOW

---

# PHASE 2 — OWNER OPERATING INTERFACE

Can overlap late Phase 1.

## Build

- Hermes Today;
- Hermes Project;
- Hermes Approvals;
- Hermes AI Workforce;
- Hermes Evidence/Incidents;
- ChatGPT business/project read operations;
- event-aware owner brief;
- phone notification rules.

## Exit predicate

Owner can answer in <30 seconds:

- What needs my attention?
- What are we waiting on?
- What is running?
- What failed?
- What is blocking Project X?
- Show me Project X's current proposal/contract/vendor quote.

**Complexity:** MEDIUM  
**Business value:** HIGH

---

# PHASE 3 — SAFE BUSINESS CAPABILITY FOUNDATION

## Goal

Turn the existing internal capability architecture into a provider-backed business adapter layer.

## Initial capability set

```text
gmail.message.draft
calendar.event.create
drive.file.write
proposal.document.render
vendor.quote.parse
vendor.quote.reconcile
iqplus.report.ingest
```

If needed:

```text
airtable.record.upsert
```

but only explicit tables/fields.

Implement but keep disabled until gate:

```text
gmail.message.send
```

## Add

- business deterministic runner;
- external event gateway;
- side-effect ledger integration;
- provider identity;
- exact approval hash binding;
- recipient allowlists;
- attachment manifests;
- prompt-injection boundary;
- metadata stripping;
- provider-specific scopes;
- stale approval rejection;
- replay protection;
- kill behavior.

## Exit predicate

Every capability passes:

- schema tests;
- contract tests;
- authorization;
- negative tests;
- idempotency;
- replay;
- sandbox proof;
- kill/disable proof.

No uncontrolled customer/vendor action.

**Complexity:** HIGH

---

# PHASE 4 — SALES AUTOPILOT VERTICAL SLICE

## Goal

Automate the repetitive pre-contract revenue workflow.

## Workflow

```text
LEAD
 ↓
VISIT / MEASURE INPUT
 ↓
NORMALIZED OPENINGS / SCOPE
 ↓
ANDERSEN KNOWLEDGE
 ↓
IQ+ / HOME DEPOT / VENDOR
 ↓
QUOTE / SPEC RECONCILIATION
 ↓
DETERMINISTIC PRICE ENGINE
 ↓
PROPOSAL RENDER
 ↓
OWNER APPROVAL
 ↓
CLIENT SEND
 ↓
FOLLOW-UP CLOCK
```

## Build

### Andersen Knowledge Core v1

Operationalize existing Drive database for:

- series;
- unit type;
- glass;
- grids;
- common hardware;
- common size/availability constraints;
- source provenance.

### Home Depot / Vendor Parser

Use real historical Gmail/Drive quote pairs as fixtures.

Extract:

- case;
- quote/order number;
- revision;
- line items;
- spec fields;
- delivery;
- totals;
- Sold-To / Ship-To;
- warnings.

### Quote Engine v1

Deterministic:

- material;
- labor;
- fees;
- markup;
- tax treatment;
- discounts;
- payment schedule;
- margin;
- assumptions/exclusions.

AI does not author arithmetic.

### Proposal renderer

Structured data -> versioned document registry -> Drive.

### Scheduling minimum

- staff-selected availability;
- Calendar event;
- confirmation;
- selection guide.

### Follow-up

- 24h/48h/weekly rules per current owner register;
- owner final-call rule before Closed Lost.

## Pilot exit target

At minimum:

- 5 vendor quote cycles;
- 3 proposal/client cycles;
- zero client contact leakage;
- zero wrong attachments;
- zero unapproved external sends;
- 100% arithmetic validation;
- every external side effect has evidence.

**Complexity:** VERY HIGH  
**Business value:** VERY HIGH

---

# PHASE 5 — CONTRACT → PAYMENT → FINAL MEASURE → ORDER

## Goal

Create the governed path from accepted proposal to correct manufactured order.

## Contract

- approved template registry;
- DocuSign;
- exact document version;
- required forms;
- signed-status provider validation.

## Payment

Every payment action/state binds:

```text
project_id
contract/quote hash
milestone
amount
```

No model-generated amount becomes authoritative.

Refunds remain owner-only initially.

## Final measurement

Machine predicates:

- no final measure before configured 3-business-day rule;
- final measurement stored/versioned;
- estimate/intake dimensions cannot feed PO;
- configuration/size changes trigger review/change order.

## Compliance/order gate

Order eligibility checks:

- valid signed contract;
- payment condition;
- final measure approved;
- building approval condition;
- LPC condition;
- DOB condition;
- PO hash matches approved measurement/configuration.

Any false predicate = BLOCK.

## Exit predicate

At least one real pilot traverses:

```text
accepted
→ signed
→ payment state
→ final measure
→ compliance gates
→ approved PO
→ order
```

without bypass.

**Complexity:** VERY HIGH  
**Risk:** HIGH

---

# PHASE 6 — INSTALLATION → CLOSEOUT

## Goal

Complete the project lifecycle.

## Build

- receiving;
- delivery;
- damage/remake exception;
- install readiness;
- crew scheduling;
- site access;
- install status;
- field photos;
- punch;
- closeout;
- final payment eligibility;
- warranty registration;
- Andersen program obligations;
- BDF;
- review/survey;
- completion certificate;
- project archive.

## Document system integration

All field/closeout artifacts automatically register under Project ID.

## Exit predicate

One real project closes from delivery through warranty/closeout with complete timeline, documents and evidence.

**Complexity:** HIGH  
**Business value:** HIGH

---

# PHASE 7 — REDUCE HUMAN HANDS / GRADUATED AUTONOMY

Do not create one “autonomous mode.”

Promote classes individually.

## Graduation ladder

```text
CODED
 ↓
TESTED
 ↓
DEPLOYED
 ↓
SHADOW
 ↓
OWNER-APPROVED LIVE
 ↓
CERTIFIED
 ↓
L1 VETO
 ↓
L1 AUTO
```

or equivalent existing Preston levels.

## Good first automatic classes

- internal summaries;
- stale-deal detection;
- internal task creation;
- vendor/order status checks;
- low-risk reminders;
- deterministic filing;
- knowledge indexing;
- daily brief.

## Night Operations

Only after business workflows are stable:

- overnight review;
- safe internal work;
- queued approval preparation;
- morning brief;
- cost budgets;
- timeout budgets.

## Auto-demotion

Critical anomaly -> capability/class automatically drops to safer mode.

**Complexity:** HIGH

---

# PHASE 8 — ADVANCED BUSINESS OS

Independent modules after core spine is stable.

## LPC / DOB Intelligence

- property classification;
- official source retrieval;
- historic photo lookup;
- precedent library;
- drawing/package checklist;
- objection/revision intelligence;
- draft filing support;
- evidence/citations.

## Advanced Estimating

- plan ingestion;
- schedules;
- quantities;
- square footage;
- labor rules;
- material takeoff;
- live price adapters;
- shopping list;
- confidence/evidence.

## Finance Intelligence

- AR;
- project margin;
- profitability;
- vendor exposure;
- cash forecast;
- expense classification.

No unrestricted money execution.

## Routing / workforce

After Calendar/crew data becomes trustworthy.

## Rendering / design

Useful for LPC/customer communication; remains non-authoritative.

---

# PHASE 9 — SCALE / PRODUCTIZATION

Only after Preston Windows & Doors runs reliably on the core system.

- Business Provisioning Engine;
- physical tenant isolation;
- multi-company;
- configurable departments;
- reusable manifests;
- white label;
- additional AI workers;
- customer portal;
- field mobile app.

Not on today's critical path.

---

# 15. PARALLEL BUILD WAVES

## Wave 0

- foundation repair/proof;
- plan freeze.

## Wave 1

Parallel:

```text
A Identity / Project ID
B Documents / Drive
C Knowledge Fabric
D Gmail / Deal Intelligence
```

## Wave 2

Parallel:

```text
Hermes / ChatGPT read UX
Capability-security foundation
Provider adapter interfaces
```

## Wave 3

Parallel:

```text
Andersen Knowledge v1
Home Depot parser
Quote Engine
Proposal Renderer
Calendar/Scheduling
```

## Wave 4

Sequentially governed:

```text
Contract
Payment
Final Measure
Compliance
PO
Order
```

## Wave 5

Parallel within project lifecycle:

```text
Receiving / install
Documents / photos
Warranty / closeout
Finance reconciliation
```

---

# 16. SECURITY / DAMAGE PREVENTION

Must explicitly test:

- wrong project;
- false client merge;
- wrong recipient;
- wrong sender mailbox;
- wrong attachment;
- contact leakage to vendor;
- stale proposal;
- stale contract;
- stale approval;
- stale PO;
- wrong price;
- wrong tax policy;
- wrong payment amount;
- duplicate send;
- duplicate charge;
- wrong final measurement;
- order before gate;
- prompt injection;
- malicious attachment;
- worker compromise;
- runtime compromise;
- duplicate webhook;
- missing/delayed webhook;
- bounce/retry loop;
- concurrency collision;
- partial execution;
- secret exposure.

Every major failure class needs:

```text
prevent
detect
contain
recover
audit
```

---

# 17. TESTING STANDARD

Every work package:

- unit;
- fixture;
- negative;
- authorization;
- evidence.

Business/executor layers:

- idempotency;
- duplicate events;
- retry;
- race/concurrency;
- stale approval;
- version binding;
- kill switch.

External communications:

- recipient;
- sender identity;
- attachment manifest;
- metadata;
- contact leakage;
- bounce handling;
- prompt injection.

Documents:

- version/supersession;
- hash;
- Drive ID;
- access denial;
- project scoping.

Money/order:

- amount binding;
- project binding;
- milestone binding;
- duplicate-event rejection;
- wrong-version rejection.

Knowledge:

- citation accuracy;
- current/superseded behavior;
- refusal when absent;
- restricted-domain denial.

---

# 18. SUCCESS METRICS

## Reliability

- unapproved consequential actions = 0
- duplicate consequential side effects = 0
- contact leaks = 0
- stale approval execution = 0
- high-confidence false Project merge = 0
- wrong-current-document use = 0
- worker collision = 0

## Sales

- first response time
- unanswered >48h
- quote turnaround
- quote follow-up compliance
- quote-to-decision days
- stale deal count
- Andersen lead SLA compliance

## Operations

- visit-to-quote
- vendor turnaround
- order error rate
- unresolved blockers
- receiving exceptions
- install readiness
- closeout aging

## Human effort

- owner minutes/day
- assistant touches/project
- owner approvals/project
- manual data-entry events
- manual file-finding events

## AI / system

- cost per successful outcome
- worker pass rate
- rework rate
- latency
- retrieval citation accuracy
- recovery rate

---

# 19. CURRENT OWNER RULES — MUST NOT BE REOPENED WITHOUT NEW OWNER RULING

Known current rules include:

- installation payment schedule: 50 / 25 / 25;
- product-only payment schedule: 75 / 25;
- final measurement no sooner than 3 business days after signing;
- no PO before final measure;
- PO uses final measured sizes only;
- material changes trigger change-order workflow;
- customer contact must not leak into vendor-facing material;
- Home Depot/IQ+ outputs require reconciliation;
- DocuSign retained;
- consequential execution remains Preston-controlled.

Where a legacy Drive/Gmail document conflicts, mark it historical.

---

# 20. OWNER DECISION MODEL

Do not present dozens of decisions at once.

Group as:

## MUST DECIDE NOW

Only phase-blocking choices.

## RECOMMENDED DEFAULT — OWNER MAY OVERRIDE

Proceed with architect recommendation unless owner objects.

## LATER

Do not ask until the relevant phase.

## VERIFY

External fact; not an owner-policy question.

Examples of VERIFY:

- tax/legal treatment;
- HIC;
- GBL 771-a;
- RRP;
- employee monitoring;
- window guard;
- current LPC/DOB requirements;
- provider/API limits.

---

# 21. WHAT IS DEFERRED

Do not put these on the critical path:

- multi-tenancy;
- white label;
- Business Provisioning Engine;
- generic customer portal;
- full field mobile app;
- Temporal/new orchestrator;
- giant agent ecosystem;
- additional coding workers;
- generic workflow DSL;
- knowledge graph unless justified by retrieval metrics;
- broad browser-agent authority;
- full Hermes write capability.

---

# 22. SUPERSESSION / GOVERNANCE

This plan should become the primary architecture/build-order document after owner acceptance.

It supersedes older architecture/build-order proposals where they conflict.

It does **not** erase:

- historical evidence;
- owner rulings;
- audit reports;
- older source documents.

Precedence remains:

1. explicit current owner ruling;
2. current verified repo/runtime evidence;
3. this master plan;
4. current verified external facts;
5. historical plans;
6. backlog ideas.

---

# 23. FIRST EXECUTION PACKAGE

After owner accepts this document:

## BUILD PACKAGE P0-A

1. fresh live/current Preston status audit;
2. close worker dependency gap;
3. run two-worker concurrency proof;
4. verify executor kill;
5. verify event/status truth;
6. verify actor attribution;
7. verify backup/restore;
8. full tests;
9. commit/freeze this master plan.

## IMMEDIATELY AFTER P0

Launch Wave 1 in parallel:

### Claude lane
- Project ID / canonical identity;
- document registry schema;
- business gate model.

### Codex lane
- Drive inventory/registry tooling;
- Gmail read importer;
- Deal Intelligence deterministic detectors.

### Knowledge lane
- Andersen master-index import;
- source/version/privacy classification.

### UI lane
- Hermes Project/Today contracts against the new schemas.

No live customer sends.
No payment actions.
No order placement.
No production autonomy expansion.

---

# 24. FINAL ACCEPTANCE CRITERIA FOR THE ULTIMATE SYSTEM

When this master program is complete, the owner should be able to:

1. speak/type a business request into ChatGPT;
2. have ChatGPT query/submit through Preston;
3. have Preston safely coordinate workers and deterministic workflows;
4. have every project tied to a canonical Project ID;
5. have every relevant original document discoverable through Supabase/Drive;
6. have Gmail communications linked to the right project;
7. see all current business state in Hermes;
8. receive only meaningful exception/approval notifications;
9. generate/reconcile quotes and proposals;
10. move a signed customer through payment/final-measure/order safely;
11. manage delivery/install/closeout;
12. retrieve cited Andersen/LPC knowledge;
13. run selected low-risk workflows automatically;
14. keep consequential actions owner-controlled;
15. operate the business from an authorized phone/computer without relying on the original development laptop.

---

# 25. FINAL ARCHITECTURAL STATEMENT

The system we are building is not a collection of AI agents.

It is:

> **A governed business operating system in which ChatGPT provides the owner interface, Preston Control owns authority and execution policy, Supabase owns canonical business state, Google Drive preserves organized original documents, a cited Knowledge Fabric supplies verified business/product knowledge, Hermes compresses operations into decisions, and bounded AI/deterministic workers perform the work.**

The fastest realistic path is:

```text
SEAL CONTROL FOUNDATION
        ↓
IDENTITY + DOCUMENTS + KNOWLEDGE + GMAIL
        ↓
TODAY / PROJECT COMMAND CENTER
        ↓
SAFE BUSINESS CAPABILITIES
        ↓
QUOTE / VENDOR / PROPOSAL
        ↓
CONTRACT / PAYMENT / FINAL MEASURE / ORDER
        ↓
INSTALL / CLOSEOUT
        ↓
GRADUATED AUTONOMY
        ↓
LPC / ESTIMATING / FINANCE / SCALE
```

That is the final build sequence recommended for Preston AI OS.

---

# END
