# ChatGPT <-> Claude Orchestration Bridge — Architecture Audit

Date: 2026-08-26
Status: AUDIT COMPLETE — NO IMPLEMENTATION PERFORMED
Baseline: master/prod @ 994b7fd (Preston Control G8 live, bounded-exec routing fix live), prod Supabase hiqsymsiwonmvrbbqhhe, migrations applied through 0025.
Method: two independent read-only code-mapping passes (Preston Control surface; orchestration/runtime pipeline), reconciled against the prod SSOT audit (4365065) and golden seal (af20c5e).

---

## 0. Headline finding

**The Preston-mediated delegation loop already exists and is production-proven.**
`Owner -> ChatGPT -> Preston Control -> prod SSOT -> Claude runtime -> evidence_refs -> ChatGPT` works today: prod goals have been submitted from ChatGPT, decomposed, picked up by the preston-orchestrator timer, really executed by the bounded Claude adapter (`real:...executed:true` evidence, `real-provider:...role:claude`), and read back over the same surface.

What is missing is NOT a bridge — it is **surface completeness**: cancel, follow-up, per-job reads, readable final results, and boundary notification. All are extensions of the existing `lib/preston-control` service layer. **No second orchestration model is needed; the existing SSOT model is sufficient.**

---

## 1. What already exists (Q1)

| Capability (handoff §8) | Status today | Mechanism |
|---|---|---|
| 1. Delegate work to Claude | **EXISTS** | `preston_submit_goal` / `submitPrestonGoal` -> composer -> `submit_goal_decomposition` RPC -> goal_jobs assigned_role=claude -> orchestrator tick -> real Claude adapter (8 fail-closed gate layers) |
| 2. Read task status/progress | **PARTIAL** | `preston_get_goal` (job_status_counts, per-job status/attempts), `preston_status`. No per-job endpoint; progress ceiling = one update per attempt per ~5-min tick; no intra-job progress by design (headless CLI) |
| 3. Read final result/evidence | **PARTIAL — biggest real gap** | `preston_get_evidence` returns opaque `evidence_refs` strings + failure_reason. The actual work product (worktree diff, CLI output) is NOT in the SSOT — it lives in host worktrees + orchestrator.log. No dereference endpoint |
| 4. Continue/follow-up a task | **ABSENT** | Terminal states have no outgoing edges; `submit_goal_decomposition` is all-or-nothing per goal. Today's idiom: new goal, prior goal referenced in prose |
| 5. Cancel/stop a task | **ABSENT on the ChatGPT surface** | Legal primitives exist (`transitionJob/transitionGoal -> cancelled` from every non-terminal state, CAS, fail-closed); `/api/os/jobs/cancel` is cookie-session dashboard-only and targets the separate os_jobs queue |
| 6. Route to Codex | **EXISTS (compose-time), runtime inert** | "using codex" phrase -> assigned_role=codex; real-codex-adapter is byte-parity with claude but `ORCH_REAL_CODEX_ENABLED` unprovisioned -> declines to simulation. Activation = owner env gate, zero code |
| 7. Surface owner approvals | **EXISTS (G8-sealed)** | `preston_list_approvals` + `preston_decide_approval` with server-side owner-confirmation handshake (exact-id phrase), DB-side one-time nonce + in-transaction audit (0021), `clear_approval_gate` (0022) |
| 8. Notify owner at boundary | **PARTIAL (pull only)** | Pending approvals + needs_attention appear in every status/goal read; Hermes writes minute-bucket attention rows. No push channel exists (Hermes send is an explicit later owner gate; live sends are RED) |

Supporting assets already built: two-transport surface (MCP client A + GPT Actions client B) over ONE service layer (`tools.ts`/`schemas.ts` — schemas shared, transports cannot drift); OAuth bridge fail-closed; projection allowlists + secret screens on every output; `actor_registry` with claude/codex/chatgpt roles; remote-intake pattern (`submit_remote_intake`/`read_remote_intake_status`) as a proven server-to-server template; `read_ssot_status` canonical read.

## 2. Reusable tables / RPCs / routes (Q2)

- **Tables (reuse as-is, no change):** master_goals, goal_jobs (incl. evidence_refs jsonb, run_id lease, iteration), job_dependencies, orchestration_approvals, orchestration_decisions, os_events, system_controls, actor_registry, audit_log.
- **RPCs (reuse as-is):** submit_goal_decomposition (0024), decide_orchestration_approval (0021), clear_approval_gate (0022), job_gate_required (0023), is_owner, read_ssot_status (0019), read_remote_intake_status (0011).
- **Routes/layers (extend, not replace):** `/mcp` + `/api/control/*` via `controlRoute()`; extension point = one shape in schemas.ts + one handler in tools.ts + one registerTool in server.ts + one path in openapi.ts + a ~15-line route file.
- **Store primitives (reuse):** casStatus/transitionGoal/transitionJob/transitionJobOwned, listGoalsByStatus, listJobsForGoal, listDependenciesForGoal, verifyAuthoritativeApproval, insertEvent (has secret-payload rejection).

## 3. What is missing (Q3) — gap analysis

G-1 **Cancel** (ChatGPT surface). Primitive exists; tool does not. Caveats (documented in code): cancelling an in_progress job does not kill the child process — the driver's run-owned terminal CAS then matches zero rows and the stale result is dropped (already the designed out-of-band-cancel behavior); worktree lock released by the driver's finally.
G-2 **Follow-up/continuation.** Appending jobs to a live goal fights `submit_goal_decomposition` atomicity + 0023 insert RLS. Correct shape: NEW goal linked to the parent (parent goal id carried in context and echoed in the read model), preserving every invariant.
G-3 **Per-job read.** `listJobsForGoal`/job select exists; no `preston_get_job` tool; dependencies never exposed.
G-4 **Readable final results.** Nothing persists a bounded result summary to the SSOT; evidence refs are opaque. Work products for code/test kinds stay in host worktrees (deliberately never auto-pushed). Two-part fix: (a) runtime emits a bounded, redacted result summary at job completion (os_events row via existing insertEvent, or an evidence_refs `result:` entry — both migration-free); (b) a surface read that returns it. Artifact/diff publication beyond a summary = future owner-gated design decision.
G-5 **Change-since cursor.** Every read re-fetches full projections; an os_events-based delta read is optional efficiency, not required.
G-6 **Push notification.** Out of scope for this bridge: any live send channel is RED / a later owner gate. The bridge treats "notify" as "guaranteed visible on next read" (already true) and leaves push to a separate gate.
G-7 **Codex live execution.** Code-complete; needs only owner env provisioning on the host (`ORCH_REAL_CODEX_ENABLED`, `ORCH_CODEX_EXECUTABLE`). Separate owner gate; no bridge dependency.

Latency note (not a defect): orchestrator timer = 5 min, `--max 10` driver cycles/tick; an approval decision takes effect the following tick. Tightening the timer is an owner host decision, orthogonal to this build.

## 4. Can it be built without migrations? (Q4) — YES

- Cancel: the surface authenticates AS the owner (owner bearer via OAuth), so RLS `is_owner()` applies and 0022's column grants permit status updates. Implement with the existing CAS transitions + an audit_log insert. An atomic `cancel_goal` RPC is a *optional hardening* deferred to a later migration gate (0026), not required.
- Follow-up: new-goal submission through the existing RPC; parent linkage carried in request context/correlation convention. No schema change.
- Per-job read: pure read, no schema change.
- Result summary: `insertEvent` into os_events (runtime identity already has insert; secret rejection built-in) — no schema change. evidence_refs append is the fallback.
- **Nothing in the proposed MVP requires: a migration, an RLS/policy change, a new identity, a secret, or a host-worker redeploy beyond the normal pinned-commit rebuild for the result-emitter (see Phases).**

## 5. Extend Preston Control vs new service? (Q5) — EXTEND

No new service, no new transport, no new OAuth client. All additions land in `lib/preston-control` + thin `/api/control/*` routes and are automatically present on BOTH surfaces (MCP + GPT Actions) because they share schemas.ts. GPT Actions additionally needs an owner-side schema re-import in the GPT editor (and the standing aip-callback-rotation re-check) — UX only, enforcement stays server-side.

## 6. Semantics mapping onto the goal/job model (Q6)

| Bridge verb | Maps to |
|---|---|
| delegate | preston_submit_goal (unchanged; "using codex" routes to codex) |
| status | preston_get_goal + NEW preston_get_job (job by id: status, attempts, run lease liveness, failure_reason, evidence_refs, approval linkage) |
| progress | derived: job_status_counts + iteration + per-attempt evidence; ceiling documented as per-tick |
| result | preston_get_evidence (unchanged) + NEW result-summary read (from os_events `JobResultRecorded`) |
| continue | NEW preston_follow_up_goal: submits a new goal via the existing composer path with parent_goal_id echoed in projections; parent must exist; inherits all composer guards |
| cancel | NEW preston_cancel_goal / job: CAS to cancelled on every non-terminal job then the goal; idempotent (already-terminal -> no-op report); **G8-style confirmation phrase required** ("Cancel goal <id>") since it is consequential |
| approvals | unchanged (list + decide with G8 handshake) |
| notify | unchanged pull semantics: pending_approvals/needs_attention in every status read; push = separate RED gate |

## 7. Approvals + idempotency preservation (Q7)

- decide path, action_hash binding, nonce one-time, 0021 audit, 0022 gate-clear: **untouched**.
- New writes: cancel is guarded by its own server-side exact-id confirmation phrase (same evaluateOwnerConfirmation pattern, new verb set) and is idempotent by CAS; follow-up inherits submit's request_id idempotency (deterministic replay -> duplicate). x-openai-isConsequential=true on cancel.
- Result-summary emitter is append-only, idempotent by deterministic event id (`ev-result-<job>-<attempt>`).

## 8. Avoiding polling (Q8)

ChatGPT surfaces are pull-only by platform; there is nothing to subscribe to. The rule enforced by this design: the bridge adds ZERO new pollers/loops — reads happen only when ChatGPT asks; the runtime's existing 5-min timers are the only cadence. The optional os_events delta cursor makes repeated status reads cheap; Hermes stays observe-only.

## 9. Smallest implementation phases (Q9) + RED gates (Q10)

- **B1 (GREEN, code-only, Vercel app only):** preston_get_job + parent-linkage echo in projections. Reads only. No runtime change.
- **B2 (GREEN, code-only, needs host rebuild at pinned commit):** result-summary emitter in driver/real-executor completion path (bounded, redacted, deterministic id) + surface read of it.
- **B3 (YELLOW, code-only):** preston_cancel with confirmation handshake + regression suite mirroring G8 tests.
- **B4 (GREEN, code-only):** preston_follow_up_goal.
- **B5 (staging drill):** full loop drill on staging alias — submit -> run -> get_job -> result -> follow-up -> cancel; negative drills (wrong-id/wrong-verb cancel phrase, cancel replay, follow-up on missing parent, secret-in-result screen).
- **B6 (PROD, RED):** owner ruling -> master fast-forward -> prod redeploy -> owner GPT editor schema re-import + aip-callback check -> prod smoke.

**RED / owner-only gates:** any production promotion (B6); any migration (only if the optional 0026 cancel RPC is later chosen); host env changes (Codex enablement, timer cadence); any push-notification/send channel; GPT editor publish + secrets (owner side); any change to approval/decide semantics (none proposed).

## 10. Exact files likely affected

Surface (B1/B3/B4): `apps/dashboard/src/lib/preston-control/{schemas.ts, tools.ts, server.ts, openapi.ts}`; new routes `apps/dashboard/src/app/api/control/jobs/[job_id]/route.ts`, `.../goals/[goal_id]/cancel/route.ts`, `.../goals/[goal_id]/follow-up/route.ts`.
Runtime (B2): `apps/dashboard/src/lib/ai-os/orchestration/driver.ts` (completion emitter), `apps/dashboard/src/lib/ai-os/real-executor.ts` (bounded summary source), `apps/dashboard/src/lib/ai-os/store.ts` (reuse insertEvent).
Tests: new `preston-control-cancel.test.ts`, `preston-control-jobs.test.ts`, `preston-control-follow-up.test.ts`, `result-summary.test.ts`; extend `preston-control-audit.test.ts` (projection allowlists), `preston-control-tools.test.ts`, openapi/schema pin tests.

## 11. Database impact — NONE (MVP)

No migration, no RLS/policy change, no new identity, no grant change. Optional deferred: 0026 atomic cancel RPC + richer result table (only if os_events proves insufficient).

## 12. Security impact

No new authority: same owner-bearer surfaces, same RLS, same 8 execution gate layers, executed/simulation CHECK pins untouched, system_controls untouched. New attack surface = 3 new operations, all owner-authenticated, strict-zod, projection-allowlisted, secret-screened; cancel is fail-safe-direction and handshake-guarded; result summaries pass hasSecretText + insertEvent rejection. No broadening of allowed paths, kinds, risk ceiling, or adapters.

## 13. Test plan

Unit: handshake matrix for cancel (10-case mirror of G8 suite), transition legality (cancel from every state incl. terminals -> no-op), idempotency replays, projection allowlist audits, openapi <=300-char description pin (GPT import limit), secret-screen on result summaries. Integration: driver emits result event exactly once per attempt; fake-store parity with 0021/0022 RPC ordering. Full matrix: vitest suite, tsc, eslint, next build, os-runtime build, secret + RED scanners.

## 14. Staging rollout plan

1. Land B1-B4 on feature branch, full matrix green. 2. Promote to staging alias (existing flow). 3. Staging MCP connector re-test (tools discovered live — no cached-schema issue on MCP). 4. Run B5 drill script + negatives; evidence report. 5. Staging GPT editor re-import (owner) only if GPT-surface testing needed pre-prod. 6. Owner reviews evidence -> B6 ruling.

## 15. Rollback plan

Code-only: revert commit / redeploy prior SHA (994b7fd known-good); removed tools disappear from both surfaces safely (MCP discovers live; GPT gets 404-on-unknown-op which is fail-closed). Global kill unchanged: PRESTON_CONTROL_ENABLED=false + disable OAuth clients. Runtime emitter rollback = rebuild host at prior pinned commit. No data rollback needed (all writes append-only or status-CAS).

## 16. Readiness impact

Capability coverage (handoff §8, eight items): today 4/8 full + 2 partial (~60%). After B1-B6: 7/8 full + notify-by-read (~90%). Remaining 10%: push notification channel (separate RED gate) and Codex live enablement (owner env gate, zero code). Manual copy/paste elimination: achieved for all GREEN/YELLOW work in eligible kinds {documentation, code, test, audit, recommendation}; migration/repair kinds and RED actions remain owner-gated by design.

---

Production touched: false. Secrets exposed: false. Live messages sent: false. Implementation: none (audit only).
