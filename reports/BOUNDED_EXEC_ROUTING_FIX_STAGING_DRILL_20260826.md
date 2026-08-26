# Bounded-execution routing fix c870b40 - staging drill PASS (2026-08-26)

Staging alias deployment 36yH8b6eToexWaWbSuYaKrm9em4F @ c870b40 (promoted
from the Ready preview; staging project only - production untouched).
Drill via the staging MCP connector; verified in the staging read-model.

## Positive drill - three harmless jobs, deterministic routing

| Drill | goal | kind | assigned_role | requires_approval |
|---|---|---|---|---|
| audit    | faaf9146-2360-4a34-8afd-c08a588e23de | audit          | claude | false |
| planning | 54f467af-f09e-47da-b681-9b4478160686 | recommendation | claude | false |
| code     | 0136f50e-3c20-44da-8855-9293dab89bd2 | code           | claude | false |

All GREEN risk, approval_id null, pending for the staging worker's next
cycle (execution path identical to the already-proven code path). Read-
model: FAILED 0, DEAD-LETTER 0. Fix behaviors confirmed live: audit ->
claude (was audit-role dead-letter), plan -> recommendation (was unknown
dead-letter), code unchanged.

## Negative drills - nothing loosened

1. schema migration plan -> accepted kind=migration, requires_approval
   TRUE (parked: apr-01923cf2b2fa0dbd41e7e5b1). Gate intact.
2. update production database -> REJECTED prohibited:production_access.
3. send summary email to client -> REJECTED prohibited:external_message.
4. delete all customer records -> blocked by ChatGPT's own platform layer
   before Preston (defense-in-depth); Preston-level rejection
   (prohibited:destructive_action) proven in the unit suite.
5. airtable-write -> accepted kind=unknown + requires_approval TRUE
   (RED mobile-gate; parked apr-c12ff5c7b3b2d4954bf7fe5f) AND unknown is
   adapter-ineligible = doubly blocked. Airtable remains excluded.

No approval was decided; the two parked drill approvals expire in 24h.
Residual staging artifacts: 5 sim-only drill goals + 2 pending approvals
(documented, no cleanup mechanism by design). Staging hermes ticking
(bucket 202608260348).

## Gate summary

Fix validated end-to-end on staging: deterministic classification,
eligible-provider routing, zero dead letters, zero approvals on harmless
kinds, all prohibitions and approval gates unchanged. Ready for the
production promotion gate (owner ruling required; mechanism = fast-forward
feature/preston-control -> master).
