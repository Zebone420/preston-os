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
