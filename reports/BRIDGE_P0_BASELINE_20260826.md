# Bridge P0 baseline verification (2026-08-26)

Scope: pre-implementation baseline checks ordered by the owner's
FULL-SPEED EXECUTION master goal, run before B1-B4.

## P0.1 - dead-letter telemetry discrepancy: EXPLAINED + DISAMBIGUATED

Observed: preston_status `summary.dead_lettered_jobs = 2` while a Hermes
reason carried `dead_lettered:5`.

Root cause (code-proven, not a counting defect):
1. Both numbers come from the SAME computation (`loadBridgeReadiness` ->
   `loadOrchestrationReadModel` over the bounded recent-goals window).
2. The Hermes number is a SNAPSHOT frozen in the newest `od-orchstatus-<minute
   bucket>` orchestration_decisions row - prod's newest such row predated the
   Hermes liveness outage (bucket 202608202133, Aug 20), when five
   dead-lettered jobs sat inside the then-current window.
3. The summary number is computed LIVE per read; window drift (20 most recent
   goals) plus post-fix history moves it independently.
Classification per the master goal's taxonomy: stale Hermes state +
observation-window semantics. Nothing hidden, nothing wrong with either query.

Fix (commit 6c3774d): the two metrics are now named distinctly -
`hermes.snapshot_counts {as_of_bucket, ...}` + `snapshot_note` vs live
`summary.*` - with strict parsing (absent/malformed -> null, never a
fabricated 0). Regression pins added (preston-control-tools.test.ts).

Additional latent gap found and fixed in the same commit: the hermes-loop log
line dropped the status-observation insert outcome, so a silently-failing
`od-orchstatus` append (RLS/CHECK) was invisible - the bucket would freeze
while every tick logged clean. `orchestration_recorded` now appears in the
log line. NOTE: the prior SSOT report's claim that the bucket "advances only
on an observable event" does not match the code (the append is unconditional
per minute bucket once mode/halt gates pass); after the next host rebuild the
new log field will show directly whether prod appends succeed. If
`orchestration_recorded:false` appears, that is a real defect to chase - it
can no longer hide.

## P0.2 - bounded-execution closure: SUBSTANTIALLY CLOSED, one residual

Chain audited: request -> classification -> eligible kind -> correct provider
-> bounded real execution -> evidence -> completed.

Evidence on file:
- Routing layers (classification -> kind -> role): proven LIVE on staging at
  c870b40 (drill report BOUNDED_EXEC_ROUTING_FIX_STAGING_DRILL_20260826.md):
  audit -> audit/claude, plan -> recommendation/claude, code unchanged, zero
  dead letters, five negative drills held every gate.
- Real bounded execution -> evidence -> completed: proven IN PRODUCTION
  pre-fix for code/documentation kinds (PROD SSOT audit 4365065: prod goals
  COMPLETED by the claude runtime with `real:...executed:true` +
  `real-provider:...role:claude` evidence refs).
- Prod promotion of the fix (994b7fd) verified fail-closed posture; the two
  historical dead-lettered jobs from goal 6b5d32c5 remain historical (no
  retro-processing, by design).

RESIDUAL (not yet evidenced end-to-end anywhere): an audit-kind and a
recommendation-kind job reaching real `completed` with evidence. The fix
only changed intake routing, and both kinds were already in
REAL_CLAUDE_ELIGIBLE_KINDS, so the inference is strong but the direct
observation is missing. DISPOSITION: folded into the B5 staging drill (G11
includes one audit-kind completion) - no new production action required, no
unnecessary work created.

## Verdict

P0 PASS. Baseline coherent; one telemetry disambiguation shipped (6c3774d);
one residual explicitly carried into B5. Production untouched.
