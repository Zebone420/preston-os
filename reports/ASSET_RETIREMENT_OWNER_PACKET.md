# ASSET RETIREMENT OWNER PACKET (template - NOT yet executable)

Date: 2026-07-21. STATUS: DRAFT/CONDITIONAL. This packet becomes
executable only after reports/OWNER_EVIDENCE_COLLECTION_PACKET.md
returns and the adversarial deletion-safety re-audit passes per
asset. No step below is approved yet; nothing has been retired.

## Lifecycle applied to every asset

inventory -> export -> snapshot -> archive -> pause/disable ->
observe 14-30 days -> verify no dependency -> owner approval
(exact text below) -> delete -> revoke credentials -> update
reports/LEGACY_ASSET_INVENTORY.md.

## R1. n8n "My workflow"

Preconditions: packet C export archived; execution history shows
no meaningful runs; no credentials referenced.
Steps: (already exported) -> owner deletes the workflow in the
n8n UI -> update register.
Approval text: "OWNER APPROVES deletion of n8n workflow 'My
workflow' (export archived at <path>, zero executions verified,
date ____)."
Rollback: re-import the exported JSON. Savings: none (hygiene).

## R2. Supabase preston-ai-pathc-dev

Preconditions: packet D metadata + export backup archived; owner
states origin ("typo project", "abandoned experiment", etc.);
14-30 days elapsed since export with no surprise dependency.
Steps: owner deletes the project in the Supabase dashboard ->
update register.
Approval text: "OWNER APPROVES deletion of Supabase project
preston-ai-pathc-dev (export at <path>, origin: ____, quarantine
ended ____)."
Rollback: restore export into a fresh project. Savings: ~0 cash;
removes an orphaned data store.

## R3. Hetzner ubuntu-4gb-fsn1-2

Preconditions: packet E enumeration reviewed; any repos/data
found are exported; packet F shows no DNS points at
159.69.118.154; full snapshot taken; server POWERED OFF (owner
action, explicitly approved at that moment - power-off is the
pause step of the lifecycle, not deletion) for 14-30 days with
no breakage anywhere.
Steps after quarantine: owner deletes the server; keeps the
snapshot 30 more days; then deletes the snapshot; revokes any
SSH keys/credentials that existed only for this host.
Approval text: "OWNER APPROVES deletion of Hetzner server
ubuntu-4gb-fsn1-2 (snapshot <id> taken ____, quarantine
____ to ____, no dependency observed)."
Rollback: rebuild from snapshot. Savings: ~EUR 7-9/mo (EST).

## R4. Supabase preston-ai-andersen (post-integration only)

Preconditions: P-1 knowledge layer merged and owner-verified;
parity check (row counts + spot-check content) documented; export
retained permanently as the raw backup.
Approval text: "OWNER APPROVES deletion of Supabase project
preston-ai-andersen (knowledge layer parity verified ____, export
at <path>)."
Rollback: restore export. Savings: ~0 cash; risk reduction.

## R5. GitHub Andersen repos - ARCHIVE ONLY (no deletion proposed)

Steps: owner sets both repos to Archived (read-only) after the
packet B export; they stay private. No approval text for deletion
exists in this packet by design.

## R6. gmail-dev-n8n server (consolidation option b only)

Preconditions: proposals P-2/P-3/P-4 merged with owner-verified
parity; remaining wanted workflows migrated or retired; n8n DB
volume snapshot + workflow exports archived; DNS
automation.prestonwd.com unpointed (owner DNS action, its own
approval); quarantine.
Approval text: "OWNER APPROVES deletion of Hetzner server
gmail-dev-n8n and revocation of all n8n-stored credentials
(exports at <path>, snapshot <id>, DNS unpointed ____,
quarantine ____ to ____)."
Rollback: snapshot restore + DNS re-point. Savings: ~EUR 7-9/mo
(EST). If option (a) is chosen instead: this section is replaced
by a harden+rename runbook (updates, firewall, 2FA, non-dev
hostname) and the server moves to RETAIN.

## Explicitly retained (no retirement path in this packet)

preston-os; preston-os-staging (Supabase + Vercel);
preston-agent-staging; preston.nyc; Airtable TEST base;
prestonwd.com while automation DNS lives there.
