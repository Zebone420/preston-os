# SUPABASE PROJECT TRANSFER - IMPACT MATRIX

Date: 2026-07-22. Classification of every Preston OS dependency
against an organization transfer of preston-os-staging.
Classes: UNCHANGED (by transfer, per platform model) /
OWNER-VERIFY (confirm at Gate 0 or 4) / LIKELY-UPDATE / UNKNOWN.

| Dependency | Where it lives | Class | Notes |
|---|---|---|---|
| Supabase organization ID | nowhere in repo/env | UNCHANGED-IRRELEVANT | no code or config references the org |
| Project reference (ref) | inside NEXT_PUBLIC_SUPABASE_URL etc. | UNCHANGED (Gate 4 verify) | transfer moves ownership, not the project |
| NEXT_PUBLIC_SUPABASE_URL | Vercel env (name only in repo) | UNCHANGED (Gate 4) | URL embeds the ref |
| Anon key | Vercel env | UNCHANGED (Gate 4) | keys are project-scoped |
| Service-role key | NOT USED by app [REPO verified] | UNCHANGED-IRRELEVANT | remains unused |
| DB connection string / password | 1Password; used only for owner pg_dump | UNCHANGED (Gate 4) | needed for Gate 1 backup |
| SUPABASE_RUNTIME_KEY/TOKEN/STORE (Hetzner) | staging host env + token stores | UNCHANGED (Gate 4 + Gate 6 runtime health) | same project, same identities |
| Auth users (owner + runtime identities) | in-project auth | UNCHANGED (Gate 4) | sessions expected to survive; re-login is the fallback |
| Auth callback / site URLs | project auth settings | UNCHANGED (Gate 4) | settings travel with the project |
| Migrations 0001-0006, 0009 applied state | in-database | UNCHANGED | DDL is data; ownership change touches nothing |
| RLS policies + grants | in-database | UNCHANGED (Gate 4 spot-check) | |
| Storage buckets | none expected [REPO] | OWNER-VERIFY (confirm zero at Gate 2) | transfer moot if none |
| Edge Functions | none [REPO] | UNCHANGED-IRRELEVANT | |
| Database webhooks | none [REPO] | UNCHANGED-IRRELEVANT | |
| Log drains | none (Free Plan) | OWNER-VERIFY at Gate 0 | doc-listed transfer BLOCKER if any exist |
| Supabase GitHub integration | believed not configured | OWNER-VERIFY at Gate 0 | doc-listed transfer BLOCKER if active |
| Vercel-Supabase integration | believed absent (envs set manually per packets) | OWNER-VERIFY at Gate 0 | if installed, note behavior before transfer |
| Vercel deployment itself | Vercel project | UNCHANGED | talks to the same URL/keys |
| Hetzner runtime services | systemd timers, dispatcher | UNCHANGED (Gate 6 verify) | same endpoints |
| Billing/cost rows | reports/COST_EVIDENCE_WORKSHEET.md | LIKELY-UPDATE | row 5 moves from $0 to a paid-org share (Gate 0 preview) |
| Backup posture (LA-10) | registers/briefs | LIKELY-UPDATE (improves) | daily provider backups post-transfer + retained logical dumps |
| Quotas/compute (nano) | project settings | OWNER-VERIFY at Gate 0 | paid org may change compute floor/pricing - read the transfer UI preview |
| First provider backup timing | n/a | UNKNOWN (docs silent) | Gate 5 records the actual first backup |

No repository code change is expected from a transfer. The only
anticipated repo edits are documentation/evidence updates.
