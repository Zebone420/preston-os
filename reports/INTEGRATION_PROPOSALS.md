# INTEGRATION PROPOSALS - reusable legacy work into Preston OS

Date: 2026-07-21. Proposals only; no code was merged; every
proposal carries its own owner gate. Ordered by value/effort.

## P-1. Andersen Knowledge Layer (highest strategic value)

- Business value: searchable, cited Andersen product knowledge
  for quoting support - the master plan's Knowledge Librarian.
- Source assets: preston-ai-andersen-vault (raw docs),
  preston-ai-andersen-graph (ontology), Supabase
  preston-ai-andersen (processed chunks/vectors), WF-1 (ingestion
  design), WF-3 (retrieval design).
- Target: NEW logically-separated knowledge store. Default
  recommendation: a dedicated schema (knowledge.*) or separate
  database inside preston-os-staging's project with pgvector,
  owner-only RLS, provenance columns (source_document,
  page/section, ingest_run, hash) - operational schemas stay
  untouched (ADR required per the Supabase audit).
- Data movement: export paused project (packet D) -> compare with
  vault repo raw docs -> re-ingest through a NEW in-repo ingestion
  path (TS, tested, deterministic chunking per master plan
  500-800 tokens) rather than trusting opaque legacy rows;
  legacy rows kept as verification corpus.
- Required code: knowledge migration (new, gated), ingestion CLI
  (owner-run), retrieval module + read-only research UI page with
  citations, provenance-pinned tests. Simulation-only: the agent
  ANSWERS with citations; it never prices (agent contract
  criterion 18 stands - knowledge display, not price inference).
- Security: no new credentials in browser; vendor-licensed
  documents stay owner-private; licensing review precedes any
  storage in-repo.
- Future: Obsidian human workspace exports from the same store;
  Graphify-style read-only graph view later (master plan already
  reassigned Graphify to pgvector).
- Owner gates: repo exports (B), workflow exports (C), Supabase
  export (D), ADR approval, knowledge migration application.
- Effort: 3-5 engineering days after evidence. Rollback: drop the
  knowledge schema; operational data untouched.

## P-2. Outstanding-deposit recommendations (EXT-3 -> rules)

- Value: proven owner heuristics for chasing deposits, surfaced
  as simulation-only advice.
- Target: extend missing_payment / add deposit_outstanding kind
  in src/lib/business/recommendations.ts with EXT-3's thresholds.
- Movement: none (logic only, from the packet C export). No
  automatic client contact - ever (V1 invariant).
- Tests: rule unit tests mirroring EXT-3 cases. Effort: 0.5-1 day.
  Rollback: remove the rule. Gate: export review only.

## P-3. Open-loop coordination (EXT-4 -> ops exceptions)

- Value: systematic follow-up on stalled quotes, vendor ETAs,
  installs, payments, approvals.
- Target: new recommendation kinds + an "exceptions" grouping on
  /business (the operational_exceptions tile already exists).
- Movement: logic only. Effort: 1-2 days. Gate: export review.

## P-4. Monitoring consolidation (PM-1 -> Mission Control)

- Value: single health surface; no duplicate loops.
- Target: /os + /business/agents posture cards; add ONLY checks
  PM-1 covers that the OS lacks (candidates: n8n reachability,
  Airtable API health, domain/TLS expiry).
- Movement: logic only; checks implemented as read-only probes
  behind the existing fail-closed patterns. Effort: 1 day.
  Gate: export review; any outbound probe added to the RED-scan
  allowance consciously (curl-http tokens - design around the
  scanner by using fetch in app code, which the business layer
  pin bans - so monitoring probes live in the ai-os layer, not
  business/). Rollback: remove checks.

## P-5. Automation admin (read-only n8n inventory first)

- Value: owner sees automation state inside Preston OS without
  holding an API key in a browser.
- Phasing: (1) this audit's static inventory (done); (2) later
  gate: server-side read-only n8n API client behind owner auth +
  env-named key, listing workflows/executions; (3) far gate:
  draft-and-approve changes (n8n/drafts/ convention exists).
- Effort: phase 2 = 1-2 days when approved. Not started now.

Every proposal: preserves provenance, adds tests, keeps
execution/sends disabled, changes nothing outside staging, and
lands through the normal commit + owner-gate process.
