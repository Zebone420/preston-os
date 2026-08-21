# Preston Control — ChatGPT Control Interface v1 (dual adapter: MCP + GPT Actions)

**Status:** built + unit/E2E tested on dev; NOT enabled in any environment. Post-live workstream over golden baseline `prod-golden-0025` (`e17287b1acc413b01b3acb36f32832c74f448292`). The golden architecture is unchanged: no migration, no new identity, no new RPC.

**Revision 2 (2026-08-20, owner-directed):** one backend, two transport adapters — the MCP plugin (web/desktop) and a private Custom GPT Actions facade (the only ChatGPT mechanism that reaches the Android app). The MCP work from revision 1 is preserved unchanged.

**Control path:** Owner → ChatGPT → Preston Control (`/mcp` **or** `/api/control/*`) → Preston AI OS (composer / approvals / read model) → Hermes / orchestrator → Claude / Codex → evidence → ChatGPT.

## 1. Architecture review (2026-08-20)

**Revision 1 verdict (MCP): APPROVED — proceed as written.** OpenAI's current single-user private path is Developer mode → remote MCP server → personal plugin; Streamable HTTP at `/mcp`, OAuth 2.1 auth-code + PKCE with RFC 9728 discovery; no directory submission.

**Revision 2 (owner review):** MCP apps are web-only, so MCP alone cannot satisfy the HARD Galaxy requirement. The dual adapter keeps MCP and adds a GPT Actions facade over the same service layer. Two facts verified against official docs on 2026-08-20 that the owner must weigh before activation:

1. **New GPT creation on personal plans.** help.openai.com/8554397 (updated ~2026-08-15): *"New GPT creation and publishing are not available on personal ChatGPT accounts, including Free, Go, Plus, and Pro. Existing GPTs remain available to use and can still be edited if existing plan and permission requirements are met."* and 8554407: *"New GPT creation is unavailable on personal ChatGPT accounts, regardless of subscription."* → On the Pro account the Actions facade is reachable **only by editing a GPT that already exists** (the master plan's Custom GPT architect qualifies if it still exists) or from a Business workspace. Mobile use is documented: *"Mobile apps support using GPTs but do not support creating them."* Whether an OAuth-Action sign-in completes inside the Android app is **not officially stated** (a 2025 community thread reports failures) — hence the empirical Galaxy gate.
2. **PKCE mismatch.** GPT Actions OAuth documents a plain authorization-code exchange (`client_id`, `client_secret`, `code`, `redirect_uri`; no `code_challenge`), while Supabase's OAuth server lists `code_challenge` under *Required parameters* and offers only *"Authorization Code with PKCE"*. A direct GPT→Supabase configuration is therefore expected to fail. The facade ships a **stateless PKCE bridge** (`/oauth/gpt/{authorize,callback,token}`) that adds PKCE and forwards to Supabase; the token ChatGPT receives is still the owner's real Supabase JWT.

Other facts: "Actions are not available for Pro mode" refers to Pro *models* (the editor offers non-Pro models that support actions). `x-openai-isConsequential:true` = "must always prompt the user for confirmation"; GET defaults to false, other methods to true. Limits: 45 s round trip, 100 000-char payloads, 300-char summaries, 700-char parameter descriptions.

## 2. Files

| Path | Role |
|---|---|
| `apps/dashboard/src/lib/preston-control/auth.ts` | 8 fail-closed gates → RLS-bound owner client; `surface: 'mcp' \| 'gpt'` selects the client id |
| `apps/dashboard/src/lib/preston-control/tools.ts` | **service layer** — 6 handlers, allowlist projections, secret screen (unchanged) |
| `apps/dashboard/src/lib/preston-control/schemas.ts` | shared zod input schemas (MCP + REST) |
| `apps/dashboard/src/lib/preston-control/server.ts` | MCP adapter: McpServer + annotations |
| `apps/dashboard/src/lib/preston-control/http.ts` | REST adapter helper (gates → zod → tools), shared `clientFor` |
| `apps/dashboard/src/lib/preston-control/openapi.ts` | bounded OpenAPI 3.1 document |
| `apps/dashboard/src/lib/preston-control/gpt-bridge.ts` | stateless PKCE bridge logic |
| `apps/dashboard/src/lib/preston-control/metadata.ts` | RFC 9728 document |
| `apps/dashboard/src/lib/preston-control/consent.ts` | consent gate (either registered client / scope / owner) + safe `next` |
| `apps/dashboard/src/app/mcp/route.ts` | MCP Streamable HTTP endpoint |
| `apps/dashboard/src/app/.well-known/oauth-protected-resource/{,mcp/}route.ts` | MCP discovery |
| `apps/dashboard/src/app/api/control/{status,goals,goals/[goal_id],approvals,approvals/[approval_id]/decision,evidence,openapi.json}/route.ts` | GPT Actions facade |
| `apps/dashboard/src/app/oauth/gpt/{authorize,callback,token}/route.ts` | PKCE bridge endpoints |
| `apps/dashboard/src/app/oauth/consent/{page.tsx,actions.ts}` | owner consent UI (both clients) |
| `apps/dashboard/src/proxy.ts` | matcher excludes `/mcp`, `/api/control`, `/oauth/gpt/`, `/.well-known/`; carries `next` for consent |
| `apps/dashboard/src/app/login/page.tsx`, `components/nav/nav-config.ts` | consent continuation; non-nav route |
| `env.template` | `PRESTON_CONTROL_ENABLED`, `PRESTON_CONTROL_OAUTH_CLIENT_ID`, `PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID`, `PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET`, `PRESTON_CONTROL_GPT_BRIDGE_KEY`, `PRESTON_CONTROL_PUBLIC_ORIGIN` |
| `apps/dashboard/test/preston-control-{auth,tools,route,gpt}.test.ts` | 63 tests |
| `docs/PRESTON_CONTROL_THREAT_MODEL_v1.md` | threat model |

Dependencies: `@modelcontextprotocol/sdk@1.30.0`, `zod@4.4.3`.

**Reused unchanged by the GPT surface:** `tools.ts`, `metadata.ts`, the consent page, every MCP file. `auth.ts` gained a `surface` parameter (logic identical); `consent.ts` accepts either registered client. No business logic was copied — each REST route is 10–20 lines calling the same handler with the same schema.

## 3. Service layer and adapters

```
                ┌── MCP adapter   server.ts + app/mcp/route.ts      (OAuth client A; web/desktop)
ChatGPT ────────┤
                └── REST adapter  http.ts + app/api/control/*       (OAuth client B; Custom GPT incl. Android)
                         │ both: auth.ts gates 1-8 (surface-specific client_id) → RLS-bound OWNER client
                         ▼
                tools.ts (service layer) → composer / read model / decide RPC → runtime (unchanged)
```

| Operation | MCP tool | REST (GPT Actions) | Service handler | Consequential |
|---|---|---|---|---|
| status | `preston_status` (readOnly) | `GET /api/control/status` → `getPrestonStatus` | `prestonStatus` | no |
| submit goal | `preston_submit_goal` (idempotent) | `POST /api/control/goals` → `submitPrestonGoal` | `prestonSubmitGoal` | **yes** |
| get goal | `preston_get_goal` | `GET /api/control/goals/{goal_id}` → `getPrestonGoal` | `prestonGetGoal` | no |
| list approvals | `preston_list_approvals` | `GET /api/control/approvals` → `listPrestonApprovals` | `prestonListApprovals` | no |
| decide approval | `preston_decide_approval` (destructive) | `POST /api/control/approvals/{approval_id}/decision` → `decidePrestonApproval` | `prestonDecideApproval` | **yes** |
| evidence | `preston_get_evidence` | `GET /api/control/evidence?goal_id&job_id` → `getPrestonEvidence` | `prestonGetEvidence` | no |

OpenAPI document: `GET /api/control/openapi.json` — public while enabled, shapes only, security scheme = bridge URLs, 6 operations, strict bodies (`additionalProperties:false`), UUID / runtime-id patterns, `x-openai-isConsequential` explicit on every operation.

Excluded by construction on both surfaces: shell, SSH, SQL, table mutation, filesystem, deploys, policy edits, credentials, payments, customer sends, kill-switch changes, service role.

## 4. Authentication design

| | MCP adapter | GPT Actions adapter |
|---|---|---|
| Supabase OAuth client | **A** — redirect `https://chatgpt.com/connector_platform_oauth_redirect` | **B** — redirect `<origin>/oauth/gpt/callback` |
| Env (names) | `PRESTON_CONTROL_OAUTH_CLIENT_ID` | `PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID`, `PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET`, `PRESTON_CONTROL_GPT_BRIDGE_KEY` |
| Who holds the client secret | ChatGPT connector form | GPT editor OAuth form **and** Vercel env (the bridge forwards it) |
| PKCE | ChatGPT does S256 natively | bridge adds S256: verifier = HMAC(bridge key, nonce); nonce travels in HMAC-signed state and in the composite code `<code>.<nonce>`; nothing stored |
| Discovery | RFC 9728 PRM + `WWW-Authenticate` | OpenAPI `securitySchemes` (auth/token URL = bridge) |
| Token reaching Preston | owner Supabase JWT, `client_id = A` | owner Supabase JWT, `client_id = B` |
| `/mcp` accepts | A only (B → 403 `wrong_client`) | — |
| `/api/control/*` accepts | — | B only (A → 403 `wrong_client`) |
| Revocation | disable client A / remove the connector | disable client B / remove the GPT Action; rotating the bridge key breaks only in-flight logins |
| Consent UI | `/oauth/consent` (A or B, owner only) | same |

Gates on every request (both surfaces): enabled flag → env allowlisted → surface client id configured → bearer bounded → **Supabase verifies the token** → `client_id` == this surface's client, `aud` authenticated → `OWNER_EMAIL_ALLOWLIST` → **`is_owner()` in DB** → tools run RLS-bound as the owner. No static owner bearer exists anywhere; no secret enters model context; errors are tag-only.

**Security comparison.** Authorization is identical (same gates, same DB authority, same projections, same RPC). Differences: (a) the GPT surface keeps client B's secret in Vercel env — one more place a secret lives (env-only, constant-time compared, never returned, rotatable); (b) ChatGPT's confirmation comes from `x-openai-isConsequential` instead of MCP annotations — both write ops are flagged; (c) the bridge is an extra public OAuth endpoint — stateless, signed state, exact-shape ChatGPT redirect allowlist (`^https://(chat\.openai\.com|chatgpt\.com)/aip/g-<id>/oauth/callback$`), forwards only to the configured Supabase project, strips `id_token`/user objects. Net: no weaker on authorization; slightly larger surface, pinned by tests.

### GPT Actions flow
1. GPT shows "Sign in" → browser → `<origin>/oauth/gpt/authorize?client_id=B&redirect_uri=https://chatgpt.com/aip/g-…/oauth/callback&state=…` → bridge validates, adds PKCE, 302 → Supabase `/auth/v1/oauth/authorize`.
2. Supabase → `/oauth/consent` (login at `/login` if needed) → owner approves client B → Supabase 302 → `<origin>/oauth/gpt/callback?code&state`.
3. Bridge verifies signed state → 302 → ChatGPT callback with `code=<code>.<nonce>` and ChatGPT's own `state`.
4. ChatGPT servers POST `<origin>/oauth/gpt/token` (client B id + secret, composite code) → bridge verifies credentials, re-derives the verifier, forwards to Supabase `/auth/v1/oauth/token` → returns `{access_token, refresh_token, expires_in, token_type}`.
5. Every Action call: `Authorization: Bearer <owner JWT>` → `/api/control/*` gates 1–8.

### MCP flow (unchanged)
401 + `WWW-Authenticate` → PRM → Supabase AS metadata → auth-code + PKCE (ChatGPT) → `/oauth/consent` → `https://chatgpt.com/connector_platform_oauth_redirect` → token → `/mcp`.

## 5. Tests (Phase E)

`npx vitest run test/preston-control-*.test.ts` → **63 passing**: 46 MCP/service (disabled, unconfigured env, no auth, forged/expired token, wrong audience, dashboard JWT, other client, non-owner, empty allowlist, runtime identity, `is_owner` error, 413 before auth, stateless GET/DELETE, schema rejection, duplicate/replay and payload mismatch, gated goal → list → one audited decision → `already_decided`/`approval_not_found`/`expired`/`owner_required`, secret exclusion in/out, projections, consent gate, `next` guard, PRM, proxy, env names, runtime isolation) + 17 GPT surface (cross-surface token refusal both ways; REST Test B/C/D chain end-to-end; strict-body 400/413/non-JSON; guest decide 403; `openapi.json` shape, consequential flags, bridge URLs, size < 100 k, no secrets; consent accepts either client; bridge authorize/state/callback/token/filter negatives incl. foreign-origin redirect, path traversal, forged/tampered state, wrong client, unsupported grant; bridge routes 404/302/401 with upstream `fetch` never called on a bad client; proxy/env wiring; no shell/service-role in adapter files). `tsc`, `eslint`, secret + RED scanners clean.

## 6. Owner activation packet — STOP point (staging first)

Nothing below has been done. Never paste secrets into Claude.

### 6.1 Supabase (staging project)
1. Authentication → **OAuth Server** → Enable. Authorization path `/oauth/consent`. Dynamic Client Registration **OFF**.
2. Authentication → **OAuth Apps** → add client **A** "Preston Control MCP (staging)", Confidential, redirect URI exactly `https://chatgpt.com/connector_platform_oauth_redirect`.
3. Add client **B** "Preston Control GPT (staging)", Confidential, redirect URI exactly `<staging origin>/oauth/gpt/callback`. Keep B's secret in 1Password.
4. (Recommended) JWT signing keys → asymmetric (ES256).

### 6.2 Vercel (staging) — names only
`PRESTON_CONTROL_ENABLED=true` · `PRESTON_CONTROL_OAUTH_CLIENT_ID=<A id>` · `PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID=<B id>` · `PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET=<B secret>` · `PRESTON_CONTROL_GPT_BRIDGE_KEY=<random ≥32 chars, e.g. 48 from a password manager>` · optional `PRESTON_CONTROL_PUBLIC_ORIGIN`. Redeploy. Smoke: `GET /.well-known/oauth-protected-resource/mcp` → JSON; `GET /api/control/openapi.json` → JSON; `POST /mcp` and `GET /api/control/status` without bearer → 401.

### 6.3 ChatGPT web — MCP plugin (web/desktop)
Settings → Security and login → Developer mode → chatgpt.com/plugins → **+** → MCP URL `<origin>/mcp`, OAuth, client A id/secret, scope `email` → consent → install → `@Preston Control` → Tests A–E.

### 6.4 ChatGPT web — Custom GPT Actions (Galaxy path)
1. Open an **existing** GPT you own (creation is closed on personal plans; if none exists, a Business workspace is required) → Edit → Configure → Actions → **Create new action**.
2. Import schema from URL `<origin>/api/control/openapi.json`.
3. Authentication → OAuth: Client ID = B id, Client Secret = B secret, Authorization URL `<origin>/oauth/gpt/authorize`, Token URL `<origin>/oauth/gpt/token`, Scope `email`, Token exchange method **Default (POST request)**. Save.
4. Copy the callback URL the editor shows (`https://chat.openai.com/aip/g-<id>/oauth/callback` / `https://chatgpt.com/aip/g-<id>/oauth/callback`) — the bridge already allowlists this exact shape; nothing to configure in Supabase for it (Supabase only sees the bridge callback).
5. Visibility **Only me**. Save. In the editor preview: "Check Preston status" → Sign in → consent → the action calls `getPrestonStatus`.

### 6.5 Galaxy acceptance (Phase G, first-class gate) — exact procedure
1. On the Galaxy, update the ChatGPT Android app; sign in as the owner.
2. Sidebar → GPTs → open the Preston Control GPT (no `@` mention on mobile).
3. Say **"Check Preston status."** Expected: a sign-in prompt the first time (completes in the in-app browser via `/oauth/consent`), then an action card for `getPrestonStatus`, then a status summary. **Proof:** `status` JSON shows `generated_at` within the last minute; Vercel logs show `GET /api/control/status 200`.
4. Say **"Have Preston create a harmless documentation goal describing the golden baseline."** Expected: confirmation card (consequential) → `submitPrestonGoal` → `accepted` with `goal_id`. **Proof:** the goal appears in `/os/orchestration`; the runtime consumes it on the next 5-min tick; `getPrestonGoal` shows jobs progressing; `getPrestonEvidence` returns refs.
5. Say **"Have Preston prepare the Phase 7 schema evidence with a migration plan for my review."** Expected: `accepted`, `approvals_required ≥ 1`; `listPrestonApprovals` shows it; the runtime does **not** self-approve.
6. Say **"Approve that."** Expected: confirmation card → `decidePrestonApproval` → `ok:true`, `decided_by = owner email`. **Proof:** `audit_log` has exactly one `orchestration_approval_decision` row with `actor = owner auth.uid()`; the job clears and runs on the next tick.
7. Negative: sign into the GPT with a non-owner test user → sign-in completes but every action returns 403 `not_owner`; approval denied.
8. Record: screenshots of each card, Vercel request ids, the audit row, and the product result (works / sign-in fails / action blocked). If the OAuth sign-in cannot complete inside the Android app, capture the exact screen/message — that is the product limitation to document; do not weaken Preston to work around it.

### 6.6 Rollback / kill
- Instant: `PRESTON_CONTROL_ENABLED=false` (all surfaces → 503/404).
- Per surface: disable client A (MCP) or client B (GPT) in Supabase; remove the connector / the GPT Action.
- Rotate `PRESTON_CONTROL_GPT_BRIDGE_KEY` to invalidate in-flight GPT logins.
- Code: revert the commits; no migration to roll back.

### 6.7 Security effect on existing users/sessions
None. New endpoints only; existing password sessions, cookies, RLS, and the runtime service identity are unaffected. Dashboard JWTs carry no `client_id` and are refused by both surfaces.

## 7. Production promotion (Phase H) — not started
After staging Tests A–E (MCP) and the Galaxy gate pass: separate prod OAuth clients A'/B', prod Vercel env names, PRM/OpenAPI/401 smokes, consent smoke, Test A/B on prod with a harmless documentation goal, Galaxy re-run, rollback = flag off + client disable, golden evidence under `reports/`. Requires an owner-approved RED gate.
