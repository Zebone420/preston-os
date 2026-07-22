# BATCHED OWNER EVIDENCE PACKET - SESSIONS A-D (Items 2-7)

Date: 2026-07-21. Supersedes the per-item ordering of
OWNER_EVIDENCE_COLLECTION_PACKET_V2.md (whose Item 1 is PARTIAL -
complete; its remaining items are regrouped here into four owner
sessions). Collect everything, in any session order, without
returning between items; Claude processes whatever lands in
C:\dev\legacy-audit\ as soon as you say a session is done.

Global rules (every session): read-only; change nothing; share no
key/token/password/cookie/connection string/card data/client PII
- names, identifiers, dates, sizes, counts, amounts only. If a
step is blocked or looks unsafe: skip it, note why, continue.

TIME-SENSITIVITY NOTE: no session below is hard-deadlined, but
the separate paused-Supabase decision (unpause+export gate,
reports/SUPABASE_PAUSED_DECISION_BRIEF.md) references deadlines
of 23/28 Sep 2026 - Sessions A and B improve that decision, so
sooner is better.

---

## SESSION A - GitHub + local clones (~10 min) [REQUIRED]

A1. Purpose: confirm repo states; obtain read-only clones for
    content audit, secret sweep, and knowledge-layer inventory.
    URL: github.com/Zebone420/preston-ai-andersen-graph and
    github.com/Zebone420/preston-ai-andersen-vault (signed in).
    Evidence: per repo - private/renamed/deleted, default branch,
    latest commit date, approximate size. Write into
    C:\dev\legacy-audit\github\repo-states.txt (free text).
A2. If they exist, from YOUR terminal:
      git clone https://github.com/Zebone420/preston-ai-andersen-graph C:\dev\legacy-audit\github\andersen-graph
      git clone https://github.com/Zebone420/preston-ai-andersen-vault C:\dev\legacy-audit\github\andersen-vault
    Output location: exactly those folders.
    Stop condition: a repo shows DELETED -> note it prominently
    (raises the paused-Supabase export priority) and continue.
    Must not change: repo settings, visibility, archive flags.
    Claude use: scanner sweep both clones; inventory ontology,
    ingestion code, vault contents + licensing; fill registers;
    finalize ARCHIVE steps; feed Knowledge Layer source inventory.
    Status: REQUIRED.

## SESSION B - n8n UI + workflow exports (~15 min) [REQUIRED]

B1. Purpose: capture automation estate + security posture.
    URL: https://automation.prestonwd.com (normal login; note if
    login page demanded 2FA).
    Evidence: n8n VERSION (Settings/About or footer) ->
    C:\dev\legacy-audit\n8n\notes.txt (template already there).
B2. For each of the 7 workflows: open -> Download -> save JSON to
    C:\dev\legacy-audit\n8n\ (exports exclude credential
    secrets; credential NAMES remain - expected).
B3. Per workflow into notes.txt: Active toggle state (LOOK, do
    not touch), last execution date + status from Executions.
B4. Credentials page: credential NAMES + TYPES only ->
    C:\dev\legacy-audit\credentials\n8n-credential-names.txt.
B5. Settings -> API: does an API key exist? yes/no only.
    Stop conditions: do NOT toggle Active; do NOT delete; decline
    any upgrade/migrate/re-authorize prompt and note it.
    Must not share: any credential value, cookie, or the API key
    itself.
    Claude use: secret-sweep the JSONs BEFORE analysis; map
    triggers/webhooks/sends per workflow; score LA-1 (version vs
    current); extract EXT-3/EXT-4/PM-1 logic for integration and
    WF-1/WF-3 design for the knowledge layer; fill the credential
    register; finalize workflow dispositions.
    Status: REQUIRED. B5 optional if hard to find.

## SESSION C - Hetzner SSH + console (~20 min) [REQUIRED]

C1. Purpose: enumerate what actually runs where; baseline the
    staging host; ground the ubuntu-4gb-fsn1-2 retirement case;
    confirm/deny gmail-dev-n8n hosts the n8n instance.
    Command set: reports/HETZNER_SERVER_AUDIT.md "Packet E"
    (read-only; prints no secret values; the find prints env-file
    PATHS only - never cat an env file).
    Output: C:\dev\legacy-audit\hetzner\<hostname>.txt per server
    (preston-agent-staging, gmail-dev-n8n, ubuntu-4gb-fsn1-2).
C2. Hetzner console (read-only) per server: creation date,
    snapshot count, backup setting -> append to each file.
    Stop conditions: skip any command that errors or prompts to
    install/modify; do not restart/stop/reconfigure anything.
    Claude use: fill dependency matrix (services, ports, cron,
    volumes, repos); verify no hidden staging->legacy
    dependency; populate the ubuntu-4gb-fsn1-2 retirement
    checklist; identify n8n DB/volume backup surface.
    Status: REQUIRED. ubuntu-4gb-fsn1-2 is the highest-value
    single file if time is short.

## SESSION D - DNS + billing + credential names (~15 min) [REQUIRED]

D1. DNS: registrar/DNS console for prestonwd.com: full record
    list - specifically automation.prestonwd.com target, ANY
    record pointing at 159.69.118.154 or 188.245.80.146, MX
    records. Same quick pass for preston.nyc (where does
    info@preston.nyc email live - identity-critical).
    Output: C:\dev\legacy-audit\dns\records.txt (template ready).
    Must not change: any record.
D2. Billing (amounts + plan names only): Hetzner monthly total +
    per-server lines + snapshot surcharges; Supabase; Vercel;
    both domains' renewals; Airtable; Google Workspace/email.
    Output: C:\dev\legacy-audit\billing\costs.txt (template).
    Must not share: card data, invoice addresses.
D3. Credential-reference inventory (NAMES/locations only):
    1Password entries for all Preston systems; the n8n credential
    names from B4; SSH key names per server; anything NOT in
    1Password (loose .env files, keys in notes) - flag those.
    Output: C:\dev\legacy-audit\credentials\inventory.txt.
    Claude use: D1 closes/blocks the ubuntu retirement DNS check
    and protects email; D2 finalizes the cost worksheet and
    savings; D3 becomes the Credential Reference Register with
    per-asset revocation lines.
    Status: REQUIRED (D2 partial is fine - Hetzner lines matter
    most).

---

## Return protocol

Reply per session: "SESSION X DONE/PARTIAL/BLOCKED" + any notes.
Claude then, without further prompts: sweeps everything with
scanners, fills all registers, re-runs the adversarial
retirement-safety audit with real evidence, updates dispositions,
finalizes the cost table, upgrades the paused-Supabase decision
brief, and issues any retirement approvals that pass all 17
checks - or documents exactly why they stay blocked.
