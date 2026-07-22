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
  State (owner-verified): paused.
  Disposition (current): RETAIN PAUSED -> export -> MIGRATE (P-1)
  -> then delete candidate.

## Supabase: preston-ai-pathc-dev (paused, us-west-2)
  State (owner-verified): paused.
  Disposition (current): INVESTIGATE -> DELETE CANDIDATE
  (evidence-gated).

## Supabase: preston-os-staging (active nano, us-east-1)
  State (verified): active; authoritative staging.
  Disposition (current): RETAIN (checklist runs as control).

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
