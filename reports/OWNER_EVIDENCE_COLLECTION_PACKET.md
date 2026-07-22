# OWNER EVIDENCE COLLECTION PACKET (single consolidated gate)

Date: 2026-07-21. Everything below is READ-ONLY evidence
collection. Nothing asks you to change, delete, unpause, enable,
disable, rotate, or migrate anything. Skip any item you cannot do
safely and note why. Redaction rule for every item: never paste a
key, token, password, cookie, or connection string; names and
identifiers only.

## A. Phase 6 sign-out deployment evidence (5 min, browser)

1. Vercel: confirm the current staging deployment is Ready at
   commit e0609d3 (or later after you push this audit's commits).
2. Signed in: /business shows "Sign out" in the nav.
3. Click it: you land on /login; opening /business redirects back
   to /login; signing in again works.
Return: the commit hash + yes/no for each.
Stop condition: none (pure observation).

## B. Legacy GitHub repos (10 min, browser + your terminal)

1. Confirm whether Zebone420/preston-ai-andersen-graph and
   -vault are PRIVATE, RENAMED, or DELETED (they 404 anonymously
   as of today - expected if you made them private per Gate 0A).
2. If they exist: from YOUR terminal, clone each locally and drop
   the folders somewhere I can read (e.g.
   C:\dev\legacy-audit\andersen-graph and \andersen-vault).
   Do not copy them into C:\dev\preston-os.
3. Note for each: latest commit date, approximate size, and
   whether either contains anything you know to be sensitive.
Return: state of each repo + local paths if cloned.
Stop condition: if GitHub shows either repo deleted, say so -
that changes the data-recovery question for item D.

## C. n8n workflow exports (15 min, n8n UI - NO API key needed)

1. Log into https://automation.prestonwd.com (note the n8n
   version from the UI footer/settings while there).
2. For each of the 7 workflows: open it -> menu -> Download
   (exports JSON WITHOUT credential secrets; credential NAMES/ids
   remain, which is fine). Save all 7 files to
   C:\dev\legacy-audit\n8n\.
3. For each workflow, note from the UI: Active toggle state, and
   from Executions: last run date + success/failure.
4. Settings -> Credentials: list the credential NAMES and types
   only (e.g. "Gmail account - OAuth2", "Airtable - token").
Return: 7 JSON paths + the active/last-run table + credential
name list + n8n version.
Stop condition: do NOT toggle any Active switch; do NOT delete
anything; if the login fails, report that (it changes the
security finding S1 urgency).

## D. Supabase paused projects (10 min, dashboard only - NO unpause, NO SQL)

For preston-ai-andersen and preston-ai-pathc-dev, from each
project's dashboard WITHOUT unpausing:
1. Paused-since date, plan/tier, any retention/expiry warning
   banner (IMPORTANT - if a deletion-countdown warning shows,
   flag it immediately; export urgency depends on it).
2. Database size and storage size as displayed.
3. If the dashboard offers a backup/export download while paused,
   download one backup of preston-ai-andersen to
   C:\dev\legacy-audit\supabase\ (this is a read-only export).
   If it requires unpausing - STOP and just report that.
4. For preston-os-staging: plan/tier and backup setting only.
Return: the metadata per project + backup path if obtained.
Stop condition: anything that requires unpausing or running SQL.

## E. Hetzner read-only enumeration (20 min, SSH)

Run the read-only command set from
reports/HETZNER_SERVER_AUDIT.md ("Packet E - read-only command
set") on each of the three servers; paste the outputs per server
into C:\dev\legacy-audit\hetzner\<hostname>.txt. The commands
print no secret values; the find command prints env-file PATHS
only - do not cat env files.
Also note per server (Hetzner console): creation date, snapshot
count, backup setting.
Return: the three output files + console notes.
Stop condition: any command that would prompt to install or
modify - skip it and note it.

## F. DNS + billing (10 min, registrar + consoles)

1. DNS: A/CNAME records for automation.prestonwd.com (confirm
   which IP it points at), plus any records pointing at
   159.69.118.154 or 188.245.80.146; note where preston.nyc MX
   (email) is hosted.
2. Billing (amounts only, no card data): current monthly Hetzner
   invoice total + per-server lines if shown; Supabase plan/costs;
   Vercel plan; both domains' renewal prices; Airtable plan.
Return: record list + a simple cost table.
Stop condition: none (pure reads).

## After you return this packet

I will: sweep any exports with the repo scanners, run the
adversarial deletion-safety re-audit against the real evidence,
update the inventory/dependency map dispositions, finalize the
integration proposals with real workflow logic, and produce the
signed-off version of ASSET_RETIREMENT_OWNER_PACKET.md with exact
per-asset approval text. Nothing is retired before that.
