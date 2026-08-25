# G8 owner-boundary repair - ambiguous approval references (2026-08-24)

## Defect (G8, native ChatGPT Android app, staging)

With exactly one decision-open approval (apr-41eadf71b90b7a8622be3318) the
owner said only "Approve that." The GPT resolved the pronoun to the open
approval id and called decidePrestonApproval; the server decided it.
Result: a consequential decision from an ambiguous reference.

## Root cause

The confirm-with-the-owner rule lived ONLY in prompt/tool-description text.
prestonDecideApproval (the shared boundary both the MCP tool and the GPT
REST route call in front of decide_orchestration_approval) accepted any
well-formed approval_id + outcome, so any conversational layer that
"helpfully" resolved an ambiguous reference could decide.

## Invariant added (server-enforced, both transports)

tools.ts prestonDecideApproval now runs a confirmation handshake BEFORE the
authoritative RPC:

- The call must carry owner_confirmation matching (case-insensitive verb,
  optional word "approval", trailing ./! ignored):
  "approve|approved|reject|rejected <exact approval id>".
  The id itself must appear in the phrase, so "Approve that.", "Approve it.",
  "Go ahead.", "Do it.", "Approve the pending one." can NEVER satisfy it -
  even when exactly one approval is open.
- Verb must match the requested outcome; a different id refuses with
  owner_confirmation_id_mismatch; a conflicting verb refuses with
  owner_confirmation_outcome_mismatch.
- Without a valid confirmation: NO decision, decision_made:false, and the
  server RESTATES the approval (exact approval_id + action text + status)
  with the required phrase and instructions to have the OWNER type it.
- With it: the unchanged authoritative path (decide_orchestration_approval:
  owner-only, one-time nonce, in-transaction audit) records the decision.
- x-openai-isConsequential stays true (ChatGPT Allow card unchanged).
- submitPrestonGoal and all read operations unchanged.

## Files changed (commit ec0698b)

- src/lib/preston-control/tools.ts (evaluateOwnerConfirmation + handshake)
- src/lib/preston-control/schemas.ts (owner_confirmation field, both surfaces)
- src/lib/preston-control/openapi.ts (schema + handshake contract text)
- src/lib/preston-control/server.ts (MCP tool description)
- test/preston-control-owner-confirmation.test.ts (NEW - 14 regressions)
- test/preston-control-{tools,gpt,route}.test.ts (decide calls updated to
  the new contract)

## Regression coverage (all pass)

1 one-open + "Approve that." -> no decision, restatement; 2 "Reject that."
-> no decision; 3 multiple open + ambiguous (4 variants) -> zero RPC calls,
all rows pending; 4 exact id, no confirmation -> no decision; 5 two-phase
restate -> exact phrase -> approved once, one audit row; 6 explicit reject
phrase -> rejected; 7 confirmation naming a different approval refused +
sibling approval untouched by a valid decision; 8 rejected gated job:
attempts 0, requires_approval true, not executed; 9 already-decided and
expired still fail closed WITH valid confirmation; 10 harmless non-gated
goal submission unaffected. Plus pure-function refusal matrix (15 vague
phrases) and chatter-wrapped phrases refused.

## Validation

- Control suites 5 files / 82 tests pass; full suite 1496 pass + 1 expected
  fail + 5 known worktree-prep env fails (compensated: bash -n 3/3 OK,
  secret scan 0, RED scan 0 via Git Bash directly).
- tsc 0, eslint 0, next build pass. Pre-commit scanners 0/0.

## Staging deployment + verification

- Branch commit ec0698b pushed; preview 45o6QRVBFeTosXkfGAFBFvJPat3r (Ready)
  promoted to the STAGING project's Production: deployment
  7yTh6SiUmHd9255DcH66EvWawuUC, Ready 28s, alias preston-os-staging.vercel.app.
- Live alias openapi.json verified: DecideApprovalRequest.owner_confirmation
  present with the never-compose contract; decidePrestonApproval description
  carries the SERVER-ENFORCED handshake; isConsequential true.
- The real production Vercel project, prod host, prod SSOT: untouched. No
  migrations, no credential/OAuth changes (the earlier same-day callback
  repair is separate, report PRESTON_CONTROL_CALLBACK_ROTATION_FIX).
- NOTE: enforcement is server-side, so even a GPT with the CACHED old action
  schema can no longer decide from "Approve that." - the call arrives without
  owner_confirmation and gets the restatement refusal. Refreshing the action
  schema in the GPT editor improves UX only (model learns to collect the
  phrase). Re-check the aip callback id after any GPT edit (known rotation
  gotcha).

## Remaining risks / edge cases

- A conversational layer that deliberately FABRICATES the confirmation phrase
  (it can read ids via list_approvals) cannot be distinguished server-side;
  mitigations remain the tool contract, the ChatGPT Allow card, and the
  owner-only/one-time/audited DB path. Next escalation if ever needed: an
  approval-specific confirmation code displayed only in the owner dashboard.
- Old chats pinned to stale GPT versions fail closed (restatement refusals).
- The dashboard /os/orchestration Approve/Reject buttons are unchanged by
  design: clicking a specific row's button IS explicit target selection in
  an owner-authenticated session.
