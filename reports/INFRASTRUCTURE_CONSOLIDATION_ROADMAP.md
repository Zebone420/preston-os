# INFRASTRUCTURE CONSOLIDATION ROADMAP (incl. Legacy Archive Plan)

Date: 2026-07-21 (Round 1 - evidence-gated milestones marked).
Target end-state (minimum footprint that preserves all value):

- 1x Hetzner server (preston-agent-staging)
- Supabase preston-os-staging (backed up per LA-10 decision)
- Vercel staging project
- GitHub: preston-os active + two Andersen repos ARCHIVED private
- preston.nyc identity (email protected)
- Airtable TEST base (until the intake gate replaces it)
- prestonwd.com only if the owner keeps it for brand/email
- Evidence + export archive (owner storage)

## Waves (dependency-ordered)

W0 - NOW (owner, no engineering): Sessions A-D evidence; first
manual staging export (backup brief step 2); decide the paused-
Supabase gate date (brief: decide by 08-01, execute by 08-15).

W1 - EVIDENCE CLOSE (Claude, after sessions): Round-2 retirement
audit; final dispositions; real cost table; upgraded briefs.
Exit: every asset either RETAIN/ARCHIVE-ready or an approval-
ready deletion packet.

W2 - SAFETY + ARCHIVE (owner, small steps): n8n hardening
(update, 2FA, webhook review) OR accepted-risk note; GitHub
archive flags on both Andersen repos (post-export); paused-
project resume/export/re-pause session; staging backup option
enacted. Legacy Archive Plan detail: clones + workflow JSONs +
Supabase exports + server data exports all land in owner archive
storage with the backup register rows completed and one
test-restore per class.

W3 - INTEGRATION (Claude engineering gates): P-2/P-3 rule
integrations (EXT-3/EXT-4 logic -> recommendations), P-4 unique
monitoring checks, Andersen Knowledge Layer G2-G5 (plan v2).
Exit: legacy workflow logic is owner-verified inside Preston OS.

W4 - RETIREMENT (owner, per approval packets): My workflow ->
preston-ai-pathc-dev -> ubuntu-4gb-fsn1-2 (snapshot + power-off
quarantine 14-30d first) -> preston-ai-andersen (after G6 parity)
-> gmail-dev-n8n ONLY under consolidation option (b) after W3
proves parity (else harden+rename and RETAIN). Credential
revocations ride each step (credential register lifecycle lines).

W5 - CLOSE: asset register final update; savings confirmed
against invoices; consolidation program closed; remaining estate
= the target end-state above.

## Consolidation decision points (owner)

D-1 n8n future: (a) keep hardened on gmail-dev-n8n vs (b) retire
after W3 integration parity vs (c) migrate n8n onto the staging
host - (c) is NOT recommended (staging isolation boundary).
D-2 prestonwd.com: keep for brand/email vs consolidate to
preston.nyc after the V8 ruling and MX evidence.
D-3 staging backup option (brief issued; default hybrid 4) -
UPDATED 2026-07-22: preferred resolution is now the paid-org
TRANSFER (conditional; reports/SUPABASE_TRANSFER_DECISION_BRIEF
.md) with the pg_dump kept as off-platform copy; Option B stands
as the fallback if any Gate 0 condition fails.
D-4 (new) paid-org transfer Gate 0-7 execution window - owner
schedules; fits inside W0/W2.

## Savings trajectory (ESTIMATES until D2 billing evidence)

W4 completion: -EUR 7-9/mo (ubuntu) and, under D-1(b), a further
-EUR 7-9/mo (gmail-dev-n8n) => ~EUR 170-215/yr total; plus risk
reduction (unpatched public surfaces removed, orphaned data
stores eliminated) which is the larger real value.
