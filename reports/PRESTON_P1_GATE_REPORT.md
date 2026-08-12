# P1 - PRODUCTION SSOT + INTAKE/APPROVALS GATE REPORT

Date: 2026-08-12. Gate: P1 per PRESTON_PRODUCTION_ACTIVATION_MATRIX_v1
(items C/D/E partial-F), execution disabled throughout.

## Gate result: PASS (surface + identity layer; see Scope note)

## What went live

- Env allowlist code gate (reviewed): /api/os/remote/goal,
  /api/os/remote/status, /api/os/ssot/status moved from staging-only
  pin to explicit allowlist ('staging'|'production'); all other values
  fail closed 'unconfigured'. Commit ceec304 (+9df7e8f, d5dc152);
  owner-pushed; Vercel prod rebuilt.
- Production flags: REMOTE_INTAKE_ENABLED=true, SSOT_STATUS_ENABLED=
  true, REMOTE_INTAKE_TOKEN set (Production scope). Redeploy required
  for flags to bind (first probe round showed 503:disabled - fixed by
  owner redeploy; recorded as the env-propagation pitfall recurrence).
- Actor identities (fresh prod tokens, hashes only in DB):
  owner-remote-1/chatgpt-1/claude-1 ENABLED; codex-1/hermes-1 rows
  present DISABLED. remote_intake_config 'global' enabled with fresh
  legacy token hash. All hash_len=64.

## Live drill evidence (owner-run 2026-08-12, direct HTTP + psql)

- Negative auth: ssot no-token 401, ssot bad-token 401, goal no-token
  401, goal bad-token 401 (agent-probed post-redeploy).
- Authenticated drill (claude-1): submit ok=True status=accepted
  actor_id=claude-1; ssot read ok=True.
- DB ground truth: remote_intake_requests row p1-drill-20260812-01
  source=api actor_id=claude-1 status=pending; 5 actor rows (3
  enabled); system_controls 0 rows (fail-closed defaults = execution
  OFF); pending count 1.

## Defects found and fixed during P1

1. Provisioning generator emitted literal {0}..{4} (PowerShell -f
   precedence) -> psql aborted at FIRST statement, zero rows written;
   fixed with direct interpolation + -GenerateOnly dry-run self-check
   (9df7e8f).
2. First flag rollout not live (Vercel env binds at build) -> owner
   redeploy; probes flipped 503:disabled -> 401:forbidden.
3. claude-1 401 on first authenticated drill: saved token was from the
   failed run #1 (which stored nothing). Isolated with a no-exposure
   hash-prefix comparison (p1_diagnose.local.ps1); recovered with
   single-actor re-key (-OnlyActor claude-1, d5dc152). Verified MATCH
   (stored prefix caa1e6e8) before the passing drill.

## Scope note (honest boundary)

Prod has NO host runtime yet (P2 gate). This P1 proves the remote
surface + identity layer: authenticated intake accepted, actor_id
stamped by the SECURITY DEFINER gateway, SSOT read surface live,
row persisted and parked, execution disabled (no controls row, no
consumer). Intake CONSUMPTION, approval park/approve/resume, and the
prod owner_stop halt drill attach to P2 when the prod-serving host
exists. Approvals machinery itself is unchanged staging-proven code.

## Tooling boundary recorded

Network-calling drill helpers cannot live anywhere in the repo tree
(pre-commit RED scanner enumerates untracked .ps1 too). Drills are
delivered as inline owner-run commands; p1_diagnose.local.ps1 (psql-
only, scanner-clean) stays untracked local tooling.

## Ledger

- Commits: ceec304 (allowlist+tests), 9df7e8f (generator fix),
  d5dc152 (single-actor recovery), this report. origin/master
  owner-pushed through d5dc152's line.
- Tests: route suites 18/18; full suite 1240 pass + 1 xfail + 5 known
  Windows env-class (matches audited baseline).
- Staging impact: staging Vercel advanced to the allowlist code
  (behavioral superset, staging still allowed); golden host runtime
  untouched (commit-pinned). Staging DB untouched.
- Production touched: TRUE (flags, actor rows, one parked intake row).
- Secrets exposed: false (tokens 1Password-only; hashes/prefixes only
  in DB/evidence). Live messages sent: false. Live emails sent: false.
- Next gate: ChatGPT attribution proof (chatgpt-1 drill), then P2
  (prod host decision + bounded execution).
- Owner action required: run the chatgpt-1 drill; deviations owed:
  off-host backup copies.
