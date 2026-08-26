# Bridge B5 staging acceptance plan (G1-G12)

Target build: feature/preston-control head (B1-B4 + P0.1 + acceptance tests).
Production untouched throughout B5. Two deployment prerequisites:

- P-A (owner): `git push` the branch; promote the Ready preview to the
  staging alias (same flow as the c870b40 drill). Activates B1/B3/B4 + P0.1.
- P-B (owner, host): rebuild the STAGING runtime at the pushed SHA
  (`git fetch && git checkout <sha> && npm ci && npm run build:os-runtime`
  as the service user, per the standing deployment packet). Required for G2/
  G3/G11 (result emission); G1/G4-G10/G12 work with P-A alone.
- P-C (owner, optional for GPT-surface parity checks): staging GPT editor
  schema re-import (new operations); re-check the aip callback afterwards.
  MCP connector discovers the new tools live - no action.

Drill surface: staging MCP connector (same chat), verified server-side in the
staging read-model / Vercel logs where applicable. Use canonical grammar
("Create one task to ...") and neutral wording (no "production", no numbered
multi-task form).

| Gate | Procedure | PASS criteria |
|---|---|---|
| G1 per-job read | Submit a harmless single-task goal; call preston_get_job on its job id | found=true, projected fields, run inactive, result_reports [] pre-tick |
| G2 readable result | After the next orchestrator tick (<=5 min), preston_get_job again | result_reports has attempt 1: outcome completed, mode real, executed true, non-empty summary + result_excerpt; "what did Claude do" answerable from ChatGPT alone |
| G3 result integrity | Compare result_reports[0] run/goal/job/attempt to the job row's evidence_refs (real:... ref) | ids match exactly; files_changed within allowed paths |
| G4 cancel, no confirmation | preston_cancel_goal without owner_confirmation on a fresh pending goal | ok=false, decision_made=false, required_confirmation "Cancel goal <id>", restatement present, goal/jobs unchanged |
| G5 cancel, wrong phrase | Confirmation naming a DIFFERENT goal id | cancel_confirmation_id_mismatch, nothing changed |
| G6 cancel, valid | Owner types "Cancel goal <id>" | goal + non-terminal jobs cancelled, ev-cancel event present, unrelated goals untouched |
| G7 cancel replay | Repeat the exact same call | already_cancelled no-op, single audit event |
| G8 follow-up | preston_follow_up_goal on the G2 goal: "Create one task to document the acceptance outcome." | fresh goal id, parent_goal_id echoed; get_goal(child) shows parent, get_goal(parent) shows child; parent row unmodified |
| G9 approval regression | Submit a gated instruction (schema migration plan); attempt decide without/with wrong confirmation, then owner decides with exact phrase OR leaves parked | G8 handshake behavior byte-identical to the sealed contract |
| G10 idempotency regression | Re-send G1's submit with the same request_id | duplicate, same ids; follow-up replay likewise |
| G11 bounded exec regression + P0.2 residual | Submit one audit-kind task ("Create one task to audit the staging status page for stale text.") and one code-safe task; wait a tick | both completed with real:...executed:true evidence AND result_reports - closes the P0.2 residual (audit/recommendation real completion) |
| G12 surface parity | GPT Actions calls of getPrestonJob / cancelPrestonGoal / followUpPrestonGoal after P-C | same semantics as MCP (shared layer); openapi ops=9, descriptions <=300 (already unit-pinned) |

Also verify on any tick log after P-B: `orchestration_recorded:true` in the
hermes_loop line (P0.1 observability), and observed_bucket advancing.

Residue policy: drill goals/approvals are sim-only residue, documented, no
cleanup mechanism by design; approvals expire in 24h. The G6 cancel drill
doubles as residue cleanup for its own goal.

Evidence: capture tool outputs + read-model ids into
reports/BRIDGE_B5_STAGING_ACCEPTANCE_EVIDENCE_<date>.md, commit on the branch.
