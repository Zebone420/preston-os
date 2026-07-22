# RETIREMENT-SAFETY ADVERSARIAL CHECKLIST (framework)

Date: 2026-07-21. This is the framework the adversarial
retirement auditor runs PER ASSET after the V2 evidence packet
returns. The auditor's mandate is to DISPROVE retirement safety:
a candidate passes only if every attack below fails. No
disposition becomes an executable retirement approval until its
checklist is complete and the auditor's report is archived in
reports/EXTERNAL_ASSET_EVIDENCE_REGISTER.md.

## Auditor instructions

Run as an independent pass (subagent or separate session) with
access to the sanitized evidence register and the raw evidence
paths. For each asset, answer all 17 checks with evidence
citations. Any UNKNOWN = the asset stays INVESTIGATE. Any
positive finding = the asset's disposition is re-argued, not
patched silently.

## The 17 checks (per asset)

1. CURRENT PURPOSE - can you state, with evidence, what this
   asset does today (not historically)? Attack: find any recent
   activity (executions, logins, connections, log lines) that
   contradicts "dormant".
2. ACTIVE DEPENDENCIES - does anything call, read, mount, or
   query it now? Attack: cross-check workflow exports, server
   process lists, DNS, and the OS repo sweep simultaneously.
3. INBOUND WEBHOOKS - do any public URLs route into it? Attack:
   enumerate webhook nodes/paths in every n8n export and any
   reverse-proxy config from the server enumeration.
4. OUTBOUND INTEGRATIONS - does it write to or message any
   external system? Attack: any send/write node or script found
   means retirement changes external behavior - name it.
5. SCHEDULES/TRIGGERS - do timers, cron entries, or n8n schedule
   nodes fire it? Attack: reconcile crontab/systemd-timer output
   with workflow trigger nodes.
6. EXECUTION HISTORY - when did it last actually run/serve?
   Attack: "no recent executions" claimed from a UI page that
   truncates history is not proof - note the history window.
7. DNS REFERENCES - does any record resolve to it? Attack: check
   BOTH domains' full record lists, not just known subdomains.
8. SERVER PROCESSES - on servers: what would die with it? Every
   running service must be identified or the server stays
   INVESTIGATE.
9. PERSISTENT DATA - what data exists only here? Attack: assume
   every disk, volume, and database contains something unique
   until an export proves its contents.
10. UNIQUE REUSABLE VALUE - does the integration program (P-1..
    P-5) still need anything from it? Retirement before
    extraction destroys the roadmap input.
11. CREDENTIAL DEPENDENCIES - which credentials live in or
    authenticate to it, and are they named in the credential
    register with a revocation line?
12. BACKUP COMPLETENESS - does an export/snapshot exist, is it
    RECENT, and is its location recorded in the backup register?
13. RESTORE PROCEDURE - has a restore path been WRITTEN (not
    assumed)? For at least one representative asset per class,
    restore must be tested or explicitly owner-waived.
14. ROLLBACK PLAN - after deletion, what is the recovery window
    and cost? (Snapshot retention period, export re-import.)
15. LEGAL/RECORD-RETENTION - business records (quotes, client
    communications, financial data) or licensed vendor content
    inside? If yes: retention rules apply before deletion.
16. ACTUAL MONTHLY COST - from the billing evidence, not
    estimates - is the saving worth the risk this cycle?
17. FINAL DISPOSITION - argue the disposition AGAINST the
    alternatives (why not ARCHIVE instead of DELETE? why not
    PAUSE longer?). The cheapest reversible option wins ties.

## Per-asset checklist instances

Instances for: andersen-graph repo, andersen-vault repo, n8n
instance, each of the 7 workflows, preston-ai-andersen,
preston-ai-pathc-dev, preston-os-staging (RETAIN - checklist
run as control), each of the 3 servers, prestonwd.com,
preston.nyc. Results are recorded per asset in
reports/EXTERNAL_ASSET_EVIDENCE_REGISTER.md with check numbers
1-17, PASS/FAIL/UNKNOWN, and evidence paths.

## Standing outcomes already known

- Check 2 (local half): DONE for all legacy assets - zero local
  functional references (repo sweep, commit acb1a1d).
- Check 17 discipline: current dispositions in
  reports/LEGACY_ASSET_INVENTORY.md are PROVISIONAL and remain
  so until this checklist completes per asset.
