# PHASE 7 - MIGRATION 0010 GATE EVIDENCE

Date: 2026-07-27 (owner session; decision timestamps 2026-07-28 UTC).
Gate: staging backup + migration 0010 apply + structural verification
(go-live 4.6) + behavioral verification (go-live 4.7, corrected
method - see the 2026-07-28 addendum, go-live packet section 13).
Environment: Supabase project preston-os-staging ONLY.
Gate result: PASS.

All SQL was owner-run in the Supabase STAGING SQL editor. Claude ran
no credentialed command and saw no secret. The RPC/policy drills ran
under the owner-ratified transaction-local owner-claims simulation
(go-live section 13); nothing was weakened, bypassed, or modified.

## 1. Backup (go-live 4.3): PASS WITH NOTE

- Root cause of the 2026-07-23 failures (five 0-byte dumps, retained
  in C:\dev\backups as failure evidence): the direct database host
  db.<projectref>.supabase.co publishes NO IPv4 A record (IPv6-only
  AAAA), and the owner machine has no global IPv6 route, so pg_dump
  created the -f output file and then failed to connect.
- Corrected route (owner-run 2026-07-27): SESSION-mode pooler,
  port 5432, database postgres, user postgres.<projectref>, host
  copied from the dashboard Connect dialog. Password typed only into
  pg_dump's own interactive prompt (per the Codex-hardened backup
  packet addendum). Transaction pooler 6543 not used.
- File: C:\dev\backups\preston-os-staging-2026-07-27-1936.dump
- Size: 573,705 bytes
- SHA256:
  169277328C65576E794271144B88EA4CFC01AABDB937EC53C3B93327D8EF97BF
- pg_dump exit code: 0
- pg_restore --list exit code: 0
- TOC entries: 862
- NOTE: size is under the backup packet's ">1 MB" heuristic.
  Accepted: -Fc output is zlib-compressed and staging tables are
  sparse; 862 TOC entries with both exit codes 0 is a structurally
  complete dump. This also satisfies LA-10 step 1 (first backup) and
  transfer-plan Gate 1. Owner still owes: off-host copy + backup
  register row (this section is the size/hash source of record).

## 2. Migration identity (go-live 4.4): VERIFIED

- File: supabase/migrations/0010_phase7_orchestration.sql
- Git blob: e513bb14269778999b1c65915e9c717305e9996d
- SHA256:
  5099AF8120CE3099304B1D8C113FF6FE799BD80ECC17A5AAE335C961C5CD9970
- Source: clean feature worktree at branch tip c773eac (content
  identical at every docs-only tip since 686f613). Pasted verbatim
  as one script; the file was not modified by this gate.

## 3. Pre-migration checks (go-live 4.2): PASS

- is_owner() present (0002 sentinel): 1 row.
- Predecessor sentinels all present: approvals, business_clients,
  os_jobs, repository_worktrees, system_controls, telegram_updates.
- job_attempts.id data type = text (0005 sentinel).
- Phase-7 slate: 0 rows (clean first run, matching the owner's
  2026-07-23 five-table check).

## 4. Apply (go-live 4.5): PASS

Single clean run in a fresh SQL editor query:
"Success. No rows returned". No errors, no partial state.

## 5. Structural verification (go-live 4.6 a-h, plus i): PASS

| Check | Expected | Result |
|---|---|---|
| a five tables | 5 | 5 |
| b goal_jobs run_id + run_lease_expires_at | 2 | 2 |
| c repository_worktrees fence/allowed_paths/lease_expires_at | 3 | 3 |
| d submit_goal_decomposition + decide_orchestration_approval | 2 | 2 |
| e approval INSERT policy WITH CHECK chain | is_owner AND pending AND nonce null AND decided_at null | all present |
| f direct UPDATE grant on orchestration_approvals | 0 rows | 0 rows |
| g anon grants on the five tables | 0 | 0 |
| h RLS enabled | 5 true | 5 true |
| i partial unique index uq_orchestration_approvals_nonce | 1 | 1 |

Check i is carried forward from the superseded FINAL packet's 6h
(the partial-index requirement holds in both packets).

## 6. Behavioral verification (go-live 4.7, corrected method): PASS

Method: each check in its own explicit transaction; transaction-local
set_config('request.jwt.claims', ...) built from the owner's real
auth.users id (sub), then SET LOCAL role authenticated, then the
drill statement. RLS and is_owner() evaluated genuinely; context
reverted at commit/rollback. Owner-ratified 2026-07-27, staging only.

B1 idempotency (submit_goal_decomposition):
- B1a first submission: created:true, jobs:1. Evidence rows:
  master_goals drill-b1 (status decomposed, simulation_only=true),
  goal_jobs 00000000-0000-4000-8000-0000000001b1 (kind audit,
  risk_class GREEN, executed=false).
- B1b identical retry: created:false; counts unchanged (1 goal,
  1 job).
- B1c cross-match (same correlation drill-b1, different goal id):
  ERROR P0001 idempotency_conflict; no rows created
  (goals=1, b2_rows=0, jobs=1).

B2 approval lifecycle (orchestration_approvals +
decide_orchestration_approval):
- B2a pending fixture drill-b2-1 accepted through the constrained
  policy; evidence: status pending, nonce NULL, decided_at NULL,
  unexpired true, all fixture fields exact, no duplicates.
- B2b decide via RPC: status approved, nonce drill-nonce-b2-1,
  decided_at 2026-07-28 00:17:41.271313+00, decided_at >= created_at.
- B2c replay (second decision, different nonce): ERROR P0001
  not_pending; first decision untouched. Reconciliation: the packet
  expectation not_pending is CORRECT; the function carries BOTH
  guards in sequence - status<>pending -> not_pending (first), then
  nonce already set -> already_decided (defense-in-depth). The
  replay hit the first guard as designed.
- B2d expiry: fixture drill-b2-2 with a 5-second window; decision
  attempted after >10s: ERROR P0001 expired (clock_timestamp() taken
  after the row lock governs). Evidence: row still pending, nonce
  NULL, decided_at NULL, expires_at elapsed.

B3 forge protection:
- Direct INSERT of a pre-approved row (status approved) as the
  authenticated owner: ERROR 42501 row-level security violation.
  forged_rows=0. This check is only meaningful under the corrected
  method - as role postgres it would have bypassed RLS and falsely
  "succeeded" (see the section 13 addendum).

Final fixture census: drill-b2-1 approved (nonce set), drill-b2-2
pending + expired (permanently undecidable), goal/job drill-b1
simulation-pinned. All residue is inert BY DESIGN (DELETE revoked);
rows are unmistakably drill-prefixed and stay as evidence.

## 7. Findings recorded at this gate

1. Go-live 4.7 execution-context defect + corrected method: see the
   dated addendum, go-live packet section 13.
2. B2c error-tag wording reconciled (this file, section 6).
3. Superseded FINAL-packet items confirmed at execution time (177-line
   count; section-6g update-grant expectation): see section 13.
4. Backup size heuristic deviation accepted with rationale
   (section 1).

## 8. Gate report (per CLAUDE.md format)

- Gate result: PASS
- Commit hash or hashes: none created by this gate (DB-only); applied
  content pinned to blob e513bb1 at branch tip c773eac. This evidence
  file + the packet addendum are the gate's only repo changes.
- Files changed: reports/PHASE_7_MIGRATION_0010_GATE_EVIDENCE.md
  (new), reports/PHASE_7_BRIDGE_GOLIVE_PACKET.md (section 13
  addendum).
- Commands run: owner - pg_dump/pg_restore (session pooler), SQL
  editor blocks 4.2/4.5/4.6/4.7. Claude - read-only repo/hash/DNS
  verification only.
- Tests run: structural 4.6 a-i (9 checks), behavioral B1a-c,
  B2a-d, B3 (8 checks). All pass.
- Environment: Supabase preston-os-staging; owner machine ZPC26.
- Production touched: false
- Secrets exposed: false
- Live messages sent: false
- Live emails sent: false
- Next gate: go-live 3.5/3.6 (owner ff-merge + master push at the
  NEW branch tip -> Vercel deploy), then section 5 host deployment,
  Gate 6B, section 7 drill.
- Owner action required: review + commit this docs change; then run
  3.5/3.6 with TIP = the new branch tip (feeds ORCH_BASE_COMMIT).

Durable-worker gates G-D2/G-D3 are UNBLOCKED by this gate's PASS.
