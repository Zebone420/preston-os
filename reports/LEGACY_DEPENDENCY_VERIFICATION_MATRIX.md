# LEGACY DEPENDENCY VERIFICATION MATRIX

Date: 2026-07-21. One row per verification dimension per asset.
Status values: DONE (evidence archived), PENDING-<packet item>,
N/A. No disposition may advance to executable retirement while
any of its rows is PENDING. Local-code checks were completed by
the repo sweep (commit acb1a1d evidence).

Legend: P2=repos, P3=n8n, P4=servers(SSH), P5=DNS, P6=billing,
P7=credentials - item numbers in
reports/OWNER_EVIDENCE_COLLECTION_PACKET_V2.md
(P1=Supabase metadata/export).

## Andersen repos (graph, vault)

| Dimension | Status |
|---|---|
| Local code references | DONE (zero functional) |
| Repo existence/state | PENDING-P2 (404 anonymously VERIFIED) |
| Contents, schema, secrets | PENDING-P2 (clone + scanner sweep) |
| Licensing (vault) | PENDING-P2 review |
| Reusable value | PENDING-P2 (expected: ontology, ingestion) |
| Backup completeness | PENDING-P2 (clone = backup) |
| Credential dependencies | PENDING-P2 sweep |
| Cost | DONE ($0) |

## n8n instance + 7 workflows

| Dimension | Status |
|---|---|
| Local code references | DONE (zero; guards only) |
| Instance reachability | DONE (serving n8n UI) |
| Version/patch posture | PENDING-P3a |
| Active states / triggers / schedules | PENDING-P3c |
| Inbound webhooks | PENDING-P3b (export node scan) |
| Outbound integrations (reads/writes/SENDS) | PENDING-P3b |
| Execution history | PENDING-P3c |
| Credential dependencies | PENDING-P3d + P7 |
| Unique reusable value | PENDING-P3b (logic extraction) |
| Backup completeness | PENDING-P3b (exports) + P4 (DB volume) |
| Host confirmation | PENDING-P5 (DNS A record) |
| Cost share | PENDING-P6 |

## Supabase preston-ai-andersen

| Dimension | Status |
|---|---|
| Local references | DONE (zero) |
| Retention/expiry risk | PENDING-P1a (TIME-SENSITIVE) |
| Data size/content | PENDING-P1b/c |
| Workflow references to it | PENDING-P3b |
| Backup + restore proof | PENDING-P1c + template |
| Unique value (only processed copy?) | PENDING-P1c vs P2 vault |
| Cost | PENDING-P6 (likely $0 paused) |

## Supabase preston-ai-pathc-dev

| Dimension | Status |
|---|---|
| Local references | DONE (zero anywhere) |
| Purpose/origin | PENDING owner statement (P1 notes) |
| Retention risk | PENDING-P1a |
| Data size | PENDING-P1b |
| Backup | PENDING-P1c |
| External references | PENDING-P3b (none expected) |
| Cost | PENDING-P6 |

## Hetzner preston-agent-staging

| Dimension | Status |
|---|---|
| Role | DONE (Phase 5 proven runtime host) |
| Baseline enumeration | PENDING-P4 (drift detection baseline) |
| Hidden legacy dependencies | PENDING-P4 (hosts file, cron) |
| Backups/snapshots | PENDING-P4 console notes |
| Cost | PENDING-P6 |

## Hetzner gmail-dev-n8n

| Dimension | Status |
|---|---|
| Local references | DONE (zero) |
| Hosts automation.prestonwd.com? | PENDING-P5 (INFERRED yes) |
| Services/containers/volumes | PENDING-P4 |
| n8n DB + volume backup | PENDING-P4 |
| Gmail-dev remnants | PENDING-P4 |
| Patch/hardening posture | PENDING-P4 |
| Cost | PENDING-P6 |

## Hetzner ubuntu-4gb-fsn1-2

| Dimension | Status |
|---|---|
| Local references | DONE (zero) |
| Purpose | PENDING-P4 (unknown) |
| Services/processes/data | PENDING-P4 |
| DNS pointing at it | PENDING-P5 |
| Persistent data / repos | PENDING-P4 |
| Snapshot before quarantine | PENDING (retirement step, not evidence step) |
| Cost | PENDING-P6 |

## Domains

| Dimension | Status |
|---|---|
| prestonwd.com records + MX | PENDING-P5 |
| preston.nyc MX (owner email dependency) | PENDING-P5 |
| Renewal costs | PENDING-P6 |
| V8 primary-domain ruling | PENDING (verification session) |
