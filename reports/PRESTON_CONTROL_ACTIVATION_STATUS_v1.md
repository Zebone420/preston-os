# PRESTON CONTROL — STAGING ACTIVATION STATUS (fresh inspection 2026-08-23)

Scope: status + resume runbook only. Nothing was changed on Supabase, Vercel,
ChatGPT, any host, or production by this inspection. All probes were
unauthenticated HTTP GETs and local repo commands.

---

## 1. Ground truth established this session

| Fact | Evidence |
|---|---|
| `master` = `e17287b` (golden seal, tag `prod-golden-0025`), origin/master identical | `git log`, `git rev-parse` |
| `feature/preston-control` = `e8ca06e`, identical to `origin/feature/preston-control` (9 commits over master, all Preston Control) | `git rev-parse` both refs |
| Working tree clean except `scripts/p1/p1_diagnose.local.ps1` (deliberately untracked, prior session intent) | `git status` |
| **Staging alias runs a PRE-CONTROL build.** `GET https://preston-os-staging.vercel.app/api/control/openapi.json` → **307 → /login** (HTML), i.e. the deployed proxy matcher predates the control-route exclusions. Same for `/mcp` PRM, `/api/control/status`, `/oauth/gpt/authorize`. Deployment id `dpl_9qxhJZCAyaCrpSg2aVa9VQgk5Uok`. | curl-class GET probes, `X-Matched-Path: /login` |
| Staging `/api/health` → 200 `{"ok":true,"mode":"connected"}` — app itself healthy | GET probe |
| Prod alias `/api/control/status` → owner-gate HTML (control code not on prod; correct — Phase H not started) | GET probe |
| No repo evidence (reports/, p2_evidence/) newer than 2026-08-21 01:03; the OAuth triage session ended mid-flight with fixes committed but **no recorded live retest after `e8ca06e`** | file timestamps, `git log --all --since` |

## 2. Local verification of the branch head (`e8ca06e`, run 2026-08-23)

- `test/preston-control-*.test.ts`: **83/83 pass** (packet §0 said 79; the
  four Basic-parsing/'+'-secret regression tests landed after the packet).
- `tsc --noEmit`: 0 errors. `eslint`: 0 problems.
- Full dashboard suite: **1482 pass + 1 expected fail; 5 fails all in
  `test/worktree-prep.test.ts`** — the documented Windows env class
  (`bash -n` ENOENT under vitest). Compensated by direct Git Bash syntax
  checks + full scanner runs this session (see gate log below / commit msg).

The branch is code-complete, audited (packet §0 items 1–8 PASS), and in sync
with origin. It is **deploy-ready; it is simply not deployed to the staging
alias.**

## 3. Where the 2026-08-21 triage stood

Commit timeline (all on `feature/preston-control`, all pushed):

- `538a911` — callback pinned to exact `PRESTON_CONTROL_GPT_CALLBACK_URL`.
- `585a436` — GoTrue error-code tags + **owner-only `GET /oauth/gpt/diag`**
  (probes whether the stored client-B credentials authenticate at Supabase,
  values never shown) + OpenAPI Result schema.
- `8143e90` — diag probes `client_secret_post` and HTTP Basic separately.
- `968c500` — bridge accepts HTTP Basic robustly (first colon, raw or
  urlencoded) with values-free failure diagnostic.
- `e8ca06e` — bridge accepts a raw `+` in the posted secret (form-decode
  turns an unencoded `+` into a space; bridge canonicalises for upstream).

Interpretation: the owner had reached the **GPT token-exchange step** against
staging and hit a client-authentication failure; the two most likely root
causes (Basic header form; `+` in the secret) are now handled and
regression-tested. Whether the fix resolves the live failure is **unproven**
— the alias no longer serves any control build, so the next live attempt
must start with a deployment.

## 4. Smallest remaining blocker set (to "ChatGPT connected to Preston")

1. **Deploy `feature/preston-control` (`e8ca06e`) to the staging origin** the
   GPT/MCP calls. Owner-run (agent cannot deploy; H-6).
2. Confirm staging Vercel env still carries the packet §3 variables
   (especially `PRESTON_CONTROL_GPT_CALLBACK_URL` byte-exact — remember the
   empty-value Vercel save defect).
3. Owner opens `GET https://<staging-host>/oauth/gpt/diag` (signed in to the
   staging dashboard as owner) → expect `credentials:"valid"` on the `post`
   method. If `invalid`: client-B secret in Vercel ≠ Supabase → re-copy or
   regenerate (packet §8/§9), never via chat.
4. GPT editor preview: "Check Preston status." → sign-in → consent → status
   card (packet §5 step 6; §8 error matrix).
5. Staging acceptance: Tests A–E (MCP surface, spec §6.3) + Galaxy G1–G8
   (packet §6).
6. Phase H prod promotion — separate owner-approved RED gate (spec §7).

## 5. OWNER ACTION REQUIRED (next single step)

**Where:** Vercel dashboard → project `preston-os-staging` (staging project).
**Do exactly (pick ONE, staging-only — do NOT merge the branch to master;
master auto-deploys the PROD Vercel project and control-on-prod is the
Phase H RED gate):**
- Option A: Settings → Git → Production Branch → `feature/preston-control`
  → trigger a redeploy; or
- Option B: Deployments → newest deployment of `feature/preston-control`
  (commit `e8ca06e`) → ⋯ → Promote to Production.

**Expected result:** `GET https://preston-os-staging.vercel.app/api/control/openapi.json`
returns JSON (6 operations) instead of the login page; the four other §3
smoke GETs behave per packet.
**Secret? NO.**
**Agent immediately afterward:** re-runs the five §3 smoke probes and
records results here; then hands you the diag-endpoint check (step 3 above)
and stands by on the §8 error matrix for the GPT preview retest.

## 6. Rollback

Unchanged from packet §9: `PRESTON_CONTROL_ENABLED=false` + redeploy kills
all 14 endpoints; reverting the Production Branch setting (Option A) or
promoting the previous master deployment (Option B) restores the sealed
pre-control staging build. No migrations involved.

---

## 7. ADDENDUM — STAGING PROMOTION EXECUTED (2026-08-24 ~02:40 UTC, owner-directed)

The owner directed the agent to attempt the §5 promotion itself. Done via
the owner-logged-in Chrome Vercel session (team Zebone420preston-os):

- Verified project `preston-os-staging` (alias `preston-os-staging.vercel.app`),
  found the **Ready preview of `85b2dcd`** (branch `feature/preston-control`,
  built from this session's docs commit) and used **Promote to Production**.
  Vercel rebuilt it with the staging project's Production env: deployment
  `FGEkzFzZSLeU5NnBaCL3aM6KzvaR`, build 27s, status **Ready · Latest**,
  environment Production, domains = the alias + the branch git-domain +
  `preston-os-staging-mg8db562h-…vercel.app`. No env vars, secrets, domains,
  or project settings were changed. Production (`preston-os-prod`) untouched.
- Alias smoke (2026-08-24 02:44:31 UTC) — the §3 probes now return
  control-route JSON where the pre-promotion alias 307'd to /login:
  `/.well-known/oauth-protected-resource/mcp` → 404 `{"ok":false,"status":"disabled"}`;
  `/api/control/openapi.json` → 404 disabled; `/api/control/status` → 503
  disabled; `/oauth/gpt/authorize` → 404 `{"error":"disabled"}`; `/mcp`
  (GET; agent POST is guard-blocked) → 503 disabled.
  **The control build is LIVE on the alias and fail-closed disabled.**
- **Root cause of "disabled" (read-only inspection of env-var names/scopes):**
  all 7 `PRESTON_CONTROL_*` variables exist only in **Preview scope,
  branch-pinned to `feature/preston-control`** — the staging project's
  Production scope has none. `PRESTON_CONTROL_ENABLED` (Preview) = `true`
  (non-secret, revealed). `PRESTON_CONTROL_PUBLIC_ORIGIN` (Preview, non-secret)
  = `https://preston-os-staging-git-feature-prest-b899d1-zebone420preston-os.vercel.app`
  — i.e. the 2026-08-21 triage ran on the **branch git-domain with Preview
  env**, never on the alias. Supabase client B's redirect URI and the GPT
  editor's authorize/token URLs therefore presumably also reference the
  branch domain.
- Side effect of the promotion: the branch git-domain now serves the
  Production-env (disabled) build, so the old branch-domain test setup is
  dormant. Any new branch push (or a Redeploy of the prior preview) would
  restore it — do that only if you deliberately choose to keep testing on
  the branch domain instead of the alias.

## 8. OWNER ACTION REQUIRED — move the control configuration to the alias

Where: Vercel → `preston-os-staging` → Settings → Environment Variables;
then Supabase staging → Authentication → OAuth Apps; then the GPT editor.

Do exactly:
1. For each of `PRESTON_CONTROL_ENABLED`, `PRESTON_CONTROL_OAUTH_CLIENT_ID`,
   `PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID`, `PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET`,
   `PRESTON_CONTROL_GPT_BRIDGE_KEY`, `PRESTON_CONTROL_GPT_CALLBACK_URL`:
   row ⋯ → Edit → also tick **Production** → Save (values stay as stored;
   nothing re-typed).
2. `PRESTON_CONTROL_PUBLIC_ORIGIN`: leave it Preview-only (on the alias the
   request origin is already correct; its stored branch-domain value must
   NOT reach Production scope).
3. Supabase (staging) → OAuth Apps → client B ("Preston Control GPT
   (staging)") → add redirect URI exactly
   `https://preston-os-staging.vercel.app/oauth/gpt/callback` (keeping the
   old one is fine during transition).
4. GPT editor → the Preston Control action → OAuth settings: Authorization
   URL `https://preston-os-staging.vercel.app/oauth/gpt/authorize`, Token
   URL `https://preston-os-staging.vercel.app/oauth/gpt/token`; re-import
   the schema from `https://preston-os-staging.vercel.app/api/control/openapi.json`.
   If the editor then shows a DIFFERENT callback URL, copy it verbatim into
   `PRESTON_CONTROL_GPT_CALLBACK_URL` (both scopes).
5. Vercel → Deployments → top (current Production, `85b2dcd`) → ⋯ →
   **Redeploy** (env changes need a new build).

Expected result: the five §3 probes flip from "disabled" to their packet
answers (metadata JSON 200, openapi 200 with 6 operations, 401s on
status/mcp, 400 on bare authorize). Secret? NO (scope ticks only; no values
typed anywhere).

Agent immediately afterward: re-runs the §3 probes, records them here, then
hands you the signed-in `GET /oauth/gpt/diag` check (expect
`credentials:"valid"` on `post`) and stands by on the §8 packet error
matrix for the GPT preview sign-in retest, then Tests A–E / Galaxy G1–G8.

---

## 9. ADDENDUM — OWNER-DIRECTED VERCEL ENV EXECUTION (2026-08-24 ~03:00–03:28 UTC)

The owner authorized the agent to perform the §8 Vercel steps itself.
Executed via the owner browser session, staging project only:

**Completed by the agent (no values typed, none revealed beyond the
non-secret ones already documented):**
- `PRESTON_CONTROL_ENABLED` = `true` added as a NEW Production-scope row
  (plaintext, no branch pin). The literal `true` was typed; it is the
  packet's documented non-secret value.
- `PRESTON_CONTROL_GPT_BRIDGE_KEY` (Sensitive, no branch pin) re-scoped
  from Preview to **Production and Preview** via Edit — stored value
  preserved untouched (never displayed; Vercel keeps it on scope edits).
- `PRESTON_CONTROL_PUBLIC_ORIGIN` left Preview-only, per instruction.
- No other variable altered (verified in the final list: SSOT/REMOTE/
  SUPABASE/NEXT_PUBLIC rows unchanged; the six Preview-pinned control
  rows keep their original Preview + `feature/preston-control` scope).
- Redeploy executed: current Production deployment (source `85b2dcd`)
  rebuilt as deployment `EHfdGsfFPkLddTD5ERoZHLra5HJw`, 36s, **Ready**,
  alias `preston-os-staging.vercel.app` attached.

**Probe evidence (2026-08-24 03:28:26 UTC), commit `85b2dcd`, alias
`preston-os-staging.vercel.app`:**
- `/.well-known/oauth-protected-resource/mcp` → 404 `disabled`
- `/api/control/openapi.json` → 404 `disabled`
- `/api/control/status` → **503 `unconfigured`** (was `disabled`)
- `/oauth/gpt/authorize` → 404 `disabled`
- `/mcp` → **503 `unconfigured`** (was `disabled`)

The `disabled`→`unconfigured` shift on status/mcp is live proof the
Production env scope is loading and the flag is on; the surfaces now
fail closed only on the missing client configuration.

**Why the agent could not finish the remaining four rows:**
- Vercel rejects adding Production scope to a branch-pinned variable
  ("Environment Variables with `gitBranch` can only be used with
  `target=preview`"), and the edit form for those rows offers no way to
  clear the pin — so the values must be re-entered as new
  Production-scope rows.
- The auto-mode permission classifier blocks the agent from typing
  credential-shaped values (client-id UUIDs, the `g-…` callback URL)
  into browser forms; the H-4 guard blocks staging them in a `.env`
  file; the import path needs a native file picker the agent cannot
  drive. These safety controls were respected, not bypassed.

**OWNER ACTION REQUIRED (final Vercel step, ~3 minutes):**
Where: the open Vercel tab → `preston-os-staging` → Settings →
Environment Variables → **Add Environment Variable** (add all four in one
dialog with "+ Add Another"; set Environments = **Production** only;
Sensitive OFF for the first three, **ON for the client secret**):
1. `PRESTON_CONTROL_OAUTH_CLIENT_ID` = the client A id (reveal it from
   the existing Preview row's eye icon to copy: `c1680204-…c4a1`)
2. `PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID` = the client B id (`7f83970f-…5c69`)
3. `PRESTON_CONTROL_GPT_CALLBACK_URL` = the exact value in the Preview
   row (`https://chat.openai.com/aip/g-…/oauth/callback` — copy via the
   row's Copy to Clipboard to keep it byte-identical)
4. `PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET` = client B secret from
   1Password (Sensitive ON) — the one value that exists nowhere the UI
   can copy from. Secret? YES — type it only into Vercel.
Then click **Redeploy** on the save toast (or tell the agent — it will
redeploy and re-probe immediately).

Expected result after redeploy: metadata + openapi 200 JSON; status/mcp
401 without bearer; bare authorize 400.

---

## 10. ADDENDUM — §3 SMOKE PASS + CREDENTIAL/CALLBACK TRIAGE (2026-08-24 ~03:40–03:55 UTC)

Owner added the four Production rows (all marked Sensitive) and redeployed;
agent verified rows (no branch pins; ENABLED + bridge key Production-
available; PUBLIC_ORIGIN correctly absent; unrelated vars untouched), ran
one final Redeploy to guarantee the last-added secret was loaded:
deployment `GX471zFHzEf8orHN7F2LQNMAvauM`, 36s, Ready, alias attached,
source `85b2dcd`.

**§3 SMOKE — ALL PASS (2026-08-24 03:41:53 UTC, alias, commit `85b2dcd`):**
- `/.well-known/oauth-protected-resource/mcp` → **200** `{resource: <alias>/mcp, authorization_servers:["https://vcqtlmlaxxankxyezlul.supabase.co/auth/v1"], …}`
- `/api/control/openapi.json` → **200**, `servers[0] = <alias>`, **6 operations** (getPrestonStatus, submitPrestonGoal, getPrestonGoal, listPrestonApprovals, decidePrestonApproval, getPrestonEvidence), authorize/token URLs = `<alias>/oauth/gpt/{authorize,token}`
- `/api/control/status` (no bearer) → **401** `missing_token` + `WWW-Authenticate: Bearer resource_metadata=…`
- `/oauth/gpt/authorize` (bare) → **400** `unauthorized_client`
- `/mcp` (no bearer) → **401** `missing_token` + `WWW-Authenticate`

**Preston Control is LIVE on the staging alias, fail-closed to OAuth.**

**Diag (owner session via browser, `GET /oauth/gpt/diag`):** `ok:true`,
`bridge_configured:true`, `public_origin = <alias>` (request-origin
fallback proven), `client_id_suffix "9d5c69"` (client B id correct), BUT
**`credentials:"invalid"` — upstream 400 `invalid_credentials` on BOTH
`client_secret_post` and Basic** → the client-B secret stored in Vercel
does not authenticate at Supabase staging.

**Supabase read-only findings (OAuth Apps drawer, staging project):**
- Both clients exist (GPT `7f83970f-…5c69`, MCP `c1680204-…c4a1`),
  Confidential, created Aug 20; GPT client token method =
  `client_secret_post` (matches bridge).
- **Client B has ONE redirect URI: the branch git-domain callback.**
  `https://preston-os-staging.vercel.app/oauth/gpt/callback` is NOT
  registered → Supabase will refuse the alias bridge flow.
- Authorize-leg probe with the OLD Preview callback value →
  `invalid_redirect` (callback pin enforcing; also means the Production
  `PRESTON_CONTROL_GPT_CALLBACK_URL` differs from the old Preview value —
  unreadable now because the row is Sensitive; the GPT preview test
  settles whether it matches ChatGPT's real callback).

## 11. OWNER ACTION REQUIRED — final credential/config alignment (all secret-adjacent)

1. **Supabase staging → Authentication → OAuth Apps → Preston Control GPT
   (staging):**
   a. **Add redirect URI** (exact): `https://preston-os-staging.vercel.app/oauth/gpt/callback`
   b. **Regenerate client secret** → copy it once →
      - Vercel `preston-os-staging` → `PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET`
        (Production row) → Edit → paste new value → Save
      - GPT editor → the action's OAuth **Client Secret** field
      - 1Password (replace old)
      Secret? **YES** — typed only into Supabase/Vercel/ChatGPT/1Password.
2. **GPT editor (chatgpt.com):** Authorization URL
   `https://preston-os-staging.vercel.app/oauth/gpt/authorize`, Token URL
   `…/oauth/gpt/token`, re-import schema from `…/api/control/openapi.json`,
   Token Exchange Method "Default (POST request)". After saving, compare
   the **Callback URL** the editor displays to what you typed into
   `PRESTON_CONTROL_GPT_CALLBACK_URL`; if it differs, update the Vercel
   row (byte-identical) — then redeploy (or tell the agent).
3. **MCP plugin (Tests A–E surface, ChatGPT web Developer mode):**
   connector with MCP URL `https://preston-os-staging.vercel.app/mcp`,
   OAuth = client A id + client A secret (1Password), scope `email`.
4. Then: agent re-runs diag expectation (`credentials:"valid"`), you run
   the GPT preview "Check Preston status." sign-in, Tests A–E, Galaxy
   G1–G8 per packet §6; agent verifies each server-side (Vercel logs,
   orchestration read-models, SSOT rows).

Everything remaining requires either a regenerated secret in hand or the
owner's ChatGPT account — no further agent-executable staging work exists
until 1–3 are done.
