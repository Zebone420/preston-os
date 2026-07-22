# RETIREMENT-SAFETY ADVERSARIAL AUDIT - ROUND 1

Date: 2026-07-21. Run against ALL known assets using the 17-check
framework (reports/RETIREMENT_SAFETY_ADVERSARIAL_CHECKLIST.md)
and every evidence source available today: repo sweep (commit
acb1a1d), external reachability checks, Item 1 Supabase evidence,
Phase 5/6 records. Adversarial stance: attempt to DISPROVE
retirement safety. ROUND 1 VERDICT SUMMARY: no asset passes all
17 checks; ZERO executable retirement approvals can be issued;
every deletion candidate remains evidence-gated. Round 2 runs
when Sessions A-D return.

Notation per asset: checks listed as PASS / FAIL / UNKNOWN with
the controlling evidence. Only checks that decide the round are
shown; the full 17 apply at round 2.

## Zebone420/preston-os - RETAIN (control)
1 purpose PASS (authoritative platform). 2 dependencies PASS
(Vercel/Supabase/host). 17 disposition PASS: RETAIN. No
retirement question exists.

## preston-ai-andersen-graph repo - INVESTIGATE
1 purpose UNKNOWN (inferred only). 9 persistent data UNKNOWN.
10 reusable value UNKNOWN (expected high). 12 backup FAIL (no
clone exists yet - GitHub copy is the ONLY copy; a deleted repo
is unrecoverable). ADVERSARIAL NOTE: until Session A clones it,
this repo is in the riskiest possible state for any account-level
mistake. Disposition: INVESTIGATE; clone = the backup step.

## preston-ai-andersen-vault repo - INVESTIGATE
Same as graph, plus 15 legal UNKNOWN (vendor licensing).
Disposition: INVESTIGATE.

## n8n instance - RETAIN (short-term)
1 purpose PARTIAL (serves workflows - which are active UNKNOWN).
3 webhooks UNKNOWN. 6 execution history UNKNOWN. 11 credentials
UNKNOWN (store contents unlisted). 12 backup FAIL (no workflow
exports exist yet; the n8n DB on gmail-dev-n8n is the only copy).
ADVERSARIAL FINDING R1-1: the entire automation estate currently
has ZERO backups anywhere - Session B exports are themselves the
first backup. Disposition: RETAIN short-term; hardening pending
version evidence.

## Workflows PM-1 / EXT-4 / EXT-3 / WF-1 / WF-3 / KB Read Test
All: 1,3,4,5,6,11 UNKNOWN (no exports). 10 reusable value:
expected (integration proposals staged). 12 backup FAIL (no
export). Disposition: all INVESTIGATE until Session B.
ADVERSARIAL NOTE: EXT-3/EXT-4 may have SEND capability - until
exports prove otherwise, treat as messaging-capable; any owner
temptation to re-enable anything before review is unsafe.

## n8n "My workflow" - DELETE CANDIDATE (blocked)
6 execution history UNKNOWN; 11 credentials UNKNOWN; 12 backup
FAIL. All three must pass before the R1 approval text in the
retirement packet becomes signable. Blocked.

## Supabase preston-ai-andersen - RETAIN PAUSED (gate scheduled)
1 purpose INFERRED. 9 persistent data UNKNOWN size (paused hides
it). 12 backup FAIL - export requires unpause (owner gate);
deadline pressure VERIFIED (resume until 28 Sep 2026). 13 restore
UNKNOWN (depends on export format). 15 retention: knowledge data
- retain permanently once exported. Disposition: RETAIN PAUSED;
the unpause+export gate is the critical path (decision brief).

## Supabase preston-ai-pathc-dev - DELETE CANDIDATE (blocked)
1 purpose FAIL-TO-ESTABLISH (owner: "no confirmed purpose...
unverified"). 9 data UNKNOWN. 12 backup FAIL (requires unpause).
ADVERSARIAL NOTE: "probably an experiment" plus zero references
is NOT sufficient - the checklist requires an export and an
origin statement before deletion. Blocked pending the same
unpause gate (deadline 23 Sep 2026).

## Supabase preston-os-staging - RETAIN
1-11 PASS (active platform). 12 backup FAIL - LA-10, "No
backups" (owner-verified). ADVERSARIAL FINDING R1-2: the control
asset fails its own backup check; see the staging backup decision
brief. RETAIN with remediation pending.

## Hetzner preston-agent-staging - RETAIN
1 purpose PASS (Phase 5 proven). 2 dependencies PASS. 8 processes
PARTIAL (enumeration baseline pending Session C). 12 backup
UNKNOWN (snapshot/backup setting unknown). RETAIN.

## Hetzner gmail-dev-n8n - RETAIN (short-term)
1 purpose INFERRED (n8n host - DNS unconfirmed). 7 DNS UNKNOWN.
8 processes UNKNOWN. 9 data: n8n DB = only automation copy
(R1-1). 12 backup UNKNOWN. Disposition: RETAIN short-term;
consolidation decision blocked until C+B.

## Hetzner ubuntu-4gb-fsn1-2 - DELETE CANDIDATE (blocked)
1 purpose UNKNOWN. 7 DNS UNKNOWN. 8 processes UNKNOWN. 9 data
UNKNOWN. 12 backup FAIL (no snapshot). ADVERSARIAL NOTE: this is
the strongest candidate precisely because nothing is known -
which is also why NOTHING can be approved: an unknown server may
hold the only copy of something valuable. Session C is the
entire case. Blocked.

## prestonwd.com - RETAIN
7 DNS PARTIAL (automation subdomain VERIFIED serving; full
records unknown). 2 dependencies: n8n instance. 15 V8 ruling
pending. RETAIN.

## preston.nyc - RETAIN (identity-critical)
2 dependencies PASS-CRITICAL: info@preston.nyc is the owner login
identity; MX location UNKNOWN (Session D protects it).
ADVERSARIAL FINDING R1-3: no documented evidence of where the
owner's login mailbox is hosted - an email-hosting lapse would
lock the owner out of password recovery paths. RETAIN; D1 fills
the gap.

## Airtable TEST base - RETAIN
1,2 PASS (read-only source for cards). 16 cost UNKNOWN (plan).
RETAIN.

## Vercel staging - RETAIN
1,2 PASS (serves the staging-operational app). RETAIN.

## Local legacy-audit evidence (C:\dev\legacy-audit\) - RETAIN
9 persistent data: will hold the ONLY export copies during the
program. 15 retention: keep until program completion (intake
guide). RETAIN; never clean up early.

## Round-1 adversarial findings (new)

| # | Finding | Action |
|---|---|---|
| R1-1 | The automation estate (7 workflows + n8n credential store) has zero backups anywhere until Session B exports + a server-side snapshot exist | Session B is a backup action as much as evidence; prioritize |
| R1-2 | The control asset preston-os-staging fails check 12 (LA-10) | staging backup decision brief issued |
| R1-3 | Owner-identity mailbox hosting (preston.nyc MX) undocumented | Session D1; protect before any domain decision |

## Round-1 outcome

Executable retirement approvals issued: NONE (correct outcome at
this evidence level). Dispositions recorded in
reports/FINAL_DISPOSITION_REGISTER.md. Round 2 trigger: any
session A-D returning.
