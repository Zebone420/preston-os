# Preston Control G8 - release gate evaluation (2026-08-25)

Release candidate: 4cd20d3 (= ec0698b G8 invariant + 71eb806 description fix
+ 4cd20d3 test-only fake alignment). origin/feature/preston-control =
4cd20d3. Staging alias serves 2tn9zRsfCaY7vz3GHsNuDtY7Vuoi built from
71eb806, which is ARTIFACT-EQUIVALENT to 4cd20d3 (diff touches only 4 test
files).

## Validation matrix at 4cd20d3 (all agent-run)

- Full suite: 1496 pass + 1 expected fail + 5 known worktree-prep Windows
  env failures (same set as every prior run; compensated by direct Git Bash
  runs: bash -n 3/3 OK, secret scan 0, RED boundary scan 0).
- Focused control suites (incl. G8 owner-confirmation regression suite,
  orchestration approval decide, migration pinning, MCP route/tool, GPT/
  OpenAPI): 96/96.
- tsc 0, eslint 0, next build pass, os-runtime build pass.
- Pre-commit scanners at 4cd20d3: secret 0 / RED 0.
- Staging smoke (alias, live): openapi.json 200 with owner_confirmation +
  server-enforced-handshake contract; /api/control/status 401; MCP PRM 200.
- G8 live staging acceptance (2026-08-25 ~02:04Z): cases a-f all correct;
  exactly one decision; replay refused (not_pending).

## Phase H prerequisite gates (spec section 7)

1. Staging Tests A-E (live ChatGPT MCP connector, spec 6.3): **BLOCKED -
   NOT RUN.** The Developer-mode MCP connector has never been installed; it
   requires the owner to enter client A id + SECRET into ChatGPT (1Password;
   credential entry is owner-only by standing rule). Supporting evidence
   only, not a substitute: the in-repo MCP suite drives a real MCP client
   against the same server code and passes (authorization boundaries,
   owner-only decide, confirmation invariant, read-only ops, guest/runtime
   refusals), so the contract is code-proven; the live-connector gate
   remains owner-side.
2. Galaxy G1-G8 on the new build (spec 6.5): **BLOCKED - NOT RUN.**
   Physical Galaxy device drill; the prior device run was against the
   pre-G8 build (it exposed the G8 defect). The desktop-web equivalent of
   the G8 case matrix passed on the new build, but the documented gate is
   the device drill.
3. Prod OAuth clients A'/B' + prod Vercel env values: **NOT DONE** -
   owner/secret-side by design; agent is prohibited from credential
   handling.
4. Owner-approved RED gate ruling for Phase H: cannot be satisfied while
   gates 1-3 are open (spec: promotion comes AFTER Tests A-E + Galaxy
   pass).

## Decision

**BLOCKED - production promotion NOT performed.** Mandatory Phase H
prerequisites are open and owner-side. Production Vercel project, prod
host, prod SSOT: untouched. No migrations. No credential/OAuth changes.

## Owner unblock sequence (in order)

1. ChatGPT web -> Developer mode -> add MCP connector, URL
   https://preston-os-staging.vercel.app/mcp, OAuth client A id + secret
   (from 1Password), scope email -> consent -> run Tests A-E; agent
   verifies server-side and records evidence.
2. Galaxy: re-run G1-G8 per spec 6.5 against the current build (G8 now
   expects the restatement handshake: ambiguous "Approve that." must make
   NO decision and ask for the exact id).
3. On both passing: owner issues the Phase H RED gate ruling; agent then
   executes the prod promotion checklist (clients A'/B' are owner-created;
   agent handles non-secret env names, deploy, smokes, evidence).
