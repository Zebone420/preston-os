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
| preston-ai-andersen (Supabase) | knowledge tables/vectors | REQUIRES UNPAUSE (owner gate; resume deadline 28 Sep 2026) | - | - | - | restore into fresh project; steps TBD on export format | - | permanent (raw knowledge) |
| preston-ai-pathc-dev (Supabase) | unknown | REQUIRES UNPAUSE (owner gate; resume deadline 23 Sep 2026) | - | - | - | restore into fresh project | - | until retirement +30d |
| n8n workflows (7) | workflow JSON (credential-excluded) | UI download (packet 3b) | - | - | - | n8n import JSON | - | permanent |
| n8n DB + volumes | credential store, executions | server snapshot / volume copy (packet 4) | - | - | - | volume restore on rebuilt host | - | until n8n decision +30d |
| gmail-dev-n8n (full) | whole server | Hetzner snapshot | - | - | - | rebuild from snapshot + DNS re-point | - | until consolidation +30d |
| ubuntu-4gb-fsn1-2 (full) | whole server (unknown content) | Hetzner snapshot BEFORE quarantine | - | - | - | rebuild from snapshot | - | quarantine +30d |
| andersen-graph repo | full history | owner clone (packet 2b) | - | - | - | git push to new remote | - | permanent |
| andersen-vault repo | full history + docs | owner clone | - | - | - | git push to new remote | - | permanent (licensing-restricted) |
| preston-os-staging (control row) | operational DB (27.83 MB): 42 public tables, functions, RLS, grants; auth if readable; NO storage objects | owner-run pg_dump -Fc per reports/STAGING_FIRST_BACKUP_OWNER_PACKET.md (Option 4 approved in principle 2026-07-22; Path B recommended) | - | C:\dev\legacy-audit\supabase\preston-os-staging-first-export\ + off-host copy (location TBD) | - (record bytes+SHA256) | scratch-project restore ONLY (packet to follow; never into staging) | due within 2 weeks of first backup | until superseded by scheduled dumps |

Rules: a backup nobody can restore is not a backup - the restore
procedure column must point at written steps; at least one
restore per class (one Supabase export, one server snapshot) is
test-restored or explicitly owner-waived before any deletion in
that class.
