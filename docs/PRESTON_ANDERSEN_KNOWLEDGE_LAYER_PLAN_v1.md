# PRESTON ANDERSEN KNOWLEDGE LAYER - EXECUTION PLAN v2
# (documentation only - nothing here is implemented yet)

Date: 2026-07-21 (v2 - implementation-ready for gates G2-G3 once
Sessions A/B evidence and the paused-project export return).
Status: DESIGNED (not coded, not tested, not deployed).
Implements integration proposal P-1. v2 adds: source authority
hierarchy, the draft ADR text for G2, data classification,
access/tenant boundaries, backup-before-migration requirement,
and legacy shutdown dependencies.

## 1. Purpose

A read-only, cited Andersen product knowledge layer inside
Preston OS: the owner (and later the quote workflow) can ask
product questions and get answers WITH CITATIONS to vendor
documents - never invented specifications, never pricing
inference (agent-contract criterion 18 remains binding).

## 2. Source inventory (to finalize from evidence)

| Source | Expected content | Authority |
|---|---|---|
| preston-ai-andersen-vault repo | raw vendor documents (PDF/text), possibly chunk outputs | RAW source of truth |
| preston-ai-andersen Supabase | processed chunks, embeddings, maybe entity tables | legacy PROCESSED copy (verification corpus) |
| preston-ai-andersen-graph repo | ontology: product lines, series, components, compatibility relations | schema donor |
| WF-1 export | ingestion pipeline design (chunking, embedding model, destinations) | design reference |
| WF-3 export | retrieval + answering design (query shape, prompt, model) | design reference |
| Owner knowledge | which product lines matter now | scoping authority |

Source AUTHORITY HIERARCHY (conflicts resolve downward):
1. Owner rulings (scope, product lines, corrections).
2. Vault raw vendor documents (ground truth for content).
3. Graph repo ontology (structure - adapted, not copied blind).
4. Legacy Supabase processed rows (verification corpus only;
   never authoritative over raw documents).
5. WF-1/WF-3 exports (design reference only - their parameters
   inform, never dictate, the new pipeline).

## 3. Document provenance model

Every stored artifact carries: source_document (filename + hash),
source_repo/location, page/section locator, ingest_run_id,
ingested_at, chunker_version, embedding_model + dimensions,
license_class (vendor_confidential default). Provenance is
NON-OPTIONAL: a chunk without full provenance fails ingestion
(fail-closed, matching OS idiom).

## 4. Ontology and relationship model (from graph repo, adapted)

Entities (candidate, to reconcile with the graph repo's actual
schema): product_line, series, product, component, option,
size_constraint, compatibility_rule, document, document_chunk.
Relations: product BELONGS_TO series/line; option APPLIES_TO
product; compatibility_rule LINKS product/option pairs with
allow/deny + source citation; chunk CITES document. Rules carry
provenance to the exact document location - a compatibility
answer without a citation is invalid by construction.

## 5. Storage design

Dedicated knowledge schema, logically separated from operational
schemas (ADR at build gate decides: separate schema inside the
staging project vs a dedicated knowledge project). pgvector for
embeddings. Owner-only RLS via the existing is_owner() pattern;
no anon; no service-role in app code. Vendor documents themselves
stay OUTSIDE the repo and outside public buckets (private storage
bucket or owner archive; license_class enforced at upload).

## 6. Ingestion design (in-repo, replacing WF-1's opaque path)

Owner-run CLI (in-repo TypeScript, tested): inventory -> hash ->
dedupe -> chunk (500-800 tokens per master plan, deterministic
chunker, versioned) -> embed (model pinned + recorded) -> upsert
with provenance -> ingest_run report (counts, skips, failures).
Idempotent by (document hash, chunker_version): re-runs skip
unchanged documents. Duplicate handling: same-hash documents from
different sources record BOTH provenances on one artifact.
Legacy Supabase rows are NOT bulk-imported; they serve as a
verification corpus (spot-check parity) unless evidence shows
re-ingestion is impossible (missing raw docs) - then a one-time
audited import path with provenance backfill is designed
separately.

## 7. Versioning and product-line history

Documents supersede by (product_line, document_type, edition):
newer editions mark older ones superseded_by (never deleted -
historical quotes may reference old specs). Chunker or embedding
upgrades create a new ingest generation; retrieval pins to the
newest COMPLETE generation; old generations are droppable only
after parity checks.

## 8. Retrieval and question answering (read-only)

Retrieval: vector similarity + metadata filters (product_line,
document_type, superseded=false), top-k with per-document caps.
Answering: LLM answers ONLY from retrieved chunks; every claim
cites (document, page/section); "not found in the indexed
documents" is the mandated fallback; NO pricing math, NO
configuration invention (structural test will pin that the
answer path cannot reach the quote engine's inputs). UI: a
read-only research page in the dashboard (owner-gated like every
other page) showing answer + citations + retrieval trace.

## 9. Evaluation plan

A fixed owner-curated QA set (20-50 questions with known answers
+ citations) run before first release and on every generation
change: measures citation accuracy (target: 100% of claims
cited), answer correctness (owner-judged), and refusal
correctness on 5+ out-of-corpus questions (must refuse). Results
archived per run.

## 10. Access control and retention

Owner-only end to end (RLS + page gating). Vendor documents:
license_class vendor_confidential, never redistributed, never in
client-facing output without an owner decision per artifact.
Retention: knowledge artifacts retained indefinitely; raw legacy
exports retained permanently as the pre-migration archive.

## 11. Migration gates (owner-run, in order)

G1: evidence packet V2 returns (exports + clones).
G2: ADR approved (schema location, embedding model, scope).
G3: knowledge migration authored + statically tested (Claude),
    applied by owner to staging.
G4: ingestion dry-run on a 3-5 document sample; owner reviews
    the run report + spot-checks citations.
G5: full ingestion (owner-run CLI); evaluation set passes.
G6: parity check vs legacy Supabase corpus (section 12).
G7: only after G6: preston-ai-andersen moves to its retirement
    row (R4) in the retirement packet.

## 12. Parity criteria (gates legacy deletion)

- Document count: every legacy document identified in the paused
  project is present (or explicitly excluded with a reason) in
  the new layer.
- Spot-check: N=20 random legacy chunks findable via new
  retrieval with equal-or-better citations.
- The evaluation set (section 9) passes on the new layer.
- Owner signs the parity statement in the backup register.

## 13. Rollback criteria

Any of: citation accuracy below target, evaluation regressions,
provenance gaps discovered, storage/cost surprise. Rollback =
drop the knowledge schema/generation (operational schemas are
untouched by design); legacy exports and the paused project (if
not yet retired) remain intact. Nothing in this plan can affect
quotes, approvals, execution flags, or any external system.

## 15. Draft ADR for gate G2 (ready for owner approval)

DECISION: where does the knowledge store live?
- Option A (RECOMMENDED): a dedicated `knowledge` schema inside
  the preston-os-staging Supabase project. Pros: one project to
  operate/back up (LA-10 remediation covers it), the owner RLS
  machinery (is_owner) is already there, zero new billing, staging
  isolation preserved by schema separation + migration-gated DDL.
  Cons: shares the 500 MB free-tier budget (current usage 27.83
  MB; embeddings for a few hundred documents fit comfortably -
  re-check at G4 with real document counts).
- Option B: a dedicated Supabase knowledge project. Pros: hard
  blast-radius separation, independent lifecycle. Cons: second
  project to secure/back up/pay for, duplicated auth setup, the
  exact orphaned-project pattern this consolidation program is
  retiring.
ADR RECOMMENDATION: Option A, revisited only if G4 shows the
corpus exceeding ~250 MB projected. Approval line for the owner:
"OWNER APPROVES knowledge schema in preston-os-staging (Option A)
- date ____".

## 16. Data classification and boundaries

Classes: vendor_confidential (Andersen documents/chunks - never
client-facing, never redistributed, never in the repo),
owner_internal (ontology, provenance, eval sets - repo-safe),
operational (nothing - the knowledge layer never stores client or
quote data; the boundary is one-way: quote surfaces may READ
knowledge answers later via an owner-gated feature, knowledge
never reads business tables). Access: owner-only end to end
(is_owner RLS + page gating); single-tenant by design - any
future staff access is a new gate with new roles, not a widening
of this layer.

## 17. Backup-before-migration requirement (hard gate input)

G3 cannot start until: (a) the paused-project export exists
(decision brief; execute by 2026-08-15), (b) both repo clones
exist (Session A), (c) the staging first manual export exists
(LA-10 brief step 2 - because Option A lands the schema inside
staging, staging must have a restore point BEFORE the knowledge
migration is applied). These are exactly the backup-register rows
marked for this plan.

## 18. Legacy shutdown dependencies (what this plan unblocks)

Completion of G6 parity is the SOLE unlock for retiring Supabase
preston-ai-andersen (retirement packet R4). Archiving WF-1/WF-3
in n8n follows owner confirmation that the in-repo ingestion +
retrieval supersede them (roadmap W3->W4). Nothing else may be
retired on this plan's account.

## 14. Explicit non-goals for v1

No automatic quote integration, no client-facing output, no
write-back to vendor systems, no Graphify UI (a read-only graph
view is a later increment on the same schema), no Obsidian sync
(a later export target), no production deployment.
