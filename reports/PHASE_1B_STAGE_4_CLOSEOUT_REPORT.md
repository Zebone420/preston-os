# Phase 1B Stage 4 - Closeout Report

Status: CLOSEOUT. Files-only record of the owner-run Stage 4 validation
(owner login + live read-only Gmail/Calendar on the Vercel Preview
deployment). No production touched, no secrets handled, no live writes.

Baseline commit at validation: 86f27c2 (Preview build).
Preview URL: https://preston-os-staging-git-master-zebone420preston-os.vercel.app

## Part A - Owner login gate: PASS

Evidence (owner-observed, authenticated browser):
- /api/health returned {"ok":true,"mode":"connected"}.
- Owner reached the Preston OS dashboard; header shows CONNECTED - staging.
- No redirect bounce back to /login after login.

Code basis (read-only verification):
- apps/dashboard/src/lib/owner-auth.ts - fail-closed gate: setup mode when
  Supabase env absent; deny when OWNER_EMAIL_ALLOWLIST empty or email not
  listed; presence-only checks, no secret is read or logged.
- apps/dashboard/src/proxy.ts - thin adapter; all decisions in owner-auth.ts.

Env activation (owner-run, Preview scope only, values never seen by AI):
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY (anon/public only; service role never used)
- OWNER_EMAIL_ALLOWLIST (owner email; server-side only; no NEXT_PUBLIC copy)

Note on validation tooling: scripts/verify_stage4_owner_login.ps1 cannot
validate this Preview URL from an unauthenticated machine because Vercel
Deployment Protection (SSO) fronts the whole deployment - anonymous GETs
302 to vercel.com/sso-api. Owner in-browser evidence is authoritative here.

## Part B - Live read-only Google: Gmail PASS, Calendar PASS

Gmail: PASS.
- /brief Inbox summary heading showed source (google_readonly).
- Real Gmail items displayed (neutralized as untrusted data, CLAUDE.md r12).
- Recommendations rendered as INERT draft command packets only; no send.

Calendar: PASS.
- Owner confirmed the primary Google Calendar has no events, so the empty
  appointments list is the correct live result of a successful read.
- Historical caveat resolved: before this observability change, the
  appointments section rendered neither brief.calendar.source nor
  brief.calendar.note, so an empty list was ambiguous between "live, no
  events" and "silently blocked". Owner's calendar-empty fact removed the
  ambiguity for this run; the follow-up UI change (below) removes it
  permanently for future runs.

Live-path code basis: apps/dashboard/src/lib/google.ts - live read only when
GOOGLE_READONLY_LIVE_ENABLED === 'true' AND token + readonly scopes present;
otherwise mock or fail-closed throw. Read-only endpoints only; sendGmail and
writeCalendarEvent are hard-blocked.

## Follow-up shipped in this closeout (local, GREEN observability)

apps/dashboard/src/app/brief/page.tsx - the appointments section now renders
the calendar source label and any calendar note (e.g. a blocked/fail-closed
message), mirroring the existing Gmail section pattern. This makes future
Gmail/Calendar validation deterministic from the UI alone: a blocked
calendar read will now be visible instead of collapsing to a silent empty
list. No new Next.js API used; display-only change.

## Safety ledger

- Production touched: false
- Secrets exposed / values read: false / none
- Live emails sent: false
- Live messages sent (SMS/Telegram/Slack/Voice): false
- Live calendar/business-record writes: false
- SQL run: false
- n8n activated / remote runner activated: false / false

## Known open items (tracked to next gates, not part of Stage 4)

1. Approval Center: Supabase read returns "permission denied for table
   approvals" (Postgres GRANT/RLS-level). Owner-run SQL fix required;
   see the Supabase approvals diagnosis in the master status report.
2. Airtable sections show MOCK: AIRTABLE_TEST_PAT / AIRTABLE_TEST_BASE_ID
   not configured in Preview. Owner-run env activation required.

## Verdict

Phase 1B Stage 4: PASS (Part A owner login + Part B Gmail & Calendar live
read-only). Closed.
