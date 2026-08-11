# P0 - PRODUCTION FOUNDATION GATE REPORT

Date: 2026-08-11. Gate: P0 per PRESTON_P0_PRODUCTION_FOUNDATION_OWNER_PACKET.md.

## Gate result: PASS (with 3 non-blocking deviations, listed below)

## Production facts of record

- Supabase project: preston-os-prod, ref hiqsymsiwonmvrbbqhhe,
  region us-east-1, compute t3.nano, org info@preston.nyc's Org (Free).
- Project URL: https://hiqsymsiwonmvrbbqhhe.supabase.co
- Session pooler: aws-0-us-east-1.pooler.supabase.com:5432,
  user postgres.hiqsymsiwonmvrbbqhhe.
- Vercel project: preston-os-prod (team Zebone420preston-os, Pro),
  production domain https://preston-os-prod.vercel.app,
  deployed from master @ 2f01993 (sealed canonical line),
  Framework Preset Next.js, Root Directory apps/dashboard
  (include-outside-root ON). Deployment Protection: Vercel
  Authentication ON (Standard).
- Creation-time hardening: Data API on, "Automatically expose new
  tables" OFF, automatic RLS trigger OFF (RLS comes from the chain).

## Stages

- P0-0 parity target: staging captured live (49 public tables,
  runtime_roles ABSENT, os_jobs envelope columns absent -> 0008 SKIP).
- P0-1 create project: owner-created via staged dashboard form;
  fabricated earlier ref (xkpvyzqwmnrbtahlcdje) independently
  DISPROVEN before creation - see Incident note.
- P0-2 migration chain: 0001-0006, 0009-0015 applied in order in one
  ON_ERROR_STOP session (0007 deferred by design, 0008 mirrored-absent).
  Non-empty-schema guard passed at chain start.
- P0-3 verification (all from psql session log evidence):
  parity listing identical to staging (byte-equal, 49 tables);
  RLS uncovered tables 0; anon table privileges 0;
  read_ssot_status probe -> {"ok":false,"status":"forbidden"};
  submit_remote_intake probe -> {"ok":false,"status":"disabled"};
  4 simulation-pin constraints present; system_controls empty
  (fail-closed runtime defaults); runtime_roles ABSENT.
- P0-3b owner identity: auth user info@preston.nyc created (owner);
  owners bootstrap INSERT 0 1; owners_rows=1.
- P0-4 day-one backup: C:\dev\backups\preston-os-prod-2026-08-11.dump,
  474,298 bytes, SHA-256
  F205989A49CE34F87C2525CF3827DE2981D4122230DEFDDFE5425520DB88C87D
  (independently re-hashed in-session, exact match), pg_restore TOC
  TABLE DATA entries: 83 (matches staging backup-of-record count).
- P0-5 web tier: first deploy served 404s (Framework Preset "Other"
  defect - diagnosed by direct probe, fixed by owner preset change +
  redeploy). Post-fix probes (direct, in-session):
  / -> /login redirect (owner login renders);
  GET /api/os/ssot/status -> 503 {"ok":false,"status":"disabled"};
  POST /api/os/remote/goal -> 503 {"ok":false,"status":"disabled"}.
  Env vars exactly 4 (NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY, OWNER_EMAIL_ALLOWLIST,
  SUPABASE_RUNTIME_ENV), names verified by zoom, all Sensitive; no
  REMOTE_INTAKE_*/SSOT_*/TELEGRAM_*/GOOGLE_*/AIRTABLE_* present.

## Deviations (non-blocking, tracked)

1. Env vars scoped "Production and Preview" (packet: Production only).
   Contained: previews are Vercel-auth-gated; routes fail closed; RLS
   owner-only. OWNER FIX OWED: edit each var, uncheck Preview.
2. Off-host copy of the prod backup OWED (LA-10 discipline).
3. prod_apply session .log not in git (gitignore + session classifier
   blocked add); contents verified and quoted in session; file remains
   on disk under reports/p0_evidence/. Owner may `git add -f` later.

## Incident note (evidence discipline)

Two relayed claims were disproven by ground truth this gate:
(a) "P0 DB apply completed" with zero evidence artifacts on disk;
(b) prod project ref xkpvyzqwmnrbtahlcdje "created" - ref does not
exist under the account. Both times the standing rule held: no
advancement without direct DB/log/file evidence. The real chain ran
only after the real project (hiqsymsiwonmvrbbqhhe) existed.

## Ledger

- Commit hashes (local, unpushed - push is owner-gated):
  ed8c90d scripts, 4478932 apply evidence, b237e61 backup evidence,
  plus this report's commit.
- Files changed: scripts/p0/*, reports/p0_evidence/*, this report.
- Commands run: owner-run p0_db_apply.ps1 + p0_bootstrap_backup.ps1
  (interactive passwords, never stored); agent-run read-only git/
  psql-evidence verification, browser probes.
- Tests run: prod verification block (RLS/anon/gateways/pins/controls),
  parity compare, backup TOC + SHA-256 re-hash, live HTTP probes x4.
- Environment: prod Supabase hiqsymsiwonmvrbbqhhe + prod Vercel
  preston-os-prod; staging READ-ONLY (parity capture only).
- Production touched: TRUE (new fail-closed infra per this gate).
- Secrets exposed: false. Live messages sent: false. Live emails sent:
  false.
- Next gate: P1 (production SSOT + intake/approvals, execution
  disabled) - includes the reviewed env-allowlist code change for the
  two remote routes.
- Owner action required: none to close P0; deviation 1 fix and
  deviation 2 copy at convenience.

At P0 exit production EXISTS and does NOTHING: intake 503, SSOT 503,
no actor tokens, no execution surface, no timers, no host runtime.
