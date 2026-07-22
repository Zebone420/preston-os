# EXTERNAL ASSET EVIDENCE REGISTER

Date opened: 2026-07-21. One section per external asset. Claude
fills each section from sanitized evidence (see the intake guide)
as packet V2 items return; the adversarial checklist result
(1-17, PASS/FAIL/UNKNOWN) completes each section. Empty fields
mean evidence not yet returned - NOT "no evidence exists".

Template per asset:

  State (verified):
  Evidence files (paths under C:\dev\legacy-audit\):
  Purpose (evidenced):
  Dependencies confirmed:
  Webhooks/triggers:
  Execution/last-activity:
  Persistent/unique data:
  Credentials referenced (names only):
  Backup: (link to backup register row)
  Cost (actual):
  Checklist result (1-17):
  Disposition (current):
  Disposition (final, post-audit):

## GitHub: preston-ai-andersen-graph
  State (verified): 404 anonymously (2026-07-21).
  Disposition (current): INVESTIGATE -> ARCHIVE after export.

## GitHub: preston-ai-andersen-vault
  State (verified): 404 anonymously (2026-07-21).
  Disposition (current): INVESTIGATE -> ARCHIVE after export +
  licensing review.

## n8n instance (automation.prestonwd.com)
  State (verified): reachable, serving n8n UI (2026-07-21).
  Disposition (current): RETAIN short-term, harden.

## n8n workflow: PM-1 Program Manager - Health Monitor v1
  Disposition (current): INVESTIGATE -> INTEGRATE -> ARCHIVE.

## n8n workflow: EXT-4 Open Loop Coordinator v1
  Disposition (current): INVESTIGATE -> INTEGRATE -> ARCHIVE.

## n8n workflow: EXT-3 Outstanding Deposit Detector v1
  Disposition (current): INVESTIGATE -> INTEGRATE -> ARCHIVE.

## n8n workflow: WF-1_ANDERSEN_INDEX_INGEST
  Disposition (current): RETAIN (exported) -> INTEGRATE (P-1).

## n8n workflow: WF-3_ANDERSEN_ASK_MVP
  Disposition (current): RETAIN (exported) -> INTEGRATE (P-1).

## n8n workflow: Andersen KB Read Test
  Disposition (current): ARCHIVE after export.

## n8n workflow: "My workflow"
  Disposition (current): INVESTIGATE -> DELETE CANDIDATE.

## Supabase: preston-ai-andersen (paused, us-west-2)
  State (owner-verified 2026-07-21): paused; Organization Free
  Plan; paused-since not shown; DB/storage sizes not shown while
  paused.
  Evidence files: C:\dev\legacy-audit\supabase\paused-projects.txt
  RETENTION (owner-quoted dashboard banner): resumable within 69
  days, until 28 Sep 2026; "After that, this project will not be
  resumable, but data will still be available for download."
  Dashboard states all data incl. backups and storage objects
  remains safe; Free Plan has no scheduled backups.
  Backup: export REQUIRES UNPAUSE (owner gate; not performed).
  Deadline interpretation: resume-capability expires 28 Sep 2026;
  per the banner, download remains available after - but the
  UNPAUSE-AND-EXPORT decision should be made comfortably before
  the deadline (recommended: decide by early Sep 2026).
  Disposition (current): RETAIN PAUSED -> owner unpause+export
  gate (before 2026-09-28) -> MIGRATE (P-1) -> then delete
  candidate.

## Supabase: preston-ai-pathc-dev (paused, us-west-2)
  State (owner-verified 2026-07-21): paused; Organization Free
  Plan; paused-since not shown; sizes not shown while paused.
  Evidence files: C:\dev\legacy-audit\supabase\paused-projects.txt
  RETENTION (owner-quoted): resumable within 64 days, until
  23 Sep 2026; data downloadable after per banner.
  Purpose (owner statement): "No confirmed purpose. Likely legacy
  development or experiment" - unverified; remains INVESTIGATE.
  Backup: export REQUIRES UNPAUSE (owner gate; not performed).
  Disposition (current): INVESTIGATE -> owner unpause+export gate
  (before 2026-09-23) -> DELETE CANDIDATE (evidence-gated).

## Supabase: preston-os-staging (active nano, us-east-1)
  State (verified + owner-verified 2026-07-21): active;
  Organization Free Plan, NANO compute; database usage 27.83 MB
  of 500 MB.
  FINDING (new, LA-10): "Last Backup: No backups." - the
  authoritative staging database has NO backups (Free Plan has no
  scheduled backups). See defect register LA-10.
  Disposition (current): RETAIN (checklist runs as control);
  backup remediation options go to the owner with packet results.

## Hetzner: preston-agent-staging (168.119.153.173)
  State (owner-verified): active; Phase 5 proven.
  Disposition (current): RETAIN (baseline enumeration pending).

## Hetzner: gmail-dev-n8n (188.245.80.146)
  State: active; INFERRED n8n host.
  Disposition (current): RETAIN short-term -> harden/rename or
  consolidate (option decision post-evidence).

## Hetzner: ubuntu-4gb-fsn1-2 (159.69.118.154)
  State: active; purpose unknown.
  Disposition (current): INVESTIGATE -> DELETE CANDIDATE
  (strongest server candidate; full lifecycle required).

## Domain: prestonwd.com
  State (verified): serves automation subdomain.
  Disposition (current): RETAIN pending n8n decision + V8 ruling.

## Domain/identity: preston.nyc
  State (verified): owner login identity (info@preston.nyc).
  Disposition (current): RETAIN (email dependency critical).
