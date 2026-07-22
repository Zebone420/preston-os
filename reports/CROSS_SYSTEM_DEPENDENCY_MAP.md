# CROSS-SYSTEM DEPENDENCY MAP

Date: 2026-07-21. Edges are labeled VERIFIED (observed this
session), OWNER-VERIFIED (owner evidence), or INFERRED (needs the
owner evidence packet). "No edge found" means no local reference
exists - it never by itself proves independence.

## Active platform (all edges load-bearing)

- preston-os repo -> Vercel staging app
  (preston-os-staging.vercel.app): OWNER-VERIFIED (V0 gate) +
  VERIFIED (scripts/verify_stage4_owner_login.ps1 hardcodes the
  URL).
- preston-os repo -> Supabase preston-os-staging: OWNER-VERIFIED
  (migrations 0001-0006, 0009 applied; V0-V7 gate) - via
  NEXT_PUBLIC_SUPABASE_* env (names only in repo).
- Vercel staging -> Supabase preston-os-staging: OWNER-VERIFIED
  (connected mode badge, gate PASS).
- preston-agent-staging host -> preston-os repo (built dispatcher
  from pinned commit) + Supabase staging (runtime identity):
  OWNER-VERIFIED (Phase 5 drills). Deploy files are host-agnostic
  (VERIFIED); the host is named only in owner runbooks.
- Dashboard -> Airtable TEST base (read-only PAT, env names
  only): OWNER-VERIFIED (Phase 1B Stage 6, Phase 6 cards).
- Dashboard -> Google (read-only Gmail/Calendar, flag-gated):
  OWNER-VERIFIED (Phase 1B).
- Owner identity info@preston.nyc -> Supabase auth + allowlists:
  VERIFIED in code/tests. Retiring preston.nyc EMAIL would break
  login; the web/DNS side of preston.nyc has no repo dependency.
- Telegram bot (dormant) -> /api/telegram route: coded, disabled
  by default; no live binding (VERIFIED code state).

## Legacy graph (to confirm via owner evidence)

- prestonwd.com DNS -> automation.prestonwd.com -> n8n UI:
  VERIFIED reachable today (serves the n8n SPA title).
- automation.prestonwd.com -> gmail-dev-n8n (188.245.80.146):
  INFERRED from hostname; confirm with DNS A-record (packet F).
- n8n instance -> 7 workflows: OWNER-VERIFIED list; per-workflow
  active state, triggers, webhooks: UNKNOWN (packet C export).
- WF-1/WF-3/KB Read Test -> Supabase preston-ai-andersen:
  INFERRED from names; confirm via workflow export node configs
  (packet C) + Supabase table listing (packet D).
- WF-1 -> preston-ai-andersen-vault repo (source docs): INFERRED;
  confirm via export.
- preston-ai-andersen-graph repo -> graph schema consumed by
  WF-3 or a visualization: INFERRED; confirm via repo export
  (packet B).
- EXT-3/EXT-4/PM-1 -> Airtable production base and/or Gmail:
  INFERRED from business purpose; confirm via export. IMPORTANT:
  these may WRITE or SEND - until exports prove otherwise, treat
  any active legacy workflow as potentially messaging-capable
  (reason to review before any unpause/re-enable, and reason the
  OS forbids n8n activation).
- ubuntu-4gb-fsn1-2 -> anything: UNKNOWN. No local reference, no
  DNS knowledge, no service list. Highest uncertainty node.
- Supabase preston-ai-pathc-dev -> anything: no local reference;
  no known workflow reference; purpose unknown.

## Anti-dependencies (VERIFIED by local sweep, full citations)

The active repo contains ZERO functional references to: the three
legacy IPs, gmail-dev-n8n, ubuntu-4gb-fsn1-2, automation
.prestonwd.com, any n8n workflow name or webhook, N8N_API_KEY
consumers (env placeholder only, read by no code), Supabase
preston-ai-andersen or preston-ai-pathc-dev, any 20-char Supabase
ref, Andersen data (a structural test PINS the absence of
Andersen references in business code), Graphify (master plan
explicitly reassigned it to future Supabase pgvector), Obsidian
content, or legacy Gmail automation. n8n references in code exist
only as guards that BLOCK activation (DISABLE_N8N_ACTIVATION,
assertNoN8nActivation, RED scanner "active": true pattern).

## Unused-declaration checklist state

| Check | Status |
|---|---|
| Local code references | DONE (sweep, this session) |
| DNS records | PENDING owner (packet F) |
| Webhook endpoints | PENDING owner (packet C) |
| Workflow execution history | PENDING owner (packet C) |
| Database references (paused projects) | PENDING owner (packet D) |
| Storage references | PENDING owner (packet D) |
| Server process lists | PENDING owner (packet E) |
| Owner confirmation | PENDING (retirement packet sign-off) |

No asset may move from DELETE CANDIDATE to owner-approved
deletion until every row above is DONE for that asset.
