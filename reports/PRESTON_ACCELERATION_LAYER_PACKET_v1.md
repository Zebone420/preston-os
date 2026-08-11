# PRESTON ACCELERATION LAYER PACKET v1 (PLAN ONLY - NOTHING INSTALLED)

Purpose: speed up future build/ops work WITHOUT creating competing
truth or bypassing approval gates. Nothing here is activated by this
document.

## Authority model (fixed)

- Preston OS = control plane (goals/jobs/approvals/capability gates)
- SSOT = canonical truth (goal-graph spine + repo docs per design v1
  section 9; every tool below is a CONSUMER, never an authority)
- Preston safety guard + owner gates = final authority, always
- Claude = lead architect / reviewer / principal implementer
- Codex = heavy implementation under repo-mediated delegation
- Hermes = remote operational interface (observe first)
- gstack/Ponytail/subagents = discipline + parallelization only

## Components

1. Ponytail (INSTALLED already, plugin 4.8.4, audited lineage)
   Adds: minimalism pressure on every code change; audit/review/debt
   skills. Belongs: local dev sessions. Overlap: none with runtime.
   Rule: advisory only; never used as an orchestrator (its own
   mismatch rule); ponytail: comments harvested via ponytail-debt.

2. Bounded subagents (Claude Task/Agent tool - already in use)
   Adds: parallel read-only investigation, adversarial audits (the
   pattern that caught the token-rotation and store-deadlock bugs).
   Belongs: dev sessions. Rule: read-only or worktree-isolated;
   conflicting-write fan-out forbidden; results verified by the main
   session before commit.

3. Codex delegation (proven pattern: P7-CX-01)
   Adds: heavy implementation + adversarial security regressions.
   Belongs: repo-mediated packages (pinned base commit, single-file
   or bounded-path scope, zero overlap with Claude's concurrent
   edits). Rule: delegation register documents pin+scope; Codex
   output lands as reviewed commits, never direct pushes. Runtime
   codex execution stays OFF (matrix item J).

4. gstack (workflow discipline - NOT installed)
   Adds: stacked-change hygiene for larger series. Overlap risk:
   the repo's bounded-gate protocol already enforces small reviewed
   steps; gstack is optional sugar. Recommendation: DEFER unless
   change-series pain appears; if adopted, it must not introduce
   force-push workflows (H-6/RED conflict).

5. SSOT-aware orchestration policy (documentation, cheap win)
   Adds: every agent session begins by reading
   /api/os/ssot/status (its actor token) + GOLDEN baseline doc,
   instead of rehydrating chat history. Belongs: docs/ prompt
   templates. This operationalizes design v1 section 8.

## Anti-proliferation rules

- One canonical truth per fact class (design v1 section 9); tools
  cache, never own.
- No tool gets write access to approvals, controls, credentials, or
  firewall/infra - those stay owner+guard territory.
- Every new agent/tool enters via its own bounded gate with an
  audited lineage check (the Ponytail precedent).
- ChatGPT-relay rule stands: operational evidence only from direct
  API/DB/log ground truth.
- Agent identity: each automation actor gets its OWN actor_registry
  row + token (revocable per-actor); no shared tokens.

## Recommended adoption order

1. SSOT-aware session bootstrap (docs only, zero risk) - immediate.
2. Continue subagent audits + Codex packages as-is (proven).
3. Ponytail stays advisory in dev loops.
4. gstack: revisit only when a real stacked-series need appears.
