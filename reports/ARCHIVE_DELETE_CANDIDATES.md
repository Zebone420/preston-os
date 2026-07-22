# ARCHIVE AND DELETE CANDIDATES

Date: 2026-07-21. NOTHING here is owner-approved deletion.
Every candidate is CONDITIONAL on the evidence packet returning
clean and on the retirement lifecycle (inventory -> export ->
snapshot -> archive -> pause/disable -> 14-30 day quarantine ->
dependency verification -> owner approval -> delete -> revoke
credentials -> update register). The deletion-safety rule: an
adversarial re-audit runs AFTER evidence returns and BEFORE any
owner approval text is signed; no candidate below has passed
that yet.

## Archive candidates (keep, frozen)

| Asset | Reason | Preconditions |
|---|---|---|
| preston-ai-andersen-graph repo | history/provenance value; content integrates via P-1 | owner export (B); secret sweep; GitHub archive flag |
| preston-ai-andersen-vault repo | raw-source archive of vendor docs | export (B); licensing review; stays private+archived |
| Andersen KB Read Test workflow | evidence only | export (C) |
| PM-1 / EXT-3 / EXT-4 / WF-1 / WF-3 workflows | after their logic integrates (P-1..P-4) | exports (C); integration merged; owner confirms parity |

## Delete candidates (evidence-gated)

1. Hetzner ubuntu-4gb-fsn1-2 - STRONGEST server candidate.
   Evidence so far: zero local references (VERIFIED); default
   hostname; unknown purpose. Required before approval: packet E
   full enumeration; packet F DNS proof nothing resolves to
   159.69.118.154; data/repo export; full snapshot; power-off
   quarantine 14-30 days; then owner approval text (in
   ASSET_RETIREMENT_OWNER_PACKET.md). Savings ~EUR 7-9/mo (EST).
   Rollback: snapshot restore.
2. Supabase preston-ai-pathc-dev - STRONGEST database candidate.
   Evidence so far: zero references anywhere local (VERIFIED);
   paused; name likely typo. Required: packet D metadata; export
   backup regardless of apparent emptiness; owner states origin;
   quarantine = stays paused 14-30 days post-export; then
   approval. Savings ~0 cash; risk reduction. Rollback: restore
   from export into a new project.
3. n8n "My workflow" - after packet C shows no executions/
   credentials. Rollback: re-import exported JSON.
4. Supabase preston-ai-andersen - ONLY after P-1 migration
   verifies the knowledge layer reproduces or supersedes its
   contents (row counts + spot-check parity). Until then: RETAIN
   PAUSED. Rollback: restore from export.
5. gmail-dev-n8n server - LAST, and only under consolidation
   option (b): after all workflow logic integrates, the n8n
   instance is exported+snapshotted, DNS is unpointed, and a full
   quarantine passes. Not a candidate while
   automation.prestonwd.com serves from it.

## Explicit non-candidates

preston-os repo; preston-os-staging (Supabase + Vercel);
preston-agent-staging; preston.nyc identity; Airtable TEST base;
prestonwd.com domain (until n8n decision + V8 ruling).

## Deletion order (when all gates pass)

My workflow -> preston-ai-pathc-dev -> ubuntu-4gb-fsn1-2 ->
(after P-1) preston-ai-andersen -> (after option b) gmail-dev-n8n
+ its credentials. Credential revocation rides with each step.
