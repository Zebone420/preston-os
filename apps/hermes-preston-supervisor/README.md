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

## Install into a Hermes dashboard (owner action)

1. Build (above).
2. Copy the `dashboard/` directory to the dashboard host as
   `~/.hermes/plugins/preston-supervisor/dashboard/`.
3. Restart the dashboard (or GET /api/dashboard/plugins/rescan).
4. A "Preston" tab appears in the sidebar at /preston.

## Preston link configuration (owner gate - fail closed)

The plugin backend reads two environment values on the DASHBOARD
SERVER (never the browser):

    HERMES_PRESTON_CONTROL_URL     e.g. the staging origin (https)
    HERMES_PRESTON_CONTROL_TOKEN   bearer accepted by Preston Control

Until both are set, every surface shows a FAIL CLOSED "link not
configured" state. Note: Preston Control currently authenticates two
OAuth surfaces (mcp, gpt). A dedicated 'hermes' surface (own Supabase
OAuth client, revocable independently) is the designed owner gate -
see reports/HERMES_NATIVE_PORT_MATRIX_v1.md section E. This plugin
mints nothing and ships no credential.

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
