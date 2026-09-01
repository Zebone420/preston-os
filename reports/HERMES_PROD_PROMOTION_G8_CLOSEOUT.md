# Hermes Production Promotion - G-8 Closeout (2026-09-01)

Verdict: HERMES PRODUCTION PROMOTION SEALED (one archival note, N-1).
The primary local Hermes dashboard (127.0.0.1:9119) is PRODUCTION-
linked; staging remains available as an isolated secondary profile
(port 9121 launcher, own client id and token store).

## Gate results G-1..G-7

G-1 PASS - merge to master. Preconditions verified fail-closed via
ls-remote (master 10e54e0, branch 2d447d5); FAST-FORWARD merge (no
merge commit; master landed on the audited SHA); secret + RED scans
0/0 on the merged tree before push; master pushed. Remote verified:
refs/heads/master = 2d447d52077719c76dd2d611958d3e774abb5b4a.
11 hermes-native commits incorporated (44 files, +7710/-26).

G-2 PASS - production deployment (automatic). The master push
auto-built preston-os-prod deployment aVkuD6stLsZR2P9tBz3y2TodwWVD
(Ready 31s, source master@2d447d5, alias preston-os-prod.vercel.app).
No explicit deploy needed. Probe: /api/health 200; every control
read and write 401 missing_token/invalid_token unauth and with a
garbage bearer; HERMES env search = no results; prod auth project
had exactly the GPT(prod) + MCP(prod) OAuth clients.

G-3 PASS - dedicated production OAuth client (owner-created):
  Name: Preston Control - Hermes Production
  Client id: 957b8592-61cd-4f4d-98cc-3c057ba515ac (non-secret)
  Type: Confidential; token endpoint auth: client_secret_basic
  Redirect URI: http://127.0.0.1:9127/callback (RFC 8252 loopback)
  Created 1 Sep 2026; secret held in 1Password only.

G-4 PASS - production environment change (the ONLY prod env change):
PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID (Config type, Production
scope) added to Vercel preston-os-prod; cache-unchecked redeploy
EmHpF6dddoAHHZxrugLhJKGfNz9b (Ready 44s, Current, master@2d447d5).
Post-redeploy probe unchanged: health 200, all routes fail-closed.

G-5 PASS - Site URL / consent path (read-only verification):
OAuth Server ENABLED; Site URL = https://preston-os-prod.vercel.app
(canonical alias - the staging client_not_allowed failure mode is
absent); Authorization Path /oauth/consent; preview authorization
URL resolves to the prod alias serving the hermes-aware deployment;
dynamic OAuth apps OFF. Token endpoint:
https://hiqsymsiwonmvrbbqhhe.supabase.co/auth/v1/oauth/token.
Note: prod Redirect URLs allowlist is empty (unused by this flow).

G-6 PASS - production bootstrap (owner-run): authorization-code +
PKCE consent completed as the owner against the prod app; store
seeded at %LOCALAPPDATA%\hermes\preston-link\token-store.prod.json
(prod-dedicated; staging store untouched). Secret never persisted -
prod launches prompt for it hidden, per launch.

G-7 PASS - full production validation:
- Seven reads PASS: direct status read 200 with the prod hermes
  token; all seven ops proven live by the rendered dashboard
  (status/goal/job/approvals/events/evidence/artifact).
- Four writes PASS: with the REAL prod hermes token, submit,
  follow-up, decision, cancel ALL returned 403 wrong_client.
- Rotation: prod store carries rotated refresh (sha prefix
  a3bb875d) + access token minted post-bootstrap (fresh_for_s=3277
  at check) - refresh -> rotation capture -> atomic persist ->
  serve proven by operational continuity through validation.
  Staging live pair for the identical code path: 916f6eaa ->
  02973e67. See note N-1.
- Fail-closed drill: prod store renamed -> UI showed ONLY
  "Preston status unreadable: token_store_missing", zero stale
  data, zero notifications, no cursor reset; restore -> immediate
  full live recovery.
- Production dashboard (9119): env production, posture operating,
  2 BLACK approvals display-only, 2 historical dead letters with
  terminal reasons, diagnostics unmapped 0. A real prod job
  (goal b82f6bf6 / job a4b8b54a) completed DURING validation; the
  feed caught it live and produced exactly ONE in-dashboard
  notification. No external delivery exists.
- Staging regression (9121): staging profile rendered full live
  staging data CONCURRENTLY with prod; instance stopped after
  proof; staging store/client/env untouched and relaunchable via
  launch-preston-staging.ps1.

## Authority and boundary confirmations

- Hermes -> Preston production access is OBSERVE-ONLY: the hermes
  client is valid for exactly the seven read routes; the four
  consequential routes reject it as wrong_client by construction
  (verified live). No approval, cancellation, submission, or
  owner-confirmation capability exists on this surface.
- GPT and MCP clients, their routes, and the owner-confirmation
  handshake are UNCHANGED (regression suites + live 401 behavior).
- No direct Claude/Codex calls, no SSOT bypass, no credential in
  any frontend, no second orchestration engine.
- Per-surface rollback stands: deleting the prod hermes client,
  removing the env var, or deleting the prod store each fully
  severs only the Hermes link.

## Final repo / working-tree state

Branch feature/hermes-native; HEAD == master == origin/master ==
origin/feature/hermes-native == 2d447d5207...bb5b4a. Working tree
clean except the two known pre-existing untracked files
(packages/guards/src/index.js, scripts/p1/p1_diagnose.local.ps1),
never staged or pushed. This closeout file is the only new
uncommitted artifact at gate close.

## Notes / archival items

N-1: the owner-terminal G-7 probe printed the prod rotation
before/after hash prefixes; that output was not pasted into the
session, so this report cites the store's post-state (a3bb875d) and
operational continuity instead. Owner: paste or archive the probe
output into the evidence binder when convenient. Not a functional
gap - rotation is live-proven.

## Remaining known items (NOT part of this promotion)

- Prod Redirect URLs allowlist empty (flag only if prod owner-login
  redirect issues ever appear).
- Hermes dashboard restart after reboot requires the per-launch
  secret prompt (deliberate: no persisted secret).
- Pre-existing platform backlog unrelated to Hermes: knowledge
  layer P-1, legacy asset retirements, Telegram activation
  blockers, least-privilege identity migration 0007, business
  real-quote gate rulings.
