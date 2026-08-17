# PRESTON PRODUCTION ACTIVATION STATUS (single resumable record)

Updated: 2026-08-17 (laptop session). This file is THE resume point
for any future session: verify facts against git/DB/HTTP before
relying on them, but do not reconstruct history from chat.

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

UPDATE 2026-08-17: preston-agent-prod EXISTS (created 2026-08-12,
owner-authorized; Hetzner project Preston Automation; CPX22 - the
runbook's "CPX21" was a naming slip, no such SKU; Ubuntu 24.04;
key-auth only; IP recorded privately per owner rule, not in repo).
Runbook H-1 is therefore DONE; H-2..H-9 remain and are NOT verified
from any shared state as of this update. Owner runs runbook H-2..H-9:
harden, clone at pin 9aad6340440f46227a5c49ff818f66ffb3d37654,
prod worker.env, token-store bootstrap (fresh prod credential),
Claude /login as preston-worker (fresh), units (nothing enabled),
preflight, then drills D-P2-1 (consume 2 parked rows) ->
D-P2-2 (approve/resume + owner_stop exit-75) -> D-P2-3 (bounded
doc-only real execution x2). Evidence criteria in the runbook.

## Prepared/in-flight (agent-side, parallel)

- Codex enablement delta: DONE -
  reports/PRESTON_CODEX_ACTIVATION_OWNER_PACKET_v1.md (fcf3e4d).
- Hermes H1/H2 delta: DONE -
  reports/PRESTON_HERMES_PROD_DELTA_PACKET_v1.md (this session).
- n8n-1 delta: DONE -
  reports/PRESTON_N8N_FIRST_WORKFLOW_PACKET_v1.md (intake-only
  bounded workflow 1; 0016 draft is its migration).
- P2 gate-close package: DONE -
  reports/PRESTON_P2_GATE_REPORT_TEMPLATE.md (mechanical fill;
  PASS requires evidence refs in every cell).
- Full post-P2 sequence: DONE -
  reports/PRESTON_FINAL_ACTIVATION_SEQUENCE_v1.md (gates 1-10 with
  prereqs/owner/agent/proof/rollback/weight per gate).
- Owed by laptop next: T-mode packet (after adversarial machinery
  review closes), remote-owner-ops packet (gate 7), final
  multi-agent drill script (gate 8).
- 0016 (n8n actor role) DRAFTED, not applied - n8n gate only.
- Remaining sequence after P2: Codex individual proof -> Claude+Codex
  team mode -> Hermes H1 then H2 -> n8n first bounded workflow ->
  remote owner operations proof -> final multi-agent drill ->
  PRESTON_AI_OS_FULL_MULTI_AGENT_LIVE_REPORT.md.

## Session sync log (append-only, newest first)

- 2026-08-17 laptop (3rd cycle): downstream fast path built. Two
  subagent reviews closed: (a) Codex packet audit - all 7 technical
  claims CONFIRMED, 8 fixes applied incl. the CHILD_ENV_ALLOWLIST
  scoping caveat and the CX-2 REPIN prerequisite (P2 pin 9aad634
  predates the codex adapter d55e3ed - repin required before CX);
  (b) T-mode adversarial machinery review - persistence layer
  two-provider-safe; F2/F3/F6 FIXED in code 95c3d68 (strict real
  mode ORCH_REQUIRE_REAL_EXECUTION, fenced lock for all kinds under
  a real executor, real-provider:* attribution refs) with 9 new
  tests; F1 (single-dispatcher rule), F4, F5, F7-F9 recorded as
  gate conditions in the T-mode packet. New artifacts: T-mode
  packet, remote-owner-ops packet (gate 7), final multi-agent drill
  packet (gate 8), final activation sequence (gates 1-10), P2
  gate-close template, n8n workflow-1 packet. Full matrix green at
  95c3d68 (1298 pass + 1 xfail + 5 known env-class; tsc x2 0).

- 2026-08-17 laptop (2nd cycle): the six laptop commits are NOW
  PUSHED (origin/master==df63db2; the earlier "owner pushed" relay
  was disproven by fetch - evidence-discipline hit #3, the push had
  not landed). Office session owns the P2 lane (H-2..H-9 + drills)
  from df63db2. Laptop authored: P2 gate report template, n8n
  workflow-1 packet, final activation sequence (gates 1-10).
  Codex packet audit + T-mode adversarial review running as
  subagents; results and any fixes commit separately.

- 2026-08-17 laptop: full matrix RE-VERIFIED at fcf3e4d - vitest
  1289 pass + 1 xfail + 5 known env-class worktree-prep (Windows
  bash spawn; compensated by direct Git Bash checks), tsc x2 clean,
  os-runtime build clean, next build clean, secret/RED scans 0/0.
  COORDINATION: commits 776b65c..fcf3e4d (P2 runbook, this record,
  Codex adapter+packet) exist ONLY on the laptop clone; origin/master
  is still 9aad634. Any other session/host cannot see them until the
  owner pushes - pushing these 4+ commits is the top sync action.
  Untracked scripts/p1/p1_diagnose.local.ps1 (owner-run local 401
  diagnostic, psql-only, no token exposure) passes both scanners.

## Standing deviations / owed items (non-blocking)

- 0017 apply/seed verification output is not committed as evidence
  files (no reports/p2_evidence/ yet, unlike p0/p1); recapture the
  3-CHECK verification into reports/p2_evidence/ at the next owner
  psql visit.
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
