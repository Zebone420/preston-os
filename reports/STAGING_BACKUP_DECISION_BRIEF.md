# STAGING BACKUP (LA-10) - OWNER DECISION BRIEF
#
# STATUS 2026-07-22: OWNER APPROVED Option 4 IN PRINCIPLE
# (planning/packet scope only): immediate manual backup stored
# outside the repo; later daily pg_dump via an owner-created
# least-privilege backup role; off-host copy; scratch-project
# restore test within two weeks; provider-managed backups
# reconsidered at the production-pilot gate.
# First-backup packet issued:
# reports/STAGING_FIRST_BACKUP_OWNER_PACKET.md (recommended
# path: B, owner-run pg_dump - the Free Plan dashboard offers no
# full export for an active project). The pg_dump runbook +
# backup-role SQL packet and the restore-test packet follow as
# separate documents after the first backup's evidence returns.

Date: 2026-07-21. Finding: preston-os-staging - the authoritative
staging database (business records, quotes, approvals, audit
trail, runtime state; 27.83 MB of 500 MB) - has NO backups.
"Last Backup: No backups."; Free Plan excludes scheduled backups.
Claude implements nothing here; every option is owner-run.

## Options

### Option 1 - Periodic owner-run manual export (dashboard)
- Cost: $0. Burden: ~5 min per run, human-remembered.
- RPO (data you could lose): everything since the last manual
  run - realistically days-to-weeks.
- RTO: restore into a fresh project + repoint env: ~1-2 hours.
- Security: export file handled by you; store outside the repo.
- Credential need: dashboard login only.
- Automation risk: none (no automation).
- Weakness: relies on habit; the failure mode is "forgot for a
  month".

### Option 2 - Supabase paid plan with scheduled backups
- Cost: Pro tier - roughly USD 25/month (ESTIMATE; confirm on
  the pricing page; also lifts nano limits).
- RPO: daily (plan-dependent; PITR higher tiers). RTO: provider
  restore, typically minutes-to-an-hour.
- Burden: near zero after enabling. Security: provider-managed.
- Credential need: billing action (owner-only).
- Weakness: recurring cost for a staging system; but this staging
  DB is currently the ONLY system of record for real business
  entry once daily use begins.

### Option 3 - Owner-run pg_dump from an approved host
- Cost: $0. Burden: one-time setup (~1 hour) + cron on
  preston-agent-staging or a manual runbook.
- RPO: whatever schedule is set (daily achievable). RTO: ~1-2
  hours (psql restore + verification).
- Security: requires the database connection string as a
  credential ON the host (0600 file, same pattern as the runtime
  token store); dumps must be stored encrypted or at least
  access-restricted, ideally copied off-host.
- Automation risk: LOW but nonzero - a cron job holding a DB
  credential is new attack surface on the host; mitigate with a
  read-only role (owner-created) for the dump.
- Weakness: dumps sitting only on the same host protect against
  logical deletion, not host loss - pair with Hetzner snapshots
  or an off-host copy.

### Option 4 - Hybrid (RECOMMENDED)
Now (this week, $0): one manual export (Option 1) to establish a
first restore point, stored off-repo per the intake guide.
Ongoing while staging-only: Option 3 daily pg_dump on the staging
host with a read-only role + weekly owner download of the latest
dump (off-host copy). Re-decide at the production-pilot gate:
production tier will need Option 2/PITR anyway (P12 in the
Phase 7 packet) - staging can then inherit or stay on Option 3.

## Restore-test requirement (all options)

One test restore into a scratch project within 2 weeks of the
first backup, verifying: tables count, one quote's totals, one
approval row, RLS intact. A backup is not real until this passes
(backup register rule).

## Recommended staging policy

RPO 24h / RTO 2h via Option 4; restore-tested; revisit at the
production pilot gate.

## Exact owner gate

1. Decide the option (default: 4).
2. Immediate step regardless: one manual export this week ->
   C:\dev\legacy-audit\supabase\preston-os-staging-first-export
   (or private storage), note date+size in the backup register.
3. If Option 3/4: approve a small follow-up engineering gate for
   Claude to author the dump runbook + read-only-role SQL packet
   (owner-applied), before any cron exists.
Stop conditions: never store a connection string in any evidence
file; never test-restore INTO the live staging project.
