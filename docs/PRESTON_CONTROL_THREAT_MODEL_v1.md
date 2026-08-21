# Preston Control — Threat Model v1

**Scope:** the ChatGPT MCP adapter (`/mcp`, `/.well-known/oauth-protected-resource[/mcp]`, `/oauth/consent`) added post-live on top of golden baseline `prod-golden-0025`. The adapter is an *interface* over six existing owner functions; it introduces no new identity, table, RPC, or execution path.

**Trust boundaries**

```
ChatGPT (untrusted client, owner-operated)
   │ OAuth 2.1 bearer (Supabase Auth-issued JWT, client_id = Preston Control)
   ▼
/mcp  (Vercel, cookie-less)  ── auth.ts gates 1..8 ──►  RLS-bound client as OWNER
   │                                                        │
   ▼                                                        ▼
tools.ts (projections only)                     Supabase: is_owner(), RLS,
                                                  submit_goal_decomposition,
                                                  decide_orchestration_approval
                                                        │
                                                        ▼
                                 runtime@service.preston (timer) consumes, parks,
                                 clears gates, executes — unchanged
```

Authority stays where it was: the DB decides ownership (`public.owners`), the composer decides decomposition/gating, `decide_orchestration_approval` decides approvals, the runtime decides execution.

## Threats and controls

| # | Threat | Control(s) | Where |
|---|--------|-----------|-------|
| T1 | **Stolen ChatGPT OAuth session / leaked access token** | Token is a Supabase JWT: 1h expiry, signature verified by Supabase Auth on every call (`auth.getUser`). Revocation: owner revokes the grant (all refresh tokens for the client are deleted) or disables the OAuth client; `PRESTON_CONTROL_ENABLED=false` kills the surface instantly. Blast radius is bounded to the six tools: no shell, SQL, deploy, credentials, sends. Consequential write (`preston_decide_approval`) is additionally one-time per approval and audited with `auth.uid()`. | `auth.ts` gates 5–8; Supabase OAuth grant revocation; env kill switch |
| T2 | **Non-owner user authenticates** | Two independent owner checks: `OWNER_EMAIL_ALLOWLIST` (app, empty = nobody) **and** `public.is_owner()` (DB, `auth.uid() ∈ owners`). Non-owners get 403 before any tool is listed (no safe-read carve-out in v1). Consent page refuses to approve a grant for a non-owner or for a user other than the signed-in one. | `auth.ts` gates 7–8; `consent.ts` `user_not_owner` / `user_mismatch` |
| T3 | **Runtime service identity attempting an owner action** | `runtime@service.preston` is not in `owners`, so `is_owner()` is false → 403 at the gate; even if it reached the RPC, `decide_orchestration_approval` raises `owner_required` (0021). Its JWT also lacks `client_id`, so gate 6 refuses it before the DB. | `auth.ts` gate 6 & 8; migration 0021 |
| T4 | **Replay / duplicate requests** | `preston_submit_goal`: `request_id` is the composer request key → deterministic ids; same key+payload replays (`duplicate`), same key+different payload is refused (`idempotency_key_payload_mismatch`). `preston_decide_approval`: fresh `pc-` nonce per attempt; DB partial-unique nonce index + pending-only + FOR UPDATE make a second decision `already_decided`. Transport is stateless (no session id to replay). | `tools.ts`; `composer-persist.ts`; migration 0010/0021 |
| T5 | **Prompt injection (content in goals, evidence, approvals instructs the model)** | Tool output is data; the adapter never executes content. Output projections are explicit allowlists with bounded lengths. The consequential tool is annotated `destructiveHint:true` so ChatGPT requires user confirmation; Preston's own approval gates still apply to anything RED. Submitted text is data to the deterministic composer (no LLM in the intake path). | `tools.ts` projections; `server.ts` annotations; composer |
| T6 | **Malicious / malformed tool parameters** | Zod schemas: UUID regex for ids, `RUNTIME_ID_RE` for approval/request ids, enums for outcomes, max lengths (4000/2000/300). Schema failures return `isError` without touching the DB. Handlers re-validate (defense in depth). | `server.ts`; `tools.ts` |
| T7 | **Staging / production confusion** | `SUPABASE_RUNTIME_ENV` must be `staging|production` (`remoteSurfaceEnvAllowed`); each Vercel environment has its own Supabase project, OAuth client, and `PRESTON_CONTROL_OAUTH_CLIENT_ID`; a token from the staging project cannot verify against production's Auth and vice-versa. `environment` is stamped on every goal by `runtime_deployment` (0017/0025) and echoed in `preston_status`. | `auth.ts` gates 2, 5–6; existing env pinning |
| T8 | **MCP endpoint exposure (public URL)** | Disabled by default; 401 for any request without a valid owner bearer (initialize included); 413 before body read; no GET stream, no sessions; DNS-rebinding irrelevant (no browser origin trust). Metadata endpoint is public by design (RFC 9728) but reveals only the Supabase issuer URL, which is already `NEXT_PUBLIC_`. | `route.ts`; well-known routes |
| T9 | **Stale / revoked OAuth token** | Verified on every request by Supabase Auth; revoked grants and expired tokens yield 401 + `WWW-Authenticate` so the client re-authorizes. No caching of auth decisions. | `auth.ts` gate 5 |
| T10 | **Privilege escalation** | Anon key + owner JWT only: RLS-bound; service role is never used (tested by source assertion). The adapter calls only `is_owner`, `submit_goal_decomposition` (via composer), `decide_orchestration_approval`, and bounded selects. No table UPDATE on `goal_jobs`/`orchestration_approvals` (privileges revoked in 0010/0022 anyway). | `route.ts`; test `repo wiring` |
| T11 | **Secret leakage into model context** | Allowlist projections (nonce, action_hash, owner_identity, run_id never emitted); `looksSecret()` screen (shared `hasSecretText` + token shapes) redacts free text and evidence refs; inputs containing secret shapes are rejected (`secret_in_request`, `secret_in_reason`). Errors are tag-only (never raw DB messages). Token value is never logged or echoed. | `tools.ts` |
| T12 | **Direct Preston bypass** | The adapter has no path to `os_jobs`, shell, git, n8n, Airtable, or messaging. "Deploy this" becomes a goal the composer classifies and gates. Kill flags (`owner_stop`, `paused`, `execution_enabled`) are respected by the runtime, not overridable here. | design; exclusions list |
| T13 | **Compromised ChatGPT conversation (attacker drives the owner's connected ChatGPT)** | Same bound as T1 plus: writes require ChatGPT's confirmation prompt; approvals are one-time and audited; nothing RED/BLACK executes without a Preston approval the attacker would have to pass through the same audited RPC; owner can revoke the grant and flip `PRESTON_CONTROL_ENABLED`. Residual risk accepted: an attacker with the owner's live ChatGPT could approve a pending GREEN/YELLOW-gated staging job — identical to the risk of the owner's dashboard session. | as T1/T4 |
| T14 | **Tool hallucination / wrong tool or args** | Narrow schemas; descriptive tool titles; `preston_decide_approval` description instructs confirmation of `approval_id` + action text; invalid ids fail closed. Annotations are accurate so ChatGPT's policy (confirm writes, block risky) engages. | `server.ts` |
| T15 | **Consent-page abuse (open redirect, CSRF, wrong client)** | `next` continuation admits only `/oauth/consent?...` same-origin; consent approves only `PRESTON_CONTROL_OAUTH_CLIENT_ID` (DCR clients denied), only allowlisted scopes, only the signed-in owner; redirects follow the Supabase-returned `redirect_url` (exact-match registered URIs). Server actions re-check the owner. A failed gate always *denies* upstream. | `consent.ts`; `actions.ts`; proxy |
| T16 | **MCP outage affecting Preston** | Nothing in the runtime, timer, dashboard, intake, or approvals imports `preston-control` (tested). The adapter is read-through; if Vercel is down, the DB and host runtime continue. | test `outage isolation` |

## Revision 2 additions — GPT Actions surface and PKCE bridge

| # | Threat | Control(s) | Where |
|---|--------|-----------|-------|
| T17 | **Cross-surface token reuse** (a GPT-surface token used on `/mcp`, or vice-versa) | Each surface has its own OAuth client; gate 6 compares `client_id` to the surface's configured id → 403 `wrong_client`. Revoking one client leaves the other intact. | `auth.ts` `surface` |
| T18 | **Open redirect via the bridge callback** | ChatGPT redirect must EQUAL the configured `PRESTON_CONTROL_GPT_CALLBACK_URL` (exact string from the GPT editor; no host/id/path/query patterns) at authorize time, travels only inside HMAC-signed state, and is re-checked against the current configuration when the state is unpacked; callback refuses any unsigned/tampered state. | `gpt-bridge.ts` |
| T19 | **Forged or replayed bridge state / code** | State signed with `PRESTON_CONTROL_GPT_BRIDGE_KEY`; composite code binds the Supabase code to the nonce whose verifier only the bridge can derive; Supabase codes are single-use, 10 min. | `gpt-bridge.ts` |
| T20 | **Bridge token endpoint abused as an oracle** | Client B id + secret verified in constant time before any upstream call (tested: `fetch` never invoked on a bad client); only `authorization_code` and `refresh_token` grants; 8 KiB body cap; tag-only errors; response filtered to OAuth fields. | `token/route.ts` |
| T21 | **Client B secret in Vercel env** | Env-only, never logged/returned, constant-time compared, rotatable in Supabase; compromise scope = ability to complete an OAuth exchange that still requires the owner's live consent + Supabase code — no token can be minted without the owner's browser session. | env policy |
| T22 | **GPT Actions confirmation bypass** | `x-openai-isConsequential:true` on both writes forces a prompt; approvals remain one-time/owner-only/audited in the DB regardless of client behaviour. | `openapi.ts`; 0021 |
| T23 | **OpenAPI document exposure** | Public only while enabled; describes shapes and the bridge URLs; contains no ids or secrets (tested). | `openapi.json/route.ts` |

## Residual risks / notes

- Supabase OAuth 2.1 Server is **beta**. If it is withdrawn, the adapter's gates 5–8 are unchanged; only the token issuance path would need a replacement.
- Plus/Pro write-tool availability in ChatGPT is contradictory in OpenAI's docs (developer docs: yes with confirmation; help center: Business/Enterprise). Resolved empirically in Phase F.
- ChatGPT **Android** does not expose developer-mode MCP apps today (help center, 2026-08-19: "web only"). This is a product-surface limit, not a Preston failure; see the spec's Phase G section.
