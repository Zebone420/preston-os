# GATE B MISMATCH DIAGNOSIS - "Gated tasks await owner approval"

Date: 2026-08-04. Status: ROOT CAUSE PROVEN FROM PINNED SOURCE -
classification: INCORRECT GENERIC SUCCESS-CARD WORDING (defect class:
UI copy). Bounded fix committed 06ce6a4. Goal preserved as evidence.

## Observed (owner, deployed build at c24a7e5)

Composer created goal 106adcdf-7cd8-4929-a567-0de7f5f81036 with jobs:
- 1e610b4e-bdcb-4888-b7ad-5b5b6f30c6ed  Inspect the staging status data
- 424df50a-a39b-498c-8142-d816fd9803ee  Generate a simulation-only
  readiness summary
- 1b9640a2-3724-4c9f-a0d1-7abd9a8c6108  Attach internal evidence
Success card: "Goal graph created (simulation-only). Gated tasks
await owner approval." No approval ids were reported on the card.

## Root cause (source-level, at the exact deployed commit)

Both Vercel and the host are byte-pinned to c24a7e5, so the deployed
code is readable locally with certainty. At
apps/dashboard/src/app/os/composer/actions.ts line 132 (pre-fix), the
non-replay success notice is UNCONDITIONAL:

    notice: outcome.replayed
      ? 'Duplicate confirmation detected - ...'
      : 'Goal graph created (simulation-only). Gated tasks await
         owner approval.',

It renders for EVERY successful create, gated or not. The REAL gating
signals are elsewhere and independent:
- composer-persist.ts:221-253: approval rows are created ONLY for
  jobs with requires_approval=true; created[].approval_ids collects
  exactly those.
- composer-form.tsx:235,239-241: the success card appends
  " - awaiting owner approval" per gated job and renders an
  "Approvals: apr-..." line ONLY when approval_ids.length > 0.
The owner-observed card showed NO approval ids and (per report) no
per-job awaiting suffix -> approval_ids was empty -> zero approval
rows were created. The sentence is stock copy, not a classification.

## Rule-out of the other hypotheses

- Approval-policy classification: ruled out (above - an actual gate
  would have produced apr- ids on the card and an approval row).
- Version skew: ruled out - the string exists verbatim at c24a7e5,
  which both Vercel (Block V' PASS) and the host (CL-2/2 PASS) serve.
- Interpreter drift: the pinned deterministic tests at the same
  commit-line prove the CL-3.1 request interprets to 3 tasks /
  requires_approval=false each / approvals_required=0 / hash
  5bd2ea4b (composer-engine.test.ts:52,54,224,226,237; 81/81 pass).
  The created jobs' titles match the pin exactly.
- Migration/schema drift and confirmation-engine defect: nothing in
  the persist path branches on wording; DB confirmation below closes
  the last gap.

## Bounded fix (committed, NOT deployed)

06ce6a4 on phase7/offhost-0802:
- actions.ts: notice now branches on
  `outcome.created.some((g) => g.approval_ids.length > 0)`;
  all-GREEN graphs read "... All tasks are auto-runnable - no owner
  approval required."; gated graphs keep the original sentence.
- composer-ui.test.ts: +2 regression tests (ungated notice must NOT
  claim gated tasks; gated CL-3b-style request must). Composer suites
  81/81; tsc 0; eslint 0; scanners 0/0.
No safety control was touched; approval creation/verification logic
is unchanged.

## Owner SQL - the smallest read-only block that closes the diagnosis
(staging SQL editor; replace nothing - ids are inlined)

```sql
select id, title, status, requires_approval, approval_id,
       executed, simulation_only, risk_class
from goal_jobs
where goal_id = '106adcdf-7cd8-4929-a567-0de7f5f81036'
order by created_at;

select count(*) as approval_rows
from orchestration_approvals
where goal_id = '106adcdf-7cd8-4929-a567-0de7f5f81036';

select count(*) as dep_edges
from job_dependencies
where goal_id = '106adcdf-7cd8-4929-a567-0de7f5f81036';
```

EXPECT: 3 rows - requires_approval=false, approval_id null,
executed=false, simulation_only=true on every row, statuses pending;
approval_rows = 0; dep_edges = 2.

## Disposition

- If the SQL matches EXPECT: Gate B closes PASS WITH NOTE (cosmetic
  wording defect, fixed at 06ce6a4). The drill CONTINUES at c24a7e5
  unchanged - no redeploy mid-drill; the corrected wording reaches
  staging with the next merge + Vercel deploy + host re-pin gate.
  Duplicate-confirm (B6) is then safe to press, AFTER this SQL
  capture, with expected response "Duplicate confirmation detected -
  existing records returned, nothing new created." and unchanged
  counts.
- If the SQL shows ANY approval row or requires_approval=true:
  STOP - reclassify (that would be a real policy/persist divergence
  from the pins), full re-diagnosis before any further step.
