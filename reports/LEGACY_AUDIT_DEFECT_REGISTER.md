# LEGACY AUDIT DEFECT REGISTER

Date: 2026-07-21. Findings from the platform-consolidation audit
cycle (repo reconciliation, local sweep, external reachability
checks, document suite authoring). Severity reflects risk to the
business, not to the staging app (which this audit did not
change).

| # | Sev | Finding | Evidence class | Disposition |
|---|-----|---------|----------------|-------------|
| LA-1 | MEDIUM-HIGH | n8n console publicly reachable at automation.prestonwd.com; version/patch/auth posture unknown; its credential store is a single point of compromise for every connected legacy system | VERIFIED (reachability) + UNKNOWN (posture) | OPEN - hygiene plan S1; owner packet items C (version) + hardening steps after export; highest-priority owner security item from this audit |
| LA-2 | MEDIUM | ubuntu-4gb-fsn1-2: unknown services on a public IP, default hostname, no known maintenance | OWNER-VERIFIED existence; UNKNOWN content | OPEN - packet E enumeration; strongest retirement candidate |
| LA-3 | MEDIUM | Paused Supabase retention CONFIRMED (owner evidence 2026-07-21): resume deadlines 28 Sep 2026 (preston-ai-andersen) and 23 Sep 2026 (preston-ai-pathc-dev); dashboard states data remains downloadable after, but exports REQUIRE UNPAUSE (owner gate). Sizes invisible while paused | OWNER-VERIFIED banners | OPEN - schedule the unpause+export owner gate before early Sep 2026; do not let the resume window lapse untested |
| LA-4 | LOW-MEDIUM | Andersen vault repo may contain vendor-licensed documents and/or committed secrets | INFERRED (data-repo pattern) | OPEN - packet B export + scanner sweep + licensing review before any reuse |
| LA-5 | LOW | Gate 0A open item "decide repo visibility" appears completed (both repos 404 anonymously) but private-vs-deleted is unconfirmed | VERIFIED 404 | OPEN - packet B confirms; if DELETED, escalates the data-recovery question to packet D urgency |
| LA-6 | LOW | NEXT_GATES.md referenced two packet files before they existed (dangling references) | VERIFIED | RESOLVED this commit - both files now exist |
| LA-7 | LOW | N8N_API_KEY placeholder exists in env.template with no consumer code | VERIFIED | RETAINED intentionally (documented; do not provision until the automation-admin gate) |
| LA-8 | INFO | Legacy workflow names/webhooks have zero local references - the active platform is fully decoupled from the legacy estate | VERIFIED sweep | Recorded in dependency map; supports (but does not complete) retirement safety |
| LA-9 | INFO | prestonwd.com vs preston.nyc primary-domain ruling (V8) still pending; retirement of either domain is blocked on it | VERIFIED (register) | OPEN - fold into the V5-V8 verification session |
| LA-10 | MEDIUM | preston-os-staging (AUTHORITATIVE staging DB, 27.83 MB) has NO backups - "Last Backup: No backups.", Free Plan excludes scheduled backups. Accidental deletion/corruption of business records, approvals, and audit trail would be unrecoverable | OWNER-VERIFIED 2026-07-21 | OPEN - owner options packet with the audit results: (a) periodic owner-run manual export (documented cadence), (b) plan upgrade for scheduled backups, (c) owner-run pg_dump runbook from the staging host. No change made; decision is the owner's |

Unresolved CRITICAL: 0. Unresolved HIGH: 0 (LA-1 is medium-high
pending version evidence; it becomes HIGH if packet C reveals an
outdated n8n or weak auth). All OPEN items are owner-evidence
gates, not engineering defects.
