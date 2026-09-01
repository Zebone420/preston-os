# Preston Supervisor - native Hermes dashboard plugin (v0.1)

Read-only Preston Control supervisor as a first-class module for the
official Hermes Agent dashboard (Nous Research). Ported from the
staging-verified standalone reference implementation
(preston-os branch feature/hermes-dashboard @ 1f97e87).

Architecture (fixed):

    Owner -> ChatGPT / Admin Council -> Preston Control -> Claude/Codex
    Hermes dashboard -> THIS plugin -> Preston Control (reads only)

Preston Control remains the sole orchestration/control authority.
This plugin observes; it can never execute, approve, cancel, submit,
or write. See test/security-boundary.test.ts for the pinned proof.

## Layout (official drop-in plugin contract)

    dashboard/
      manifest.json      tab "Preston" at /preston, icon Shield
      dist/index.js      built IIFE bundle (npm run build)
      dist/style.css     theme-variable styles
      plugin_api.py      FastAPI routes (GET only), mounted by the
                         dashboard at /api/plugins/preston-supervisor/*
                         BEHIND the dashboard auth gate
      preston_client.py  the ONLY Preston doorway: 7 allowed reads
      src/               TypeScript source (domain logic + SDK UI)

## Build

    npm install
    npm run build        # emits dashboard/dist/{index.js,style.css}
    npm test             # builds + 47 vitest tests
    npx tsc --noEmit     # typecheck
    python -m unittest discover -s dashboard -p "test_*.py"

dist/ is gitignored repo-wide; always build before installing.

## Install into a Hermes dashboard (verified live on v0.21.0)

HERMES_HOME on Windows is %LOCALAPPDATA%\hermes (not ~/.hermes).

1. Build (above).
2. Copy `plugin.yaml` plus the `dashboard/` directory (manifest,
   dist/, plugin_api.py, preston_client.py) to
   `<HERMES_HOME>/plugins/preston-supervisor/`.
3. Enable the plugin - user plugins are gated off until explicitly
   activated (Hermes security fix #46435), and the tool-override
   capability must stay DECLINED:
       hermes plugins enable preston-supervisor --no-allow-tool-override
4. Restart the dashboard (`hermes dashboard --stop`, then
   `hermes dashboard`): plugin API routes mount at boot.
5. A "Preston" tab appears in the sidebar at /preston; with no link
   configured it shows the fail-closed PRESTON LINK state.

## Preston link configuration (owner gate - fail closed)

The plugin backend reads its configuration on the DASHBOARD SERVER
only (never the browser). Preston Control authenticates three
per-surface OAuth clients (mcp, gpt, hermes); the dedicated 'hermes'
confidential client is valid for the seven read routes ONLY and is
revocable independently of the other surfaces.

Environment (names only; values are owner-held, staging first):

    HERMES_PRESTON_CONTROL_URL          staging origin (https)
    HERMES_PRESTON_OAUTH_TOKEN_URL      auth-server OAuth token URL
                                        (https, ends /oauth/token)
    HERMES_PRESTON_OAUTH_CLIENT_ID      hermes client id (non-secret)
    HERMES_PRESTON_OAUTH_CLIENT_SECRET  hermes client secret
    HERMES_PRESTON_TOKEN_STORE          path of the refresh-token
                                        store file (service-account
                                        readable only)

Durable auth = dashboard/token_client.py: cached access token reused
until near expiry, then a refresh_token grant (client_secret_basic)
whose ROTATED refresh token is persisted atomically before use. No
static long-lived bearer path exists. Any missing/invalid piece
fails closed to static error tags.

One-time seeding: the owner runs `python tools/link_bootstrap.py`
(authorization-code + PKCE, loopback redirect on 127.0.0.1), signs in
as the owner, approves consent; the script writes the store and
prints only the store path - never a token.

Until configured AND seeded, every surface shows the FAIL CLOSED
"link not configured" state. This plugin ships no credential.

## Dev harness (no Hermes install required)

    cd devharness && python -m http.server 9200 --bind 127.0.0.1
    open http://127.0.0.1:9200

Renders the built bundle against a mock SDK + recorded staging
fixtures (clearly labeled; no live data, no credentials). Use
`?unconfigured=1` to preview the fail-closed state.

## Security boundary (Phase 13)

Pinned by tests, not prose: no Claude/Codex calls, no shell or
process spawning, no Hermes admin API usage (config/cron/MCP/system/
keys/gateway/channels/webhooks/sessions), no Preston SSOT access, no
write/consequential Preston op, no approval/cancel authority, no
owner-confirmation phrase, no credential in frontend code or browser
storage, GET-only backend routes, op allowlist = exactly the 7
supported reads.
