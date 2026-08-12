# PRESTON PRODUCTION ACTIVATION STATUS (single resumable record)

Updated: 2026-08-12. This file is THE resume point for any future
session: verify facts against git/DB/HTTP before relying on them, but
do not reconstruct history from chat.

## Gates closed (evidence committed)

- P0 foundation: PASS - reports/PRESTON_P0_GATE_REPORT.md.
  Prod Supabase hiqsymsiwonmvrbbqhhe (us-east-1), chain 0001-0015
  (0007 deferred, 0008 mirrored-absent), parity byte-identical,
  RLS full, anon zero, owners bootstrapped, day-one backup
  SHA F205989A...C87D, Vercel preston-os-prod.vercel.app fail-closed
  (Next.js preset fix incident recorded).
- P1 SSOT/intake surface + identity: PASS -
  reports/PRESTON_P1_GATE_REPORT.md. Env allowlist code gate;
  flags live; five actor rows (owner-remote-1/chatgpt-1/claude-1
  enabled; codex-1/hermes-1 disabled); global intake token; 401x4
  negative proofs; claude-1 drill accepted+stamped (p1-drill-20260812-01).
- ChatGPT attribution: PASS - reports/PRESTON_CHATGPT_PROD_PROOF.md
  (chatgpt-1 stamped row p1-chatgpt-drill-20260812-01).
- P2 code gate: PASS - env generalization 89f49a6 + review fixes
  9aad634 (adversarial review: no critical/high; 3 findings fixed).
  origin/master pushed at 9aad634.
- P2 DB gate: PASS - 0017 applied+seeded BOTH envs
  (staging=self|staging, prod=self|production, 3 CHECKs verified).
- P2 host runbook: committed 776b65c
  (reports/PRESTON_P2_PROD_HOST_RUNBOOK_v1.md).

## Current critical path (P2 remainder - OWNER)

preston-agent-prod does NOT exist yet. Hetzner console is unreachable
from the agent session (extension site-permission + accounts.hetzner.com
bot-check; three attempts, hard boundary). Owner runs runbook H-1..H-9:
create host, harden, clone at pin 9aad6340440f46227a5c49ff818f66ffb3d37654,
prod worker.env, token-store bootstrap (fresh prod credential),
Claude /login as preston-worker (fresh), units (nothing enabled),
preflight, then drills D-P2-1 (consume 2 parked rows) ->
D-P2-2 (approve/resume + owner_stop exit-75) -> D-P2-3 (bounded
doc-only real execution x2). Evidence criteria in the runbook.

## Prepared/in-flight (agent-side, parallel)

- Codex gate analysis (enablement delta), Hermes H1/H2 delta, n8n-1
  delta: investigation running; packets to follow in reports/.
- 0016 (n8n actor role) DRAFTED, not applied - n8n gate only.
- Remaining sequence after P2: Codex individual proof -> Claude+Codex
  team mode -> Hermes H1 then H2 -> n8n first bounded workflow ->
  remote owner operations proof -> final multi-agent drill ->
  PRESTON_AI_OS_FULL_MULTI_AGENT_LIVE_REPORT.md.

## Standing deviations / owed items (non-blocking)

- Vercel env vars Preview-scope fix claimed done at P1 session
  (verify at next Vercel visit); off-host backup copies (staging+prod)
  owed; P0 apply .log uncommitted (gitignore+classifier).
- api/os/chatgpt legacy route stays staging-pinned (own gate).
- envelope.ts stays staging-pinned (0008 absent everywhere).
- Business layer (0009 pins) untouched - P3 RED gates.

## Hard rules that bit this session (do not relearn)

- Evidence discipline: two relayed claims disproven (fake apply, fake
  prod ref). Advance ONLY on files/DB/HTTP/git ground truth.
- Vercel env vars bind at BUILD: setting vars without redeploy does
  nothing (hit twice: flags 503->401 only after redeploy).
- RED scanner sweeps untracked .ps1 in the tree (network-calling
  helper scripts cannot exist anywhere in the repo).
- H-3 guard trips on SQL verbs in COMMIT MESSAGES; reword.
- Supabase SQL editor freezes this Chrome; hosted pg-meta endpoint
  disabled; DB work goes through owner-run psql scripts with evidence
  files under reports/*_evidence/.
