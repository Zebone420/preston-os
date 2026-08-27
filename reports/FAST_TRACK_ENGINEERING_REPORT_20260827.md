# Preston Final Build Fast-Track — Engineering Report (2026-08-27)

Branch: `feature/final-build-fast-track` (base: sealed B6 `c92236f`).
Staging-validated. Production promotion is a separate SHA-bound owner gate.

## What changed (by phase)

### A — Orchestration authority
- `orchestration/outcomes.ts`: the SINGLE retry-vs-terminal authority
  (`classifyFailure`). TERMINAL = deterministic contract refusals
  (provider/kind/risk/pins/approval refusals); RETRYABLE = transient
  process/provider/lease faults; unrecognized reasons fail open to the old
  bounded-retry behavior. Consumed ONLY by the completion engine; the
  classification reason is persisted on dead-lettered rows.
- Unknown-kind fails closed at BOTH layers: the composer rejects
  `ambiguous_request:task_kind_unresolved:<id>` at the boundary (live-proven
  drill M2), and the engine dead-letters any `unknown`-kind row immediately
  with `unsupported_kind:*` (zero attempts consumed; new legal
  pending/ready/assigned -> dead_lettered edges carry it).
- A3: job policy classification now includes the TITLE together with the
  objective (the worker prompt contains both; a gated action named only in a
  caller-supplied title now escalates identically).
- A4 (bare-audit routing): verified ALREADY FIXED in the sealed baseline
  (`c870b40`, test-pinned; the 2026-08-26 02:45Z prod dead letters pre-dated
  it). No change needed.

### B — Structured result contract
- `lib/ai-os/structured-result.ts`: versioned machine block
  (`BEGIN_PRESTON_RESULT { schema_version: 1, summary, files_touched,
  tests_run/passed/failed, commit_sha, artifacts, limitations,
  recommended_next_action } END_PRESTON_RESULT`), schema-validated,
  span-secret-scrubbed, bounded. Parse failure records `structured: null` +
  a typed `structured_error` — never fabricated.
- Both adapters (claude + codex) request the block via the shared prompt,
  parse it from the FULL CLI result text, strip it from the human excerpt.
- `JobResultRecorded` payload + Preston Control `result_reports` projection
  gained `structured`, `structured_error`, `provider_model`, `duration_ms`
  (additive, backward compatible).

### C — Fast path / latency
- Idle fast path in `orchestrate-once`: one limit-1 read per driveable
  status short-circuits an idle tick (no pin probe, no window hydration, no
  executor composition); tick logs `idle: true` + measured `duration_ms`.
- Token store v2: the rotating store now persists
  `{v:2, refresh_token, access_token, access_expires_at_ms}`; a valid cached
  access token is REUSED without a refresh grant (2-min expiry margin);
  rotation/fail-closed semantics unchanged; legacy bare-string stores still
  read. Live proof: staging store mtime frozen across 4+ ticks (previously
  rotated every tick).
- Orchestrator timer template: `OnUnitInactiveSec` 5min -> 60s. Live on
  staging: ticks every ~70s, idle/parked tick wall time ~4s.

### D — Bounded parallel throughput
- Driver: run actions execute in bounded parallel batches
  (`maxParallel` clamped 1..4; default 1 in the library). Every run keeps its
  own worktree lock, run_id lease CAS, control re-checks, and result event.
- Dispatcher: `ORCH_MAX_PARALLEL_JOBS` (default 2), multi-goal ticks
  `ORCH_MAX_GOALS_PER_TICK` (default 2) with a soft wall budget
  `ORCH_TICK_SOFT_BUDGET_MS` (default 240s); per-tick `goalsDriven` +
  `duration_ms` telemetry.
- Live proof (staging drill M4): two REAL claude runs in ONE tick,
  185s wall for two ~140s runs (genuine overlap), distinct run ids, one
  result event each, goal completed in one cycle.

### E — Routing table
- `orchestration/routing.ts`: versioned, explicit kind->model table from
  owner env (`ORCH_MODEL_*`; conservative name shape; unset = provider CLI
  default = prior behavior). Decision recorded per run
  (`provider_model`, `routing_reason`).

### F — Codex
- Verified PRODUCTION-PROVEN from evidence (prod executed:true jobs
  97c7be23…, dual-role goal a7b7abed; prod worker.env carries the codex gate
  + CLI installed). NOT rebuilt. Brought into the unified contract: routing
  model arg, structured-result parsing, shared prompt (orientation/retry
  context/machine block). Staging has no codex install; live codex re-drill
  belongs to the production smoke after promotion.

### G — Worker context
- `WORKER_CONTEXT.md` at repo root (repo map, commands, boundaries, result
  contract); prompt tells workers to read it first — live-proven (the first
  drill worker's report begins "Read WORKER_CONTEXT.md first").
- Retries KEEP the prior `failure_reason` on the row and the prompt gains a
  bounded PREVIOUS ATTEMPT section (reason + last evidence refs).

### H — Owner attention loop
- `lib/ai-os/notifications.ts` + os-runtime Telegram port
  (`telegram-notify.ts`, faithful port of the lib/telegram fail-closed
  contract): hermes tick now runs observe -> evaluate -> needs_attention ->
  notifier. Events: approval_required / job_dead_lettered / goal_failed.
  Durable dedup via idempotent `ev-notify-*` os_events rows (one send per
  event EVER), bounded 5/tick, hermes keeps zero execution authority.
  FULLY INERT until the owner sets TELEGRAM_BOT_TOKEN +
  TELEGRAM_OWNER_CHAT_ID on the host — that activation is an owner gate.

### I — Artifact durability
- Design + exact owner gate prepared:
  `docs/PRESTON_ARTIFACT_DURABILITY_DESIGN_v1.md` (metadata table +
  Supabase Storage bucket + bounded post-run persist step). No
  infrastructure was created.

### J — Redaction
- Span-level redaction in the control-plane read path: secret VALUE shapes
  are replaced in place; keyword-only prose survives; any value shape the
  spans cannot localize still redacts the whole field. Live proof: the first
  drill's result_excerpt (which mentions scanner names — previously fully
  `[redacted]`) reads back as full prose.
- Structured-block projection screens on value shapes only (keyword screen
  nulled honest blocks — found live, fixed).

### K — Cleanup
- npm >=11 lockfile debt CLOSED: lockfile regenerated with host npm 11.16,
  `npm ci --dry-run` validated on both platforms.
- `/remote` stale Phase-4 copy refreshed to the proven current state.
- New env names documented in `env.template` (names only).

### Worker file-changes capability (from the first live drill)
- FINDING: the non-interactive claude CLI denies every write, so
  documentation/code jobs could only analyze and report — `files_changed`
  was `[]` on every run B5/B6 ever recorded ("bounded execution" was in
  practice bounded ANALYSIS).
- FIX: env-gated (`ORCH_CLAUDE_EDIT_TOOLS=true`) FIXED file-tools allowlist
  (`Read,Glob,Grep,LS,Edit,Write,MultiEdit` — never shell, never network)
  so workers can produce real file changes inside the isolated worktree; the
  existing post-run path-allowlist audit + worktree disposal enforce
  containment. Enabled on STAGING only.

## Phase L (session resume): DEFERRED by design
Follow-up provenance already covers continuation. Model-session persistence
across permission/risk boundaries has unresolved safety semantics
(approval-boundary leakage); per the master goal's own rule — "if safe
semantics are uncertain, defer" — deferred.

## Regression state
- Full matrix at `0c14f63`: 1591 tests / 1585+ pass, 1 expected fail,
  5 known-env bash-ENOENT (this machine class; scanners compensate 0/0);
  tsc, eslint, next build, os-runtime build all clean; secret + RED
  scanners 0/0.
- Sealed-contract live regressions on the new staging build: approval
  handshake refusal + cancel handshake refusal byte-per-contract (drill
  M5/M6), prohibited external message rejected (M3), gated migration shape
  still YELLOW + parked (M5), idempotency & parity pins unchanged in suite.

## Staging drill IDs (evidence)
- M1 doc goal: goal bbe1ea1b / job 23249a95 — real executed:true, completed
  in one tick, duration_ms 139450, pickup <=70s.
- M2 unknown kind: rejected `ambiguous_request:task_kind_unresolved:t1`.
- M3 prohibited: rejected `prohibited:external_message(,2)`.
- M4 parallel: goal aa39a741 / jobs c87b7564 + c392d309 — both real in one
  tick (185s wall), goal completed cycles:1.
- M5 gated: goal 6b6ea7d2 / apr-ba1793cd5f71c5a473e4f594 — approval + cancel
  refusals exact; goal parked awaiting owner.
- M7 file-change drill: goal 00eabb2f / job 6308f78d — FULL PASS at
  0c14f63: worker CREATED apps/dashboard/docs/FAST_TRACK_MARKER_FTM7_
  20260827.md in its worktree (files_changed non-empty for the first time in
  platform history), and the STRUCTURED BLOCK flowed end-to-end (schema v1,
  honest summary, files_touched, artifacts, limitations honestly reporting
  that tests/scanners/git stayed shell-blocked, commit_sha null,
  recommended_next_action) — validated at the adapter, persisted in the
  JobResultRecorded event, and read back through ChatGPT. duration_ms 85675.
  The worktree file was discarded with the worktree post-run as designed —
  exactly the gap the artifact-durability owner gate closes.

## Residue (staging, honest states)
- M5 gated goal parked; approval expires 2026-08-28T01:08Z.
- 9 pre-existing B5 approval-parked goals still skipped each tick
  (expired/unverifiable approvals; owner cancels would clear them).
