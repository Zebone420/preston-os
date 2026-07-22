# SUPABASE TRANSFER - POST-VALIDATION PACKET (Gates 4-7)

Date: 2026-07-22. Owner-run, read-only except one approval
decision in the smoke test. Run immediately after Gate 3.

## Gate 4 - identity and configuration verification (~10 min)

Confirm each; all should be UNCHANGED from the Gate 2 capture:
1. Project appears under the PAID organization.
2. Project URL and ref: identical (dashboard Settings -> API).
3. Anon key: identical presence (do not copy it; the real check
   is #6 below working without touching Vercel).
4. Auth: same user count; site/redirect URLs unchanged.
5. Tables: Table Editor shows the same 42 public tables; spot-
   open quotes and approvals; Database -> Policies shows RLS
   policies present on business tables.
6. WITHOUT changing any Vercel env: open the staging app, sign
   in as owner. If login works and /business shows CONNECTED -
   URL, anon key, and Auth all survived intact.
7. Storage still 0 buckets; no new integrations appeared.
FAIL condition: any mismatch -> stop, record it, escalation path
in the pre-transfer plan.

## Gate 5 - provider backup availability

1. Database -> Backups: page should now show the paid-plan
   backup surface instead of the Free upsell.
2. Record when the FIRST completed daily backup appears (docs do
   not promise a time; expect within ~24h). Record its timestamp
   in the backup register. LA-10 is NOT closed until this exists.

## Gate 6 - staging smoke test (~10 min)

1. Sign-in; sign-out; sign back in (session behavior sane).
2. /business renders CONNECTED with expected data.
3. Quote simulation: run one draft (any small input); totals
   deterministic; redirect to the quote page works.
4. /approvals: the new pending row exists; approve it; banner
   "Decision recorded. Nothing was executed."; /audit shows the
   decision row.
5. /os: execution_enabled false, remote_runner false, hermes
   observe_only, owner_stop false, paused false.
6. Runtime: on the staging host, run the standard read-only
   health (preflight-health.sh or the drill's health command);
   worker + Hermes health OK; timers untouched.
FAIL condition: any regression -> capture exact output; the app
side is diagnosable in a normal engineering session (data is
intact per Gate 4).

## Gate 7 - records closeout

Only when BOTH exist - (a) Gate 1 independent dump evidence and
(b) Gate 5 first provider backup timestamp:
- Backup register: staging row updated (provider daily backups +
  logical dump + off-host copy; restore-test date scheduled).
- LA-10: closed in the defect register with both evidence lines.
- Cost worksheet row 5: actual paid-org cost from billing.
- Decision briefs + NEXT_GATES updated to the new posture.
- Ongoing policy note: periodic (recommended weekly) owner
  pg_dump remains the off-platform copy; the scratch-project
  restore test (within 2 weeks of Gate 1) still applies.
