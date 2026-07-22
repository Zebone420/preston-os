# SUPABASE BACKUP OPTIONS COMPARISON (A / B / C)

Date: 2026-07-22. Estimates marked; platform facts from official
docs fetched 2026-07-22.

| Criterion | A: transfer existing project to paid org | B: stay Free + hybrid pg_dump | C: new/other paid project + data migration |
|---|---|---|---|
| Safety | HIGH - data never moves; ownership label changes | MEDIUM-HIGH - depends on manual/cron discipline | MEDIUM - full data move, re-bootstrap, most moving parts |
| Complexity | LOW (owner clicks + verification gates) | MEDIUM (role SQL, runbook, cron, off-host copy) | HIGH (dump/restore, auth re-creation, env re-issue everywhere) |
| Downtime | none documented Free->paid; brief disruption possible | none | cutover window; staging unusable during switch |
| Backup coverage | provider DAILY (7-day retention on Pro) + retained logical dumps | logical dumps only, at chosen cadence | provider daily (after migration) + logical dumps |
| Restore capability | provider restore (in-place) + logical dump into scratch/fresh | logical restore only | same as A after migration |
| Recurring cost | paid-org share - Gate 0 preview; ESTIMATE USD 0-10/mo if org credits cover compute, else ~USD 10/mo compute | $0 | new project compute on paid org (similar to A) |
| Credential impact | none expected (Gate 4 verifies) | none | NEW everything: URL, keys, DB password, runtime tokens |
| Env-var impact | none expected | none | Vercel + Hetzner + token stores all re-issued |
| Auth/session impact | none expected (users travel with project) | none | auth users re-created; owner bootstrap re-run; sessions reset |
| RLS/grants | unchanged | unchanged | must re-apply migrations + ad hoc grants; drift risk |
| Storage | none in use either way | none | none |
| Operational burden | LOW after Gate 7 (weekly dump only) | MEDIUM forever (discipline or credentialed cron on host) | HIGH once, then as A |
| Rollback difficulty | LOW (transfer back; Free 2-project limit caveat) | n/a | HIGH (second cutover) |
| Production-readiness value | HIGH - staging inherits the provider-backup pattern production needs (P12) | LOW | MEDIUM (proves migration runbook, at high cost) |

Notes:
- In ALL options the independent logical dump (first-backup
  packet) remains required: provider physical backups are not
  downloadable, so off-platform copies only ever come from
  pg_dump [DOC].
- Option C is the designed EMERGENCY path (restore the Gate 1
  dump into a fresh project) - valuable as a fallback, wasteful
  as a first choice.
- PITR is out of scope for staging (needs Small compute,
  ~USD 100/mo [DOC]).

Verdict feeding the decision brief: A dominates B on coverage
and burden, and dominates C on everything except its dependence
on the paid org existing with acceptable cost - exactly what
Gate 0 evidence establishes.
