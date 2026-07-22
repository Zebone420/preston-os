# FINAL DISPOSITION REGISTER

Date: 2026-07-21 (Round 1 - will be re-issued at Round 2 with
session evidence). Source: RETIREMENT_SAFETY_AUDIT_R1.md.
Security findings register: reports/LEGACY_AUDIT_DEFECT_REGISTER
.md (LA-1..LA-10) plus R1-1..R1-3 in the audit - that file is the
canonical security-findings register for this program.

| Asset | Disposition (R1) | Executable approval? | Blocking evidence |
|---|---|---|---|
| preston-os repo | RETAIN | n/a | - |
| preston-ai-andersen-graph | INVESTIGATE (-> ARCHIVE) | NO | Session A clone + sweep |
| preston-ai-andersen-vault | INVESTIGATE (-> ARCHIVE) | NO | Session A + licensing |
| n8n instance | RETAIN short-term (harden) | n/a | Session B version; C host facts |
| PM-1 Health Monitor | INVESTIGATE (-> INTEGRATE -> ARCHIVE) | NO | Session B export |
| EXT-4 Open Loop | INVESTIGATE (-> INTEGRATE -> ARCHIVE) | NO | Session B export |
| EXT-3 Deposit Detector | INVESTIGATE (-> INTEGRATE -> ARCHIVE) | NO | Session B export |
| WF-1 ANDERSEN_INDEX_INGEST | INVESTIGATE (-> INTEGRATE P-1) | NO | Session B export |
| WF-3 ANDERSEN_ASK_MVP | INVESTIGATE (-> INTEGRATE P-1) | NO | Session B export |
| Andersen KB Read Test | INVESTIGATE (-> ARCHIVE) | NO | Session B export |
| "My workflow" | DELETE CANDIDATE (blocked) | NO | Session B export + exec history |
| Supabase preston-ai-andersen | RETAIN PAUSED | n/a | unpause+export gate (by early Sep 2026) |
| Supabase preston-ai-pathc-dev | DELETE CANDIDATE (blocked) | NO | unpause+export gate + origin statement |
| Supabase preston-os-staging | RETAIN | n/a | LA-10 backup remediation (brief issued) |
| Hetzner preston-agent-staging | RETAIN | n/a | Session C baseline (non-blocking) |
| Hetzner gmail-dev-n8n | RETAIN short-term | n/a | Sessions B+C+D -> consolidation decision |
| Hetzner ubuntu-4gb-fsn1-2 | DELETE CANDIDATE (blocked) | NO | Session C enumeration + D1 DNS + snapshot + quarantine |
| prestonwd.com | RETAIN | n/a | D1 records; V8 ruling |
| preston.nyc | RETAIN (identity-critical) | n/a | D1 MX documentation (R1-3) |
| Airtable TEST base | RETAIN | n/a | D2 plan cost |
| Vercel staging | RETAIN | n/a | D2 plan confirmation |
| legacy-audit evidence store | RETAIN until program end | n/a | - |

Retirement approvals issued this round: ZERO.
Retirement approvals blocked this round: 4 (My workflow,
preston-ai-pathc-dev, ubuntu-4gb-fsn1-2, and the future
preston-ai-andersen post-migration candidacy) - all for missing
evidence, exactly as the framework requires.
