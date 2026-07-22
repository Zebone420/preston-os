# LEGACY ASSET INVENTORY - Preston Platform Consolidation

Date: 2026-07-21. Read-only audit. NOTHING was deleted, disabled,
paused, unpaused, modified, or activated.

Evidence classes used below:
- VERIFIED = directly observed this session (local repo state,
  HTTP reachability checks, local reference sweep).
- OWNER-VERIFIED = evidence the owner supplied (Phase 6 gate,
  Supabase states, server list).
- INFERRED = reasonable conclusion awaiting owner evidence.
Rule honored: no asset is declared unused merely because it has
zero local code references; external dependency checks are gated
on reports/OWNER_EVIDENCE_COLLECTION_PACKET.md.

## Final asset table

| Asset | Type | State | Purpose | Last Verified Use | Dependencies | Unique Value | Security Risk | Monthly Cost | Recommendation | Confidence | Owner Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Zebone420/preston-os | GitHub repo | active, pushed @ e0609d3 | Preston OS platform (authoritative) | today (VERIFIED) | Vercel staging, Supabase staging, staging host | entire platform | low (private; scanners clean) | $0 | RETAIN | high | none |
| Zebone420/preston-ai-andersen-graph | GitHub repo | not publicly accessible (404 VERIFIED today; private or renamed) | Andersen product graph/ontology (INFERRED from name + Gate 0A note) | unknown | possibly WF-1/WF-3, Supabase preston-ai-andersen (INFERRED) | graph schema, compatibility logic (potential) | low if private | $0 | INVESTIGATE -> ARCHIVE after export | medium | packet item B |
| Zebone420/preston-ai-andersen-vault | GitHub repo | not publicly accessible (404 VERIFIED) | Andersen source documents/chunks (INFERRED) | unknown | possibly Supabase preston-ai-andersen, WF-1 (INFERRED) | vendor knowledge corpus (potential; licensing unknown) | medium (if docs are licensed/restricted) | $0 | INVESTIGATE -> ARCHIVE after export + licensing review | medium | packet item B |
| n8n instance automation.prestonwd.com | n8n service | reachable, serving n8n UI (VERIFIED today); auth state at UI level unverified | legacy automation hub | today (reachability only) | gmail-dev-n8n host (INFERRED), DNS prestonwd.com, 7 workflows, credentials stored in n8n | workflow logic below | MEDIUM: public internet exposure of an automation console; patch level unknown | in server cost | RETAIN short-term; harden; re-decide after export | high (reachability) | packet items C+E |
| PM-1 Program Manager Health Monitor v1 | n8n workflow | unknown active state | health monitoring (INFERRED from name) | unknown | n8n credentials, targets unknown | monitoring checks possibly absent from OS | unknown | - | INVESTIGATE -> INTEGRATE unique checks -> ARCHIVE | low | packet item C |
| EXT-4 Open Loop Coordinator v1 | n8n workflow | unknown | open-loop/follow-up coordination (INFERRED) | unknown | unknown (Airtable/Gmail likely) | follow-up business logic | unknown | - | INVESTIGATE -> INTEGRATE -> ARCHIVE | low | packet item C |
| EXT-3 Outstanding Deposit Detector v1 | n8n workflow | unknown | deposit follow-up detection (INFERRED) | unknown | unknown (Airtable likely) | deposit rules; OS already re-implemented a first missing_payment rule | unknown | - | INVESTIGATE -> INTEGRATE -> ARCHIVE | low | packet item C |
| WF-1_ANDERSEN_INDEX_INGEST | n8n workflow | unknown | Andersen document ingestion/indexing (INFERRED) | unknown | Supabase preston-ai-andersen + vault repo (INFERRED) | ingestion pipeline design | unknown | - | INVESTIGATE -> INTEGRATE into knowledge layer | low | packet item C |
| WF-3_ANDERSEN_ASK_MVP | n8n workflow | unknown | Andersen retrieval/Q&A MVP (INFERRED) | unknown | same as WF-1 + an LLM API (INFERRED) | retrieval architecture | unknown | - | INVESTIGATE -> INTEGRATE (read-only research agent) | low | packet item C |
| Andersen KB Read Test | n8n workflow | unknown | KB read smoke test (INFERRED) | unknown | Andersen KB | none beyond evidence | unknown | - | ARCHIVE after export (deletion candidate later) | medium | packet item C |
| "My workflow" | n8n workflow | unknown | default-named scratch workflow (INFERRED) | unknown | unknown | probably none | unknown | - | INVESTIGATE -> DELETE CANDIDATE after execution-history review | low | packet item C |
| Supabase preston-ai-andersen | Supabase project | paused (OWNER-VERIFIED), us-west-2 | Andersen knowledge store (INFERRED: docs/chunks/vectors) | unknown | WF-1/WF-3, andersen repos (INFERRED) | possibly the only copy of processed chunks/embeddings | low while paused | likely $0 paused (UNKNOWN plan) | RETAIN PAUSED -> export -> MIGRATE knowledge -> then delete candidate | medium | packet item D |
| Supabase preston-ai-pathc-dev | Supabase project | paused (OWNER-VERIFIED), us-west-2 | unknown; name likely a typo (patch-dev? path-c?) | unknown | none found anywhere locally | unknown until inspected | low while paused | likely $0 paused (UNKNOWN) | INVESTIGATE -> strongest Supabase DELETE CANDIDATE after export + no-dependency proof | medium | packet item D |
| Supabase preston-os-staging | Supabase project | active nano, us-east-1 (OWNER-VERIFIED) | authoritative staging DB | today (Phase 6 gate) | Vercel app, staging host runtime | operational system of record | managed (owner-only RLS) | UNKNOWN (free/nano tier?) | RETAIN | high | none |
| Hetzner preston-agent-staging (168.119.153.173) | server CPX22 | active (OWNER-VERIFIED; Phase 5 proven) | staging runtime host (worker/Hermes timers) | Phase 5/6 drills | preston-os repo, Supabase staging | proven remote-live infra | managed | est. EUR 7-9/mo (ESTIMATE) | RETAIN | high | packet item E (baseline snapshot of services) |
| Hetzner gmail-dev-n8n (188.245.80.146) | server CPX22 | active (OWNER-VERIFIED) | hosts automation.prestonwd.com n8n (INFERRED from name + reachability; DNS unconfirmed) | today (n8n reachable) | n8n instance + its DB/volumes; DNS; possibly Gmail-dev remnants | the n8n runtime + workflow data | MEDIUM (public console; "dev" era config; patch level unknown) | est. EUR 7-9/mo (ESTIMATE) | RETAIN short-term -> harden/rename; CONSOLIDATE decision after export | medium | packet item E |
| Hetzner ubuntu-4gb-fsn1-2 (159.69.118.154) | server CPX22 | active (OWNER-VERIFIED) | UNKNOWN (default hostname = never purposed or forgotten) | unknown | unknown until inspected | unknown | MEDIUM-HIGH (unknown services on public IP) | est. EUR 7-9/mo (ESTIMATE) | INVESTIGATE -> strongest server DELETE CANDIDATE (snapshot + quarantine first) | medium | packet item E |
| Domain prestonwd.com (+ automation subdomain) | domain/DNS | active (serves n8n subdomain - VERIFIED) | legacy business domain; V8 ruling pending | today | n8n instance DNS | brand + automation endpoint | low | est. USD 10-25/yr (ESTIMATE) | RETAIN until n8n decision + V8 ruling | high | packet item F |
| Domain/identity preston.nyc | domain + owner email | active as owner identity (info@preston.nyc in allowlists) | owner login identity across OS | today | Supabase auth, allowlists | identity anchor | low | UNKNOWN | RETAIN | high | none |
| Airtable "PRESTON ACTIVE - AI/N8N TEST" base | Airtable base | connected read-only (Phase 1B) | TEST/DEV data source for dashboard cards | Phase 6 validation | dashboard cards via env PAT | test data | low (read-only PAT) | in Airtable plan (UNKNOWN) | RETAIN | high | none |

## Disposition summary

RETAIN: preston-os, preston-os-staging (Supabase), preston-agent-
staging, preston.nyc identity, Airtable TEST base, prestonwd.com
(until dependencies clear), n8n instance (short-term, hardened).
INVESTIGATE (evidence-gated): both Andersen repos, all 7 n8n
workflows, both paused Supabase projects, ubuntu-4gb-fsn1-2,
gmail-dev-n8n consolidation decision.
INTEGRATE (proposals written): EXT-3, EXT-4, PM-1 unique checks,
WF-1/WF-3 + Andersen knowledge assets.
ARCHIVE (after export): Andersen repos (GitHub archive flag),
Andersen KB Read Test.
DELETE CANDIDATE (only after the full retirement lifecycle):
"My workflow", Supabase preston-ai-pathc-dev, Supabase
preston-ai-andersen (post-migration), ubuntu-4gb-fsn1-2.
Nothing is owner-approved-deletion. Nothing was deleted.

## Local-dependency ground truth (VERIFIED by repo sweep)

Zero local functional dependencies exist on: Andersen repos,
the n8n instance or any workflow name/URL, either paused Supabase
project, either legacy Hetzner host or any of the three IPs,
automation.prestonwd.com, or legacy Gmail automation. Full
citations: the sweep results embedded in
reports/CROSS_SYSTEM_DEPENDENCY_MAP.md. This proves the ACTIVE
platform will not break; it does NOT prove the legacy assets are
unused by each other - that is what the owner evidence packet
establishes.
