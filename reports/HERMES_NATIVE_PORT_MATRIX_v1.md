# Hermes Native Port Matrix v1 (2026-09-01)

Source of truth being ported: feature/hermes-dashboard @ 1f97e87
(staging-verified Hermes Supervisor Dashboard v0 on Vercel/Next).
Target: native "Preston Supervisor" plugin for the official Hermes
Agent dashboard (Nous Research), drop-in plugin contract per
https://hermes-agent.nousresearch.com/docs/user-guide/features/
extending-the-dashboard (manifest.json + prebuilt IIFE bundle +
optional plugin_api.py FastAPI router mounted at
/api/plugins/<name>/*, behind the dashboard auth gate).

## A. Domain logic - REUSE (pure TS, ported near-verbatim)

| v0 module (apps/dashboard) | Port target | Notes |
|---|---|---|
| src/lib/hermes/feed.ts | dashboard/src/domain/feed.ts | mergePage dedup by deterministic event_id; backfill marking; notification classes; cursorStorageKey per Preston env. Unchanged semantics. |
| src/lib/hermes/view-models.ts | dashboard/src/domain/view-models.ts | metricFromState UNKNOWN-honesty; toMetrics/toHeader/toGoalCard/toJobRow/aggregateJobRows. Wire types become structural (JSON over the plugin API, no TS service-layer import). FIX applied: evidence refs of the form artifact:art-<hex> now resolve to the artifact view (v0 cosmetic defect). |
| test/hermes-feed.test.ts | dashboard/test/feed.test.ts | ported |
| test/hermes-view-models.test.ts | dashboard/test/view-models.test.ts | ported + prefix-ref cases |
| test/hermes-guardrails.test.ts | dashboard/test/security-boundary.test.ts | rewritten for the plugin boundary (TS + Python sources; Hermes-admin bypass bans added) |

Assumptions preserved: SB-1 same-millisecond ordering is SERVER
authority (Preston Control sorts; client never reorders); cursor is
opaque; cursor_invalid is an error state, never an empty feed; replay
after (re-)anchor is history, never notified.

## B. Presentation - ADAPT (rewritten on the Hermes plugin SDK)

| v0 surface | Port target | Adaptation |
|---|---|---|
| /hermes page.tsx (server component) | PrestonTab overview (client, SDK.components Card/Badge/...) | Server-rendered data fetch becomes client fetch of the plugin API; internal state-based subviews replace Next routes. |
| goals/[id], jobs/[id], artifacts/[id] pages | in-tab detail views (state routing) | Plugin tabs get ONE path (/preston); deep views are internal navigation. |
| event-feed.tsx (client) | ui/feed view + shared poll hook | localStorage key renamed hermes-preston.cursor.<env>; same phases (anchoring/live/reanchor_required/error). |
| Next nav-config entry | manifest.json tab {path:/preston, label:Preston} | Hermes sidebar handles nav. |
| Tailwind slate classes | SDK components + small style.css on --color-*/--radius theme vars | Host CSS is precompiled; arbitrary tailwind classes are NOT available to plugins. |

## C. Retired (Vercel/Next-specific - NOT ported)

- src/lib/hermes/adapter.ts in-process delegation to
  lib/preston-control/tools.ts (owner cookie-session RLS client):
  impossible from a separate Hermes service. Replaced by a thin
  backend proxy (plugin_api.py) against Preston Control's supported
  authenticated HTTP surface (/api/control/*), GET-only, 7 reads.
- /api/hermes/events Next route (resolveOwner cookie gate): replaced
  by the plugin API route behind the Hermes dashboard auth gate.
- Next proxy.ts owner gate, force-dynamic, resolveOwner: Hermes
  dashboard session auth replaces it INSIDE the dashboard; Preston
  Control's own 8-gate bearer auth still guards every actual read.

## D. Authority path (target)

Owner device -> Hermes dashboard (auth gate) -> plugin frontend
(/preston tab) -> plugin backend /api/plugins/preston-supervisor/*
(GET only) -> Preston Control REST /api/control/* with a
server-side bearer -> RLS-bound reads. The bearer NEVER reaches the
browser; unconfigured = fail-closed "link not configured".

## E. New machine-to-machine auth - GATE REQUIRED (not created here)

Preston Control auth (lib/preston-control/auth.ts) accepts exactly
two OAuth surfaces ('mcp', 'gpt'), each a separate Supabase OAuth
client so either can be revoked alone. A Hermes plugin backend is a
THIRD machine surface. Correct design (owner gate, NOT implemented in
this slice): add surface 'hermes' + PRESTON_CONTROL_HERMES_OAUTH_
CLIENT_ID handling in auth.ts, create the Supabase OAuth client, and
grant the plugin a token via the existing OAuth flow. Until then the
plugin reads env names HERMES_PRESTON_CONTROL_URL /
HERMES_PRESTON_CONTROL_TOKEN (values owner-managed, server-side
only) and fails closed when absent. No client/token/secret is created
by this slice.
