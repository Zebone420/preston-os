# BACKUP AND RESTORE EVIDENCE (template)

Date opened: 2026-07-21. One row per asset that holds persistent
data. A retirement approval requires its asset's row to be
COMPLETE (backup taken + restore path written + verified or
owner-waived). Backup files live under C:\dev\legacy-audit\ or
owner archive storage - never in this repo.

Row format:

| Asset | What the backup contains | Backup method | Taken (date) | Stored at | Size | Restore procedure (written where) | Restore tested? | Retention |

## Rows to complete

| Asset | Contains | Method | Taken | Stored at | Size | Restore procedure | Tested | Retention |
|---|---|---|---|---|---|---|---|---|
| preston-ai-andersen (Supabase) | knowledge tables/vectors | dashboard export/backup (packet 1c) | - | - | - | restore into fresh project; steps TBD on export format | - | permanent (raw knowledge) |
| preston-ai-pathc-dev (Supabase) | unknown | dashboard export | - | - | - | restore into fresh project | - | until retirement +30d |
| n8n workflows (7) | workflow JSON (credential-excluded) | UI download (packet 3b) | - | - | - | n8n import JSON | - | permanent |
| n8n DB + volumes | credential store, executions | server snapshot / volume copy (packet 4) | - | - | - | volume restore on rebuilt host | - | until n8n decision +30d |
| gmail-dev-n8n (full) | whole server | Hetzner snapshot | - | - | - | rebuild from snapshot + DNS re-point | - | until consolidation +30d |
| ubuntu-4gb-fsn1-2 (full) | whole server (unknown content) | Hetzner snapshot BEFORE quarantine | - | - | - | rebuild from snapshot | - | quarantine +30d |
| andersen-graph repo | full history | owner clone (packet 2b) | - | - | - | git push to new remote | - | permanent |
| andersen-vault repo | full history + docs | owner clone | - | - | - | git push to new remote | - | permanent (licensing-restricted) |
| preston-os-staging (control row) | operational DB | provider backups (tier from packet 1d) | - | - | - | provider restore | - | provider policy |

Rules: a backup nobody can restore is not a backup - the restore
procedure column must point at written steps; at least one
restore per class (one Supabase export, one server snapshot) is
test-restored or explicitly owner-waived before any deletion in
that class.
