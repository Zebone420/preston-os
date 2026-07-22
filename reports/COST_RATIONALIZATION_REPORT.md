# COST RATIONALIZATION REPORT

Date: 2026-07-21. ALL prices below are ESTIMATES from public list
pricing unless marked OWNER-CONFIRMED; packet F collects the real
invoices. No billing data was accessed this session.

## Current footprint (estimated)

| Asset | Plan/size | Est. monthly | Basis |
|---|---|---|---|
| Hetzner preston-agent-staging | CPX22 | ~EUR 7-9 | list price ESTIMATE |
| Hetzner gmail-dev-n8n | CPX22 | ~EUR 7-9 | ESTIMATE |
| Hetzner ubuntu-4gb-fsn1-2 | CPX22 | ~EUR 7-9 | ESTIMATE |
| Hetzner snapshots/backups | unknown | UNKNOWN | packet F |
| Supabase preston-os-staging | active nano | USD 0-10 (tier UNKNOWN) | packet F |
| Supabase preston-ai-andersen | paused | likely USD 0 | paused; plan UNKNOWN |
| Supabase preston-ai-pathc-dev | paused | likely USD 0 | paused; plan UNKNOWN |
| Vercel (staging project) | Hobby (assumed) | USD 0 (ASSUMED) | packet F confirms |
| Domain prestonwd.com | registrar | ~USD 1-2/mo equiv | ESTIMATE |
| Domain preston.nyc | registrar | UNKNOWN (.nyc pricing varies) | packet F |
| Airtable | plan UNKNOWN | UNKNOWN | packet F |
| GitHub | free private (assumed) | USD 0 | ASSUMED |

Estimated current total: roughly EUR 21-27 + USD 0-15 monthly
plus unknowns (Airtable, domains, snapshot storage).

## Minimum required footprint (to run what is used today)

- 1x Hetzner server (preston-agent-staging)
- Supabase preston-os-staging
- Vercel staging project
- GitHub preston-os
- preston.nyc identity (email/domain)
- Airtable TEST base (until the intake gate replaces it)

## Recommended consolidated footprint (preserves n8n optionality)

Minimum footprint PLUS ONE of:
(a) keep gmail-dev-n8n (hardened, renamed) while n8n workflows
    still matter -> ~EUR 14-18/mo total Hetzner; or
(b) after WF/EXT logic is integrated into Preston OS, retire the
    n8n instance entirely -> single-server footprint.
ubuntu-4gb-fsn1-2 is in neither option (retire after evidence).

## Estimated savings

| Action | Est. monthly saving | One-time effort | Rollback cost |
|---|---|---|---|
| Retire ubuntu-4gb-fsn1-2 (after snapshot+quarantine) | ~EUR 7-9 | 1-2 owner hours (snapshot, quarantine, verify) | restore from snapshot (minutes; snapshot storage pennies/mo during window) |
| Retire gmail-dev-n8n after n8n integration (option b) | ~EUR 7-9 | integration proposals 2-4 first (engineering days), then 1-2 owner hours | restore snapshot + re-point DNS |
| Delete paused Supabase projects after export/migration | ~USD 0 (already paused) - value is risk reduction, not cash | export hours | restore from export |
| Domain consolidation (V8 ruling: one primary domain) | ~USD 1-3 | DNS planning | re-register risk: do NOT drop a domain that receives business email without a full audit |

Realistic near-term cash savings: ~EUR 7-9/month (one server),
rising to ~EUR 14-18/month (~EUR 170-215/year) after n8n
integration completes. CONFIDENCE: medium until packet F replaces
estimates with invoices. The larger value is risk reduction:
fewer unpatched public surfaces and no orphaned data stores.

## Rules honored

No exact prices invented as facts; unknowns marked; retirement
never precedes export/snapshot/quarantine; savings never justify
overloading the staging isolation boundary.
