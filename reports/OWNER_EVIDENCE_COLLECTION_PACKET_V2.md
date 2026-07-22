# OWNER EVIDENCE COLLECTION PACKET V2 (ordered, read-only)

Date: 2026-07-21. Supersedes V1 (item A is complete - sign-out
evidence archived in the Phase 6 binder S7). Everything below is
READ-ONLY observation and export. Nothing changes, unpauses,
enables, disables, rotates, or deletes anything. Total owner time
estimate: 60-80 minutes, in five sittings if preferred.

Global rules for every item:
- MUST NOT SHARE: keys, tokens, passwords, cookies, headers,
  connection strings, card data, client PII. Names, identifiers,
  dates, sizes, and counts only.
- MUST NOT CHANGE: any toggle, setting, DNS record, plan, or
  file on any external system.
- Landing zone: C:\dev\legacy-audit\ (see
  evidence-intake/README.md for the folder layout). Nothing goes
  into C:\dev\preston-os directly - git now ignores evidence
  shapes as a backstop, but keep raw evidence out of the repo.
- If any step errors or looks unsafe: stop that step, note what
  you saw, continue with the next system.

Ordered by system to minimize context switching. Items D and the
D-flag are the only TIME-SENSITIVE parts - do them first.

## 1 (item D) - Supabase paused projects - STATUS: PARTIAL
## (metadata DONE 2026-07-21; exports blocked: require unpause)

Owner evidence received and reconciled (registers updated).
Remaining for item 1: nothing the owner can do read-only. The
exports now depend on a separate UNPAUSE-AND-EXPORT owner gate
(both projects: "requires unpause"), which must be scheduled
before the resume deadlines - preston-ai-pathc-dev 23 Sep 2026,
preston-ai-andersen 28 Sep 2026. That gate will be issued as its
own packet after items 2-3 return (workflow/repo evidence may
change what needs exporting). Original instructions retained
below for reference.

## 1-ORIGINAL (item D) - Supabase paused projects (~10 min, dashboard only)

Purpose: establish whether unique data exists, its size, and any
retention countdown BEFORE any other decision; capture staging
plan facts.
Steps (per paused project preston-ai-andersen and
preston-ai-pathc-dev; NO unpause, NO SQL):
  a. Project overview: note paused-since date, plan/tier, and
     ESPECIALLY any retention/expiry/deletion-countdown banner.
  b. Note displayed database size and storage size.
  c. If a backup/export can be downloaded WITHOUT unpausing:
     download one for each project to
     C:\dev\legacy-audit\supabase\. If it demands unpausing,
     STOP that sub-step and note it.
  d. preston-os-staging: note plan/tier and backup setting only.
Expected evidence: per-project metadata lines + backup file
paths (or "requires unpause").
Stop condition: anything that offers to unpause, restore, or
modify - decline and note.
Claude will use it to: set export urgency, fill the Backup and
Restore Evidence register, and gate the preston-ai-pathc-dev and
preston-ai-andersen retirement rows.

## 2 (item B) - GitHub legacy repositories (~10 min)

Purpose: confirm private-vs-renamed-vs-deleted; obtain read-only
clones for content audit and knowledge-layer planning.
Steps:
  a. github.com signed in: check Zebone420/preston-ai-andersen-
     graph and -vault (both 404 anonymously today).
  b. If they exist: from YOUR terminal:
       git clone <repo-url> C:\dev\legacy-audit\github\andersen-graph
       git clone <repo-url> C:\dev\legacy-audit\github\andersen-vault
  c. Note per repo: private/renamed/deleted, default branch,
     latest commit date, approximate size, anything you already
     know to be sensitive inside.
Expected evidence: two state lines + local clone paths.
Stop condition: if either repo is DELETED on GitHub, say so
immediately - recovery then depends on item 1's exports.
Claude will use it to: run the repo scanners over the clones,
inventory graph schema/vault contents, finish the GitHub audit,
and finalize the ARCHIVE steps.

## 3 (item C) - n8n instance and workflows (~15 min, UI only)

Purpose: capture the automation estate and its security posture;
obtain the workflow logic for the integration proposals.
Steps at https://automation.prestonwd.com (log in normally):
  a. Note the n8n VERSION (Settings or footer) and whether 2FA
     is enabled for your account.
  b. For each of the 7 workflows: open -> Download (this export
     EXCLUDES credential secrets; credential names remain) ->
     save to C:\dev\legacy-audit\n8n\.
  c. Per workflow note: Active toggle state (do NOT touch it),
     last execution date + status from Executions.
  d. Credentials page: write down credential NAMES and TYPES only
     (e.g. "Gmail OAuth2 - <label>", "Airtable token - <label>")
     into C:\dev\legacy-audit\credentials\n8n-credential-names.txt.
  e. Settings -> API: note whether an API key currently EXISTS
     (yes/no only - do not create one, do not copy it).
Expected evidence: 7 JSON files, version string, active/last-run
table, credential-name list, API-key yes/no.
Stop condition: any prompt to update, migrate, or re-authorize
anything - decline and note. Do NOT toggle Active. Do NOT delete.
Claude will use it to: score security finding LA-1 (version vs
current), map workflow->credential->system dependencies, extract
EXT-3/EXT-4/PM-1 logic for integration, fill the Credential
Reference Register, and gate workflow dispositions.

## 4 (item E) - Hetzner servers (~20 min, SSH read-only)

Purpose: enumerate what actually runs on each server; baseline
the staging host; ground the ubuntu-4gb-fsn1-2 retirement case.
Steps per server (preston-agent-staging, gmail-dev-n8n,
ubuntu-4gb-fsn1-2) - the exact read-only command set is in
reports/HETZNER_SERVER_AUDIT.md "Packet E"; capture output to
C:\dev\legacy-audit\hetzner\<hostname>.txt. Commands print no
secret values; the env-file find prints PATHS only - never cat an
env file.
Also from the Hetzner console (read-only): per server creation
date, snapshot count, backup setting; note (do not screenshot
card data) the monthly price lines for item 6.
Expected evidence: three text files + console notes.
Stop condition: any command that prompts to install or modify -
skip and note. Do not restart, stop, or reconfigure anything.
Claude will use it to: fill the Dependency Verification Matrix
rows (processes, ports, cron, data), confirm/deny the
gmail-dev-n8n = automation host inference, and populate the
retirement checklist for ubuntu-4gb-fsn1-2.

## 5 (item F) - DNS and domains (~5 min, registrar/DNS console)

Purpose: prove which hosts are reachable by name; protect email.
Steps:
  a. List DNS records for prestonwd.com - specifically the
     automation.prestonwd.com A/CNAME target, any record pointing
     at 159.69.118.154 or 188.245.80.146, and MX records.
  b. Same quick pass for preston.nyc (where is MX/email hosted -
     the owner login identity depends on this mailbox).
  c. Note both domains' renewal dates and prices.
Expected evidence: record list (name, type, target only) saved to
C:\dev\legacy-audit\dns\records.txt.
Stop condition: none (pure reads). Change nothing.
Claude will use it to: finalize domain->server edges, clear or
block the ubuntu-4gb-fsn1-2 deletion path, and protect the
preston.nyc email dependency in every retirement plan.

## 6 (item F-cost) - Billing (~5 min)

Purpose: replace cost ESTIMATES with real numbers.
Steps: from Hetzner, Supabase, Vercel, registrar, and Airtable
billing pages, note plan names and monthly/annual amounts only
into C:\dev\legacy-audit\billing\costs.txt (text preferred over
screenshots; if screenshots, crop out card/invoice-address data).
Expected evidence: one cost table.
Stop condition: none. Share amounts, never payment details.
Claude will use it to: complete
reports/COST_EVIDENCE_WORKSHEET.md and finalize savings numbers.

## 7 (item G) - Credential-reference inventory (~10 min, names only)

Purpose: a complete map of WHERE credentials exist, so retirement
steps revoke the right things - without ever exposing a value.
Steps: list into C:\dev\legacy-audit\credentials\inventory.txt,
as "system | credential name/label | where stored | last known
use" lines:
  a. 1Password entries related to: Preston OS, n8n, Hetzner,
     Supabase (all three projects), Vercel, Airtable, Google
     OAuth, Telegram, GitHub, registrars.
  b. The n8n credential names from item 3d (copy the list).
  c. Any SSH keys per server (names/paths only, from item 4's
     authorized_keys line counts if visible).
  d. Anything you remember existing that is NOT in 1Password
     (loose .env files on old machines, keys in old notes) -
     flag those specially.
Expected evidence: the inventory file. NO VALUES.
Stop condition: if listing something would require opening/
copying a secret value, list only its label.
Claude will use it to: fill
reports/CREDENTIAL_REFERENCE_REGISTER_TEMPLATE.md into a real
register, find abandoned/overbroad credentials, and attach exact
revocation lines to each retirement step.

## Return format

Reply with, per item 1-7: DONE/PARTIAL/BLOCKED + the file paths
under C:\dev\legacy-audit\ + any notes. I will then sanitize,
sweep with scanners, fill the registers, run the adversarial
retirement-safety audit, and produce the executable retirement
approvals for anything that survives it.
