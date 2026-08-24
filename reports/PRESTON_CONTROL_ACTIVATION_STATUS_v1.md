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
