# SUPABASE PROJECT AUDIT

Date: 2026-07-21. Read-only. No project was unpaused; no SQL was
run; nothing changed. Paused-project internals are UNKNOWN by
design - the packet D evidence uses dashboard metadata only,
which does NOT require unpausing.

## 1. preston-os-staging - RETAIN (authoritative staging)

- Region us-east-1, active, nano compute (OWNER-VERIFIED).
- Purpose: operational system of record for Preston OS staging.
- Schema: 24 applied tables from migrations 0001-0006 + 18
  business tables from 0009 (owner-applied, verification passed);
  owner-only RLS everywhere; anon zero-privilege on business
  tables; auth: single owner user info@preston.nyc + dormant
  runtime identities. VERIFIED against repo migrations + owner
  verification outputs.
- Dependencies: Vercel staging app, staging host runtime,
  Phase 6 Business Command Center. Load-bearing.
- Cost: plan/tier UNKNOWN (nano compute suggests free or entry
  paid tier - packet F captures billing).
- Rule going forward (ADR): knowledge-layer data (Andersen
  documents/vectors) does NOT enter the operational schemas
  without a dedicated ADR + migration gate; if migrated here it
  lands in a separate schema (e.g. knowledge.*) with its own RLS.

## 2. preston-ai-andersen - RETAIN PAUSED, then MIGRATE -> retire

- Region us-west-2, paused (OWNER-VERIFIED). Internals UNKNOWN.
- Expected content (INFERRED from name + WF-1/WF-3): Andersen
  document rows, chunks, embeddings (pgvector), maybe entity/
  relationship tables mirroring the graph repo.
- Zero local references in preston-os (VERIFIED). Expected
  externals: WF-1/WF-3 node configs (packet C confirms).
- Risk while paused: LOW (unreachable). Data-loss risk: paused
  free-tier projects can be subject to provider retention
  policies - packet D asks the owner to capture the dashboard's
  stated status/retention warnings and take a BACKUP EXPORT
  before any other decision. This is the audit's most
  time-sensitive item.
- Disposition: RETAIN PAUSED -> owner export/backup (packet D)
  -> knowledge-layer migration decision (proposal 1) -> only
  then DELETE CANDIDATE via the retirement packet.

## 3. preston-ai-pathc-dev - INVESTIGATE, strongest DB deletion candidate

- Region us-west-2, paused (OWNER-VERIFIED). Internals UNKNOWN.
- Name: likely a typo ("patch-dev" or "path-c"); no local
  reference of any spelling exists (VERIFIED; the only "pathc"
  hits locally are unrelated pathCheck code symbols).
- No known workflow, repo, or doc references it. Purpose UNKNOWN.
- Disposition: packet D captures its table list + sizes from the
  dashboard (metadata visible without unpause). If it is empty or
  trivially reproducible -> DELETE CANDIDATE after export and the
  14-30 day quarantine. If it holds real data -> re-classify.
  Per the mission rule, "no references" alone is insufficient -
  the deletion path requires the packet evidence + owner
  confirmation of origin.

## Packet D scope (owner, dashboard-only, no unpause, no SQL)

For each paused project: overview page screenshot-level facts -
paused-since date, plan, database size, storage size, table
count/list if shown, extensions list if shown (pgvector?), edge
functions count, storage buckets, auth user count, any retention
warning banner. For preston-os-staging: plan/tier + backup
setting. Secrets to redact: none of the above are secrets; do NOT
capture API keys pages.
