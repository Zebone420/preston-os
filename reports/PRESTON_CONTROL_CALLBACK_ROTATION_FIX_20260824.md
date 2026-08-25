# Preston Control - third aip callback rotation repaired on staging (2026-08-24)

## Root cause

ChatGPT GPT publish rotated the action's aip callback id again (third rotation):
`g-925d6cfd...7261` -> `g-40de67e6...5b16` -> `g-168bc427cdf5b0db53f3bfa4e1482bc713fd97b0`.
The staging alias runtime still pinned the second value in the Production-scope
`PRESTON_CONTROL_GPT_CALLBACK_URL`, so the bridge correctly refused the new
redirect_uri with `invalid_redirect` (exact-match pin working as designed).

Runtime value was proven WITHOUT reading the sensitive var: authorize-leg GET
probes against the alias (redirects not followed, no code minted) showed 302
only for the g-40de67e callback pre-fix.

A Preview-scope branch-pinned CALLBACK_URL row had been edited minutes earlier
(owner-side attempt); Preview rows never reach the alias, and Vercel refuses
`target=production` on gitBranch-pinned rows - same env-scope trap as 08-23/24.

## Change made (staging Vercel project only)

- Edited the existing Production-scope `PRESTON_CONTROL_GPT_CALLBACK_URL`
  (Sensitive, write-only) to the g-168bc427 callback URL. No other var touched.
- Rebuilt the alias via the dashboard Redeploy (build cache off).
- No OAuth client id/secret rotation (probe proved credentials fine).
- No GPT editor changes. No DB changes. Real production project untouched.

## Deployment facts

- Alias: preston-os-staging.vercel.app
- Prior alias deployment: preston-os-staging-cqi0z5kzc (owner-created, 6550145)
- New alias deployment: 3fcrzdTgKy2TuQ6mzSNKtXLN3LbF - Ready 37s,
  Environment: Production, source feature/preston-control @ 6550145.

## Verification (bounded, no consequential actions)

- Authorize probe, NEW g-168bc427 callback: HTTP 302 -> Supabase
  /auth/v1/oauth/authorize, S256 PKCE, state binds the new callback. PASS.
- Negative controls: g-40de67e and g-925d6cfd callbacks -> 400
  `invalid_redirect` (fail-closed pin still enforced). PASS.
- Smoke: /api/control/openapi.json 200; /api/control/status 401
  missing-token. Fail-closed posture intact.

## Owner next step

Retry the GPT sign-in in a NEW Preston Control chat (a fresh chat uses the
latest published GPT version; old chats stay pinned to stale OAuth config).
Standing reminder: ANY future GPT publish that touches OAuth settings can
rotate the aip callback id again - re-check and re-pin before retesting.
