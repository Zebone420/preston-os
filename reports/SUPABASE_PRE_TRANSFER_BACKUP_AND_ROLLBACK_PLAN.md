# SUPABASE PRE-TRANSFER BACKUP AND ROLLBACK PLAN (Gates 1-3)

Date: 2026-07-22. Owner-run only; nothing here is executed by
Claude. Preconditions: Gate 0 evidence packet returned clean
(reports/SUPABASE_TRANSFER_OWNER_EVIDENCE_PACKET.md).

## Gate 1 - independent pre-transfer backup (REQUIRED)

Execute reports/STAGING_FIRST_BACKUP_OWNER_PACKET.md Path B
exactly (pg_dump -Fc, toc verification, SHA256, off-host copy).
This backup is required REGARDLESS of the transfer decision:
provider daily backups on modern Postgres are physical and not
downloadable, so the logical dump is the only off-platform copy.
Gate 1 passes when the backup-register row is complete (date,
bytes, SHA256, toc spot-checks, off-host location).

## Gate 2 - configuration and health capture (read-only, ~5 min)

Before transferring, record (text/screenshot, no secrets):
- Auth settings page: site URL + redirect URLs list.
- Auth users count (expect: owner + runtime identities).
- Storage buckets count (expect 0).
- API settings: note that URL and anon key EXIST (do not copy
  values anywhere new - this is a "present and working" check).
- Database -> Extensions: pgcrypto enabled (and note any others).
- A quick staging smoke: sign in, open /business (CONNECTED
  badge), open /os (flags off). This is the "before" picture
  Gate 4 compares against.

## Gate 3 - the transfer (owner, dashboard)

Project Settings -> General -> Transfer project -> select the
paid organization -> read the final preview once more (cost +
warnings; abort if anything differs from Gate 0 evidence) ->
confirm. Expected duration: near-immediate; documented downtime
for Free->paid: none stated (paid->Free direction documents 1-2
minutes). Perform during a quiet window anyway (not while a
worker/Hermes timer window is mid-drill).

## Rollback / escalation

- Transfer proves reversible by the same mechanism (transfer
  back to the Free org), subject to the Free org's two-project
  limit - which currently holds 3 projects including 2 paused;
  if a transfer-back were ever needed and blocked by the limit,
  escalate rather than delete anything.
- If the project misbehaves post-transfer (Gate 4 failures):
  DO NOT restore anything into it reflexively; capture the
  failure, check Supabase status page, and escalate to a
  diagnosis session. The Gate 1 dump guarantees data is safe in
  the worst case (restore into a FRESH project + env re-point -
  the documented Option C path becomes the emergency fallback).
- Billing rollback: source org charged to transfer point, target
  after [DOC]; a same-cycle transfer-back would be a billing
  question for Supabase support, not a data risk.

Hard rule: no step in Gates 1-3 modifies data, and nothing is
ever restored into preston-os-staging.
