# Master Goal: Power-Station Foundation - Baseline Reconciliation

Date: 2026-08-27. Session: laptop (ZPC26), repo C:\dev\preston-os.
Master goal: laptop-independent, artifact-durable, capability-ready
foundation (owner master prompt, 2026-08-27).

## AUTHORITATIVE BASELINE

Verified directly from the repository and the committed live-drill
evidence of the fast-track promotion session (hours before this
session). Where a value can only be proven from the host or the live
SSOT, the evidence source is named; no value below is inferred from
pre-fast-track reports.

```text
Repo:
  branch  feature/final-build-fast-track
  HEAD    b3c00030d71f8fafb880be274cd90c3096a2fcec
  status  clean except 2 pre-existing untracked files
          (packages/guards/src/index.js,
           scripts/p1/p1_diagnose.local.ps1) - not part of this goal

Master:
  local master        b3c0003 (fast-forwarded during promotion)
  origin/master ref   b3c0003 (pushed during the promotion session;
                      live GitHub re-verification is owner-side - the
                      local H-6 guard blocks agent git fetch)

Staging:
  web alias           preston-os-staging.vercel.app @ 0c14f63
                      (b3c0003 is docs-only on top of 0c14f63;
                       code-identical)
  host                preston-agent-staging, ORCH_BASE_COMMIT=0c14f63,
                      timer 60s, ORCH_CLAUDE_EDIT_TOOLS=true
  Supabase            vcqtlmlaxxankxyezlul (staging SSOT)

Production:
  web                 preston-os-prod @ b3c0003
                      (dpl_BHu4cTkP6jhtykDDy9rcsvNV8Yew)
  host                preston-agent-prod 46.224.68.139,
                      ORCH_BASE_COMMIT=b3c0003,
                      ORCH_CLAUDE_EDIT_TOOLS=true, timer 60s,
                      token store v2 (access reuse proven live)
  fast-track promoted true (owner-authorized 2026-08-27 ~01:40Z;
                      smoke FTP1 goal 890af1ad real executed:true)
  Supabase            hiqsymsiwonmvrbbqhhe (production SSOT)

Staging migration:    0025_runtime_deployment_service_read.sql
                      (repo ledger 0001-0025; owner-applied)
Production migration: 0025 (+ prod-side evolutions of the 0010
                      staging pins recorded in the prod SSOT audit,
                      report 4365065)

Runtime state:
  orchestrator cadence  60s oneshot timer, both environments
  workers               bounded worker (claude adapter live; codex
                        adapter dispatch-correct but prod codex CLI
                        auth revoked - open owner action)
  retry/outcome         central authority EXISTS:
                        orchestration/outcomes.ts (fast-track A1);
                        consumed solely by completion-engine.step;
                        no second retry engine
  artifacts             NOT durable: worktrees removed post-run; only
                        result_excerpt + structured block survive.
                        Design doc exists
                        (docs/PRESTON_ARTIFACT_DURABILITY_DESIGN_v1.md);
                        no bucket, no table, no code path
  capability registry   does not exist (this goal builds it)
  side-effect ledger    does not exist (this goal builds it)
  notifications         coded, INERT (Telegram env unset). LATENT
                        DEFECT found this session: the approvals
                        branch selects a nonexistent `id` column of
                        orchestration_approvals (PK approval_id) -
                        would read-fail on the real DB. Fixed in this
                        goal.
```

Internal consistency: PASS. Local master == origin/master ref ==
prod deployed SHA == fast-track branch head. Staging is one docs-only
commit behind (intentional; re-promote optional). Migration ledger
0001-0025 matches the owner-applied state on both SSOTs per the
promotion evidence. No contradiction between repo, deployment
evidence, and SSOT audit (report 4365065) was found.

## Section-2 verification (failure-semantics kernel)

The fast-track build already implemented the central authority
(`apps/dashboard/src/lib/ai-os/orchestration/outcomes.ts`):
SUCCESS / RETRYABLE / TERMINAL / OWNER_GATED / CANCELLED, consumed
only by the completion engine; terminal refusals dead-letter on
attempt 1 (live-proven, prod goal 6b5d32c5 class of failure).
It is NOT rebuilt. Gap vs the master goal: no `uncertain_outcome`
class. This goal ADDS the UNCERTAIN class (never blind-retried,
settled only by reconciliation) without touching the existing
terminal/retryable semantics.

## Section-3 performance baseline (measured, live evidence)

```text
Idle orchestrator tick     C1 fast path: <=3 indexed limit-1 goal
                           probes + 1 controls read; no pin probe, no
                           executor composition, no provider I/O.
                           Logged duration_ms on host ticks; exit 0.
Goal pickup latency        <=60-70s (one 60s timer period; M1 staging
                           139s total incl. 139s real run; prod FTP1
                           pickup <=60s)
Provider-free single job   FTP1 (prod): 117s wall incl. real claude
                           execution, one tick
Two-job concurrent goal    M4 (staging): TWO real jobs in one tick,
                           185s wall (parallel driver, width 2)
SSOT queries per idle tick orchestrate-once: 1 controls + <=3 probes
                           (+1 bounded remote-intake read when 0011
                           configured); hermes tick: bounded
                           observe/status reads
Auth ops per idle tick     0 token mints (token store v2 access reuse;
                           store mtime frozen across ticks, live-proven
                           staging + prod)
```

Acceptance rule for this goal: provider-free paths must stay at this
baseline. Everything new is env-gated and dormant: zero provider
calls, zero credential reads, zero artifact/storage operations, zero
ledger reads on provider-free ticks. Structural tests pin this.

## Evidence sources

- repo HEAD/branch/status/migrations: direct git + filesystem this
  session
- promotion + runtime state: memory of the fast-track session
  (2026-08-27 ~01:40-02:05Z) whose evidence commits (b3c0003 report,
  994b7fd, c92236f, 4365065) are in this repo's history
- outcome authority / notifications defect: direct code reads this
  session (outcomes.ts, completion-engine.ts, notifications.ts,
  migration 0010)
