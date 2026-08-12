# CODEX PRODUCTION ACTIVATION OWNER PACKET v1

Date: 2026-08-12. Status: PLAN. Codex code gate is READY (adapter +
dispatch committed d55e3ed; adversarial review: NO CONFIRMED FINDINGS).
Nothing here activates anything. Prerequisite: P2 Claude bounded
execution PASS (D-P2-3), because Codex reuses the exact same executor,
worktree, capability, and audit machinery Claude proves first.

## What is already done (code, inert)

- real-codex-adapter.ts: same 7-control fail-closed gate as Claude,
  own env gate ORCH_REAL_CODEX_ENABLED + executable ORCH_CODEX_EXECUTABLE
  (fixed basename allowlist {codex,codex.exe}), provider pin
  provider_not_codex, fixed argv contract buildCodexArgs -> ['exec',
  '--json', <prompt>]. Inert: with ORCH_REAL_CODEX_ENABLED absent the
  probe returns 'unavailable' and a codex job declines to simulation.
- real-executor.ts: dispatch by job.assigned_role (codex -> codex
  adapter, else claude). Worktree provision, post-run path-allowlist
  ENFORCEMENT, and guaranteed worktree removal are provider-agnostic.
- Tests: 28 adapter + 4 executor dispatch; suite at baseline parity.
- No migration required: goal_jobs.assigned_role, agent_contracts.role,
  actor_registry.actor_role all already allow 'codex'.
- codex-1 actor row exists in prod, DISABLED.

## DECISION POINT (owner must resolve before enabling)

Does the installed Codex CLI authenticate from a HOME-DIR credential
file (like Claude), or does it require an API-KEY ENVIRONMENT VARIABLE?

- HOME-DIR credential  -> no invariant change. Proceed as below.
- ENV-VAR API key      -> satisfying it means adding that var to
  CHILD_ENV_ALLOWLIST (real-claude-adapter.ts:105), which is a
  WEAKENING of the secret-free-child-env invariant. Do NOT do this as
  an implementation detail. It requires an explicit owner decision and
  its own review (scope the var to codex only, confirm it never reaches
  the Claude path, re-run the adversarial review). Default recommend:
  prefer a Codex CLI auth mode that persists a home-dir credential.

## Codex activation steps (owner-run, AFTER P2 PASS)

CX-1  Confirm the Codex CLI auth model (resolve the decision point).
      Install the Codex CLI for the service user, reachable at an
      absolute path whose basename is exactly 'codex':
        su - preston-worker
        # install per the Codex CLI's documented method into
        # /var/lib/preston/worker/.local/bin/codex (or similar)
        which codex   # must be absolute; basename 'codex'
      Then interactive login AS preston-worker (fresh prod credential;
      NEVER a staging or shared credential). If login needs an env-var
      key, STOP and return to the decision point above.

CX-2  Host env (append to /etc/preston/worker.env, root:root 0600):
        ORCH_REAL_CODEX_ENABLED=true
        ORCH_CODEX_EXECUTABLE=/var/lib/preston/worker/.local/bin/codex
      (ORCH_EXECUTION_LEVEL / DISABLE_REMOTE_RUNNER / SUPABASE_RUNTIME_ENV
      / ORCH_ALLOWED_PATHS / worktrees / base-commit are already set by
      the P2 Claude activation - Codex reuses them unchanged.)

CX-3  actor_registry: enable codex-1 ONLY IF Codex must submit intake
      over the SSOT bearer path. For a doc-only job the owner/chatgpt-1
      submits and merely ASSIGNS to codex, codex-1 can stay disabled
      (execution identity is the host executable, not the actor row).
      If enabling: mint a FRESH prod token, hash-only in DB, 64-char
      check, 1Password PROD-codex-1. (p1_actor_provision.ps1
      -OnlyActor codex-1 exists for this.)

CX-4  Bounded Codex drill (mirror D-P2-3): submit ONE doc-only Level-1
      goal whose text explicitly assigns codex (e.g. "... using codex")
      so composer-persist routes assigned_role='codex'. Expect:
      real:*:completed:executed:true + real-audit:paths_ok:clean,
      worktree created AND removed, zero sim:* fallback, and the audit
      evidence names codex. Then a second independent bounded run.

CX-5  Rollback / revocation (any of):
        - worker.env: remove ORCH_REAL_CODEX_ENABLED (codex declines to
          simulation; Claude unaffected)
        - update actor_registry set enabled=false where actor_id='codex-1'
        - global owner_stop=true halts both providers
      Prove one revocation (flip ORCH_REAL_CODEX_ENABLED off, confirm a
      codex job declines) to close the gate.

## Invariants that must NOT be weakened (from the review)

Claude provider pin intact; codex fixed basename allowlist; secret-free
CHILD_ENV_ALLOWLIST unchanged; shell:false argv-only; post-run path
enforcement; 0010 executed/simulation pins; capability ceiling
(execution_enabled + remote_runner_enabled + not owner_stop/paused);
per-actor identity, fresh prod token, no staging reuse.

## Then: Claude+Codex team mode (separate, after both prove individually)

Preston task -> Claude plans -> Codex implements/reviews in its OWN
bounded worktree with codex attribution -> Claude reviews -> tests ->
Preston audit -> SSOT. No shared identity; each agent's worktree lock is
job+role scoped; approval + owner_stop + audit chain unchanged. One
contained team-mode proof; packet to follow after CX-4 PASS.
