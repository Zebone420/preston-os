# Preston Control — ChatGPT MCP Control Interface v1

**Status:** built + unit/E2E tested on dev; NOT enabled in any environment. Post-live workstream over golden baseline `prod-golden-0025` (`e17287b1acc413b01b3acb36f32832c74f448292`). The golden architecture is unchanged: no migration, no new identity, no new RPC.

**Control path:** Owner → ChatGPT → Preston Control (`/mcp`) → Preston AI OS (composer / approvals / read model) → Hermes / orchestrator → Claude / Codex → evidence → ChatGPT.

## 1. Architecture review verdict (2026-08-20)

**APPROVED — proceed as written.** Sources: OpenAI developer docs (`developers.openai.com/plugins/*`, `/api/docs/guides/developer-mode`, `/plugins/build/auth`), OpenAI help center (articles 12584461, 11487775, 8554397, 20001256), Supabase docs (`/docs/guides/auth/oauth-server/*`).

| Option | Verdict | Why |
|---|---|---|
| **Private MCP server via ChatGPT Developer mode (chosen)** | Best | OpenAI's current single-user path: Settings → Security and login → Developer mode → chatgpt.com/plugins → add remote MCP server → personal plugin. No directory submission. Streamable HTTP at `/mcp`; OAuth 2.1 auth-code + PKCE with RFC 9728 discovery; static client credentials accepted (DCR can stay off). `search`/`fetch` no longer required. |
| ChatGPT App / Apps SDK | Not needed | UI widgets are optional; headless tools are sufficient and recommended ("keep tools useful without the component"). |
| Direct API / bearer | Rejected | Requires manual token handling (the thing being eliminated) and cannot act as the owner identity. |
| Custom GPT Actions | Closed | "New GPT creation and publishing are not available on personal ChatGPT accounts, including Free, Go, Plus, and Pro." Only editing a pre-existing GPT remains. |
| Secure MCP Tunnel (2026) | Not needed | Avoids a public endpoint but needs a persistent tunnel client; Vercel is already public and hardened. |

**Auth:** Supabase Auth OAuth 2.1 Server (beta, all plans). Its access tokens are ordinary Supabase JWTs (`sub`, `aud: authenticated`, `client_id`), so `auth.uid()`, RLS and `is_owner()` work unchanged — `decide_orchestration_approval` runs as the real owner. No other option preserves owner attribution.

**Known product limits (not architecture defects):**
1. Android: help center (updated 2026-08-19) — "Are MCP apps available on mobile? No — web only." See §7.
2. Plus/Pro write tools: developer docs say read+write with confirmation; help center says writes are Business/Enterprise/Edu. Resolved empirically in Phase F.

## 2. Files

| Path | Role |
|---|---|
| `apps/dashboard/src/lib/preston-control/auth.ts` | 8 fail-closed gates → RLS-bound owner client |
| `apps/dashboard/src/lib/preston-control/tools.ts` | 6 handlers, allowlist projections, secret screen |
| `apps/dashboard/src/lib/preston-control/server.ts` | McpServer + zod schemas + annotations |
| `apps/dashboard/src/lib/preston-control/metadata.ts` | RFC 9728 document |
| `apps/dashboard/src/lib/preston-control/consent.ts` | consent gate (client/scope/owner) + safe `next` |
| `apps/dashboard/src/app/mcp/route.ts` | Streamable HTTP endpoint (stateless, JSON responses) |
| `apps/dashboard/src/app/.well-known/oauth-protected-resource/{,mcp/}route.ts` | discovery |
| `apps/dashboard/src/app/oauth/consent/{page.tsx,actions.ts}` | owner consent UI for the Supabase OAuth server |
| `apps/dashboard/src/proxy.ts` | matcher excludes `/mcp`, `/.well-known/`; carries `next` for consent |
| `apps/dashboard/src/app/login/page.tsx` | honours validated consent `next` |
| `apps/dashboard/src/components/nav/nav-config.ts` | `/oauth/consent` is a non-nav route |
| `env.template` | `PRESTON_CONTROL_ENABLED`, `PRESTON_CONTROL_OAUTH_CLIENT_ID`, `PRESTON_CONTROL_PUBLIC_ORIGIN` |
| `apps/dashboard/test/preston-control-{auth,tools,route}.test.ts` | 46 tests |
| `docs/PRESTON_CONTROL_THREAT_MODEL_v1.md` | threat model |

Dependencies added: `@modelcontextprotocol/sdk@1.30.0`, `zod@4.4.3`.

## 3. Tool surface (v1)

| Tool | Kind | Maps onto | Annotations |
|---|---|---|---|
| `preston_status` | read | `readSystemControlsChecked`, `loadOrchestrationReadModel`, `loadLatestHermesStatus` | readOnly, idempotent |
| `preston_submit_goal` | write | `composeRequest` → `confirmComposedRequest` (→ `submit_goal_decomposition`) | idempotent on `request_id` |
| `preston_get_goal` | read | `readGoalById`, `listJobsForGoal`, `listOpenApprovals` | readOnly |
| `preston_list_approvals` | read | `listOpenApprovals` + `decision_open` | readOnly |
| `preston_decide_approval` | consequential write | `decide_orchestration_approval` RPC (owner-only, nonce, 0021 audit) | destructive, non-idempotent → ChatGPT confirmation |
| `preston_get_evidence` | read | `goal_jobs.evidence_refs` / `failure_reason` | readOnly |

Excluded by construction: shell, SSH, SQL, table mutation, filesystem, deploys, policy edits, credentials, payments, customer sends, kill-switch changes, service role.

## 4. Authentication flow

1. ChatGPT calls `/mcp` → 401 + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
2. ChatGPT reads the PRM → `authorization_servers: ["https://<ref>.supabase.co/auth/v1"]` → AS metadata (`code_challenge_methods_supported: ["S256"]`).
3. Auth-code + PKCE: browser → Supabase `/auth/v1/oauth/authorize` → redirect to **our** `/oauth/consent?authorization_id=…` (owner signs in at `/login` if needed; `next` carries the consent URL back) → owner approves (only the Preston Control client, only allowlisted scopes) → Supabase redirects to `https://chatgpt.com/connector_platform_oauth_redirect` with the code.
4. ChatGPT exchanges the code at `/auth/v1/oauth/token` (static client id/secret entered in ChatGPT's form) → access JWT (1h) + refresh token.
5. Every `/mcp` request: gates 1–8 (`auth.ts`): enabled → env allowlisted → client id configured → bearer present/bounded → `auth.getUser` verifies → `client_id` == registered, `aud` authenticated → email on `OWNER_EMAIL_ALLOWLIST` → `is_owner()` true → tools run RLS-bound as the owner.

Never in model context: actor tokens, runtime refresh tokens, DB/root passwords, service-role key, SSH keys, env values, raw logs. Errors are tag-only.

## 5. Tests (Phase E) — all passing on dev

`npx vitest run test/preston-control-*.test.ts` → 46 tests: disabled, unconfigured env, no auth, forged/expired token, wrong audience, plain dashboard JWT, other OAuth client, non-owner, empty allowlist, runtime service identity, `is_owner` RPC error, 413 before auth, stateless GET/DELETE, schema rejection of malformed args, duplicate goal (replay) and payload-mismatch, gated goal → pending approval → owner decision (one RPC call, `pc-` nonce, one audit row) → `already_decided`, `approval_not_found`, `expired`, `owner_required`, secret exclusion on input and output, allowlist projections, consent gate (client/scope/owner/mismatch/unconfigured), `next` open-redirect guard, PRM document, proxy matcher, env names, runtime isolation (no `preston-control` import in driver/coordinator/remote-intake/hermes; no shell/service-role in adapter). Full suite: 1 493 tests, green apart from two pre-existing scanner self-scan tests that exceed their 120 s timeout on this workstation (the scanners themselves report 0 findings).

## 6. Owner activation packet (Phase D/F — STOP point)

Nothing below has been done. Do it on **staging first**. Never paste secrets into Claude.

### 6.1 Supabase (staging project)
1. Authentication → **OAuth Server** → Enable. Authorization path: `/oauth/consent` (combined with Site URL = the staging dashboard origin). Leave **Dynamic Client Registration OFF**.
2. Authentication → **OAuth Apps** → Add client: name `Preston Control (staging)`, type **Confidential**, redirect URI **exactly** `https://chatgpt.com/connector_platform_oauth_redirect` (also add `https://chatgpt.com/connector/oauth/` callback form only if ChatGPT's form shows one). Copy the **client id** (non-secret) and keep the **client secret** in 1Password — it is entered only in ChatGPT.
3. (Recommended) JWT Signing Keys → migrate to an asymmetric key (ES256). Not required for v1 (no `openid` scope), but recommended by Supabase for OAuth.
4. Confirm the owner auth user is in `public.owners` (already true — it is the dashboard owner).

### 6.2 Vercel (staging environment) — names only
- `PRESTON_CONTROL_ENABLED=true`
- `PRESTON_CONTROL_OAUTH_CLIENT_ID=<client id from 6.1.2>`
- (optional) `PRESTON_CONTROL_PUBLIC_ORIGIN=<staging origin>` if the deployment is reached through an alias.
- `SUPABASE_RUNTIME_ENV=staging` and `OWNER_EMAIL_ALLOWLIST` already set.
Redeploy. Verify: `GET <origin>/.well-known/oauth-protected-resource/mcp` returns JSON; `POST <origin>/mcp` without a bearer returns 401 with `WWW-Authenticate`.

### 6.3 MCP Inspector (optional, dev)
`npx @modelcontextprotocol/inspector@latest` → Streamable HTTP → `<origin>/mcp` → OAuth → completes the consent flow in the browser → `tools/list` shows six tools.

### 6.4 ChatGPT (web)
1. Settings → **Security and login** → enable **Developer mode** (Plus/Pro/Business/Enterprise).
2. chatgpt.com/plugins → **+** → Developer-mode app: name `Preston Control`, MCP server URL `<origin>/mcp`, auth **OAuth**, client id + client secret from 6.1.2, scope `email`. Save, complete the consent at `/oauth/consent`.
3. Install the personal plugin; in a chat (Work tab if prompted) type `@Preston Control` and run Test A–E from the plan.

### 6.5 Rollback / kill
- Instant: set `PRESTON_CONTROL_ENABLED=false` (surface → 503) or delete the ChatGPT app.
- Revoke: Supabase → OAuth Apps → disable/delete the client (all grants and refresh tokens die); or owner-side `revokeGrant`.
- Code: revert the single commit; no migration to roll back.

### 6.6 Security effect on existing users/sessions
None. Enabling the OAuth server adds endpoints under `/auth/v1/oauth/*`; existing password sessions, cookies, RLS and the runtime service identity are unaffected. Dashboard JWTs carry no `client_id` and are refused by `/mcp`.

## 7. Galaxy / Android (Phase G) — product-surface finding

Official position today: developer-mode MCP apps are **web (and desktop) only**; the Android app shows the plugins menu for first-party/published plugins. Therefore "Check Preston status" from the Galaxy ChatGPT app will not invoke a personal developer-mode plugin until OpenAI extends the surface. Preston security is **not** weakened to compensate.

Narrowest paths that reach Android without weakening Preston, in order of preference, to be chosen by the owner after Phase F:
1. **Wait for OpenAI** — Plugin Directory is already on Android; personal plugins are the announced direction (ChatGPT Work syncs across web/mobile). Zero Preston work.
2. **Mobile browser**: chatgpt.com in Samsung Internet/Chrome on the Galaxy (web surface, full plugin support). Zero Preston work; acceptable interim.
3. **Business plan + Custom GPT Actions facade**: an OpenAPI facade over the same six handlers (same auth module) would be reachable from the Android app's GPTs. Moderate work; only if 1–2 are unacceptable.
4. **Public Plugin Directory submission** — explicitly out of scope for v1.

## 8. Production promotion (Phase H) — not started

Bounded package to be assembled only after staging Test A–E pass: exact commit, Vercel prod env names, Supabase prod OAuth client (separate id/secret), PRM smoke, 401 smoke, consent smoke, Test A/B on prod with a harmless documentation goal, rollback = `PRESTON_CONTROL_ENABLED=false` + client disable, golden evidence under `reports/`. Requires an owner-approved RED gate.
