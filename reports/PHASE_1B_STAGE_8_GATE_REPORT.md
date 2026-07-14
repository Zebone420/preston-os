# Phase 1B Stage 8 - Approval Center Write-Path Gate Report

Gate result: PASS (owner-verified on staging Preview).
Scope: enable and verify the owner Approve/Reject decision write path on the
staging control plane. Control-plane only - no downstream business action
executes. No production, no secrets, no live sends/writes.

## What was verified (owner-run, staging)

V3 - decision write + state:
- One TEST approval row recorded as `approved`.
- The approved row has `decision_at` populated.
- A second TEST row remains `pending` (only the targeted row changed).
- `explicit_confirmation` remains `false` (a one-click decision is never the
  explicit confirmation RED execution would require).

V4 - audit row:
- `action = approval_decision:approved`
- `action_class = GREEN`
- `production_touched = false`
- `write_actions_performed = false`

Together these prove the Approval Center records decisions and audit
evidence WITHOUT executing any downstream business action.

## Enabling change (owner-run SQL, Stage 8 packet)

Per reports/PHASE_1B_STAGE_8_APPROVAL_WRITE_PATH_OWNER_SQL_PACKET.md:
`grant update on public.approvals to authenticated;`
`grant insert on public.audit_log to authenticated;`
(authenticated only; RLS still owner-scoped; audit_log stays append-only.)

## Hardening already in code + tests (no further change needed)

- Optimistic concurrency / double-decision idempotency: decideApprovalRow
  updates WHERE id = <uuid> AND decision = 'pending'; a second decision
  matches 0 rows and returns `not_pending` (tested:
  test/approvals-store.test.ts:171).
- explicit_confirmation stays false (tested: approvals-store.test.ts:161).
- Owner-only re-check inside the Server Action before any write
  (app/approvals/actions.ts) - defense in depth over the proxy gate + RLS.
- Input validation: decision must be approved|rejected; id must be a uuid;
  notes clamped to 500 chars.
- Non-execution is independently guaranteed by evaluateExecution()
  (lib/approvals.ts): RED/BLACK never execute, status must be approved,
  production blocked, DISABLE_* shutoffs.

## Reject-path decision

Reject uses the identical write path as Approve (same conditional update +
audit insert; only the decision literal differs) and is already covered by
unit tests. A live Reject click on staging is therefore NOT required for
credible Stage 8 completion. An optional owner-run Reject validation is
documented in the Stage 8 SQL packet's verification section (insert a second
test row, click Reject, expect decision=rejected + audit
action=approval_decision:rejected). The AI does not click or mutate live
staging data.

## Optional cleanup (owner-run, NOT executed by AI)

The remaining pending TEST row may be left in place (harmless) or removed by
the owner in the SQL editor:

    delete from public.approvals where requested_action like 'TEST -%';

Do not delete via the app; the app has no approval-delete path by design.

## Safety ledger

Production touched: false. Secrets exposed: false. Live emails/messages:
false. Live business writes: false. Downstream action executed: false.
Owner-run SQL executed by AI: false.

## Verdict

Stage 8 PASS. Approve/Reject decisions and audit records work as a
control-plane; no downstream execution is possible from a decision.
