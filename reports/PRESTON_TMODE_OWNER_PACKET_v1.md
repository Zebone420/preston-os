# CLAUDE + CODEX T-MODE OWNER PACKET v1 (PLAN)

Date: 2026-08-17. Status: PLAN. Gate 3 of
reports/PRESTON_FINAL_ACTIVATION_SEQUENCE_v1.md. Prereq: P2 PASS and
Codex individual proof PASS. Nothing here activates anything.
T-mode = one production goal where Claude plans/reviews and Codex
implements, each provider executing ONLY its own jobs in its own
fenced worktree, approvals/leases/audit unchanged.

## 1. Adversarial machinery review (2026-08-17) - register

A full two-provider adversarial review of the composed machinery ran
before this packet. Verdict: the persistence layer (CAS transitions,
run leases, one-time approvals, nonce guard, env pinning) is
two-provider-safe; three defects had to be fixed first, and the
remaining findings become gate conditions below.

FIXED IN CODE (commit: see git log, "T-mode review fixes"):

- F3 (HIGH): review kinds (audit/recommendation) ran lock-free with
  fence 0, so real adapters ALWAYS refused them and they silently
  sim-completed - a fake review gating a real implementation. Fix:
  when a real executor is composed, EVERY kind takes the fenced
  worktree lock. Simulation posture unchanged. Tests pin both.
- F2 (HIGH): a per-job decline (provider gate absent, provision
  failure, adapter refusal) fell back to simulation and the job
  reported completed - a broken Codex "succeeded" without doing the
  work. Fix: strict mode env ORCH_REQUIRE_REAL_EXECUTION=true turns
  provider-broken declines into honest FAILED attempts. Owner
  capability downgrade still declines to simulation in both modes
  (ruled posture change, not a provider failure). Default absent =
  prior behavior (staging drills unaffected). REQUIRED for T-mode:
  the flag MUST be set in worker.env from CX-2 onward.
- F6 (MEDIUM): no provider identity existed in the run-scoped
  durable record. Fix: every real result now appends
  real-provider:job:<id>:run:<run>:role:<claude|codex> to
  evidence_refs and the real_executor_result log line carries role.

GATE CONDITIONS (design rulings this packet imposes; no code change):

- F1 (HIGH, concurrency): the 10-min run lease is shorter than a
  lawful 15-20-min real run. SAFE only because ALL dispatch ticks
  serialize on one flock on one host. T-MODE RULE: exactly ONE
  orchestrator unit on ONE host. No per-provider units, no second
  host, no flock removal. Lease renewal/sizing is a prerequisite
  gate for any future real concurrency.
- F4 (MEDIUM): the engine default-assigns unassigned jobs to
  claude. T-MODE RULE: the goal text must yield an explicit role
  for every job (the "... using codex" routing); the evidence check
  below verifies no job was default-assigned.
- F5 (MEDIUM): goal cancellation is observed between steps, not
  between jobs inside a step - after cancel, an already-listed
  other-provider job may still run once. RULING RECORDED: accepted
  for T-mode (bounded by one step); owner_stop is the immediate
  kill and is checked before AND after every job.
- F7 (MEDIUM): after an approval clears, adapters do not re-verify
  the envelope hash at execution time (defense-in-depth gap; no
  in-machinery writer can exploit it). Registered as a hardening
  item for the gate AFTER T-mode; not a T-mode blocker.
- F8/F9 (LOW): lock-row branch name cosmetic mismatch (wt/ vs
  job/); in-flight noop cycles burn shared iteration budget.
  Registered; not blockers.

## 2. Owner steps (after Codex CX-5 closes)

T-1  Host env (worker.env): confirm ORCH_REQUIRE_REAL_EXECUTION=true
     (added at CX-2 repin; if absent, add + note in evidence).
     Confirm exactly one orchestrator timer unit enabled (F1 rule):
       systemctl list-timers | grep preston
T-2  Submit ONE team goal (owner intake/dashboard), neutral text
     shaped to decompose into: plan (claude) -> implement
     "using codex" -> review (claude, audit kind). Risk <= YELLOW,
     doc-only paths.
T-3  Approve at any parked approval points (phone or dashboard).
T-4  Let it run to completion (multiple ticks fine).
T-5  Evidence: .\scripts\p2\p2_drill_verify.ps1 -Label tmode-01 (+
     journald excerpts for each real_executor_result line).

## 3. PASS criteria (ALL)

1. One goal completed, environment='production', >= 3 jobs.
2. At least one job assigned_role=claude and one ='codex', each
   with real:*:completed:executed:true, real-audit paths_ok, AND
   the matching real-provider:...:role:<own role> ref (F6).
3. The review (audit-kind) job REALLY executed (executed:true, not
   sim:*) - proves the F3 fix live.
4. Zero sim:* refs on any executed job; zero real_required:*
   failures (or, if one occurred, it is explained and the retry
   succeeded honestly - F2 semantics).
5. No job was engine-default-assigned: every job's role came from
   decomposition (F4 check: journal/decisions show no 'assign'
   action flipping a null role, or all roles present at insert).
6. Each provider's jobs ran in its OWN wt-<jobId> worktree, created
   and removed; no cross-job path overlap in the audits.
7. Approval binding: any gated job cleared only via authoritative
   verification; replay refused (inherited machinery, spot-check).
8. Safety invariants sweep (P2 template section 3) PASS after.

## 4. Revocation / rollback

- ORCH_REAL_CODEX_ENABLED off -> codex jobs fail honestly under
  strict mode (they do NOT silently sim-complete - changed
  semantics, F2). Claude unaffected.
- owner_stop=true halts everything mid-goal; requeue is run-owned.
- Full ladder inherited (timer/env/repin/actor/Vercel).

## 5. After PASS

Proceed per the sequence doc (Hermes H1). File the gate report in
CLAUDE.md format with the tmode-01 evidence files committed.
