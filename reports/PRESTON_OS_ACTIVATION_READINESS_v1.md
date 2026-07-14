# Preston OS - Activation Readiness v1

Purpose: single source of truth for where the staging build stands, what is
engineering-complete vs owner-activation-pending, the security posture, known
limitations, and the exact remaining owner-run steps. Staging/Preview only.
Production untouched throughout.

Truthful completion framing:
- Engineering (staging code): COMPLETE for all safely discoverable work below.
- Staging readiness: READY.
- Activation readiness: READY, gated on explicit owner-run steps.
- Production / remote-live activation: NOT started (by design; owner-gated).

Baseline: origin/master 7fd12d2 + local commits f39d947 (durable OAuth) and
the docs commit that adds this file. AI cannot push (guard H-6); owner pushes.

## 1. Stage status

| Stage | Scope | Result |
|-------|-------|--------|
| 4 | Owner login + read-only Gmail/Calendar | PASS |
| 5 | Supabase approvals read path (grant select, owner RLS) | PASS |
| 6 | Airtable TEST activation (read-only, TEST base) | PASS |
| 7 | Dashboard field-name mapping + clean dates + id-safe | PASS |
| 8 | Approval Center write path (decision + audit, no execution) | PASS |
| 9 | Durable read-only Google OAuth (refresh token) | CODE DONE, owner-activation pending |

## 2. Security assessment (staging)

Mitigated / verified in code:
- AuthN: Supabase Auth password login; single owner user; no signup flow.
- AuthZ: OWNER_EMAIL_ALLOWLIST (server-only, never NEXT_PUBLIC); proxy gate
  fail-closed (setup/login/deny); Server Action re-checks owner before any
  write (defense in depth over proxy + RLS).
- RLS: owner-only policies via is_owner() (0002); audit_log/access_events
  append-only; owners allowlist table.
- Grants: authenticated has only select+update on approvals and insert on
  audit_log; nothing granted to anon; no service-role key in the app.
- Secret handling: repo holds env NAMES only (env.template); guard H-4 blocks
  .env* writes; tokens/PAT live in Vercel only; no secret is logged (google
  errors carry HTTP status only, never a token).
- Client/server split: only Supabase URL + anon key are NEXT_PUBLIC (safe
  public values); allowlist, PAT, and OAuth tokens are server-only.
- Injection defense: all external content (Gmail/Calendar/Airtable text) is
  neutralized (neutralizeUntrusted) and treated as data, never instruction
  (CLAUDE.md r12); tested with control-char fixtures.
- SSRF surface: Airtable base allowlist guard (assertAirtableTestOnly);
  Google API endpoints hardcoded; token endpoint defaults to Google
  (override is test-only via env).
- Open redirect: proxy redirects only to internal '/login' or '/'.
- Fail-open: none found - every adapter fails closed (mock or throw).
- Transport: Vercel Deployment Protection (SSO) fronts the Preview.

Residual / owner-run or future (not staging-blocking):
- Refresh token stored in Vercel env: acceptable for single-owner staging; a
  production/remote path should use a dedicated least-privilege identity and
  encrypted server-side storage (see section 6).
- No app-level rate limiting (single owner behind SSO; low risk on staging).
- Dependency audit not run this session - recommend `npm audit` in CI as an
  owner/CI step (no production dependency change made here).
- OAuth Playground token provenance: owner must use read-only scopes only.

Confirmations: production untouched (true); live writes performed (false);
secrets exposed (false); service-role key in app (false).

## 3. Known limitations

- Stage 9 durable OAuth is implemented but INACTIVE until the owner
  provisions the refresh-token config; until then the legacy access token
  expires ~1h and /brief shows blocked (401) when stale.
- Approval Center is control-plane ONLY - there is no execution layer yet;
  approving a row records a decision and executes nothing (by design).
- Remote runner and Hermes are disabled by design; not activated.
- Airtable card display depends on real field names matching the Stage 7
  priority lists; a non-matching field falls back to "(untitled record)" -
  tune CARD_FIELDS if a card falls back.
- Tests never touch real Google/Airtable/Supabase/production credentials
  (all injected mocks) - CI is credential-free.

## 4. Remaining owner-run actions (exact order)

1. Push local commits (guard H-6 blocks the AI):
   Command: `git push origin master` (owner's terminal, or `! git push origin master`).
   Expected: origin/master advances to the latest local commit; Vercel Preview rebuilds.
   Rollback: none needed; to undo, `git revert <hash>` (owner).
   Verify: `git log --oneline origin/master..HEAD` is empty after push.

2. Stage 8 (optional) - reject-path validation / cleanup:
   Per PHASE_1B_STAGE_8_APPROVAL_WRITE_PATH_OWNER_SQL_PACKET.md verification.
   Expected: a rejected test row + audit action approval_decision:rejected.
   Rollback: `delete from public.approvals where requested_action like 'TEST -%';`
   Verify: decision=rejected; audit row present; nothing executed.

3. Stage 9 - durable Google OAuth activation:
   Per PHASE_1B_STAGE_9_DURABLE_GOOGLE_OAUTH_ACTIVATION_PACKET.md.
   Expected: /brief header shows "google: refresh_token"; sections stay
   google_readonly past 1 hour.
   Rollback: re-set a GOOGLE_OAUTH_ACCESS_TOKEN (wins) or clear the refresh
   token (fails closed).
   Verify: reload /brief after >1h with no 401.

4. Optional - dependency review: run `npm audit` (or CI) and review.

## 5. Activation checklist (staging-live, read-only)

- [ ] Owner login works (PASS).
- [ ] /brief live read-only Gmail + Calendar (PASS; durable via Stage 9).
- [ ] Dashboard cards show AIRTABLE TEST/DEV with clean fields (PASS).
- [ ] Approval Center reads rows and records decisions, executes nothing (PASS).
- [ ] No production, no live sends/writes, no service-role key in app (PASS).
- [ ] Push latest commits (owner).
- [ ] Stage 9 durable OAuth activated (owner) - ends 1h re-mint.

## 6. Rollback checklist

- Google durable path: re-add access token (wins) or clear refresh token
  (fails closed to blocked). No DB/prod change.
- Airtable: remove the AIRTABLE_TEST_* Preview vars -> cards revert to MOCK.
- Supabase grants: `revoke update on public.approvals from authenticated;`
  `revoke insert on public.audit_log from authenticated;` (reads still work
  with select). `revoke select ...` returns to permission-denied (no leak).
- Code: `git revert <hash>` for any commit; tests guard regressions.
- All rollbacks are non-destructive; no business data is deleted.

## 7. Remote-live readiness (assessment; NOT activated)

Already scaffolded (disabled-by-default, fail-closed):
- lib/remote-control.ts: runner disabled by default, OWNER_STOP kill switch,
  heartbeat, max-runtime, rollback, dry-run simulator (Phase 4).
- reports/PHASE_5_REMOTE_DRILL_RUNBOOK.md: owner-run staging drill;
  PHASE_5_EVIDENCE_BINDER_TEMPLATE.md for attestation.

Remaining before a laptop-closed remote job can safely run (all owner-gated):
- A dedicated least-privilege identity for unattended Google/Supabase access
  (NOT the owner's personal OAuth); encrypted server-side token storage.
- A durable job queue + owner approval gate binding (Approval Center ->
  execution-intent -> guarded runner) with idempotency and retry limits.
- Execution-intent layer (see below) implemented and adversarially tested,
  with all real adapters still fail-closed.
- Staging-only activation drill executed per the Phase 5 runbook, with kill
  switch + heartbeat + timeout verified, then an owner attestation.

Recommended next engineering gate (GREEN, non-activating): design and stub
the execution-intent architecture separating requested action -> approval
decision -> execution eligibility -> execution intent -> attempt -> result ->
rollback -> audit, with typed contracts and fail-closed disabled adapters
plus adversarial tests. Nothing executes by default.

## 8. Engineering grade

Staging build: A-. Fail-closed everywhere, owner-only, injection-neutralized,
credential-free tests, clean typed adapters. Deductions are for
not-yet-built (by design) execution-intent + remote least-privilege identity,
and an un-run dependency audit - all tracked above, none staging-blocking.
