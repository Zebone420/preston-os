# Preston AI OS - Production SSOT audit + convergence proof (2026-08-26)

Authoritative SSOT: PRODUCTION Supabase project hiqsymsiwonmvrbbqhhe
(the project used by preston-os-prod). Airtable EXPLICITLY EXCLUDED
pending separate audit. Read-only audit + one harmless doc goal; no
migrations, no RLS changes, no consequential mutations.

## Component matrix (full detail in section 3 of the session report)

All active components read AND write the production Supabase SSOT via
owner- or runtime-identity RLS-bound clients. No component holds
authoritative local state; no staging reference exists in any production
runtime path; service-role is never used in app/runtime code.

## Key code facts (agent-audited, file:line cited in transcript)

- os-runtime client: SUPABASE_URL + SUPABASE_RUNTIME_KEY + rotating
  refresh-token store; fail-closed; symmetric cross-env gate (production
  deployment REFUSES a staging URL and vice versa; staging ref appears in
  runtime code only as a denylist constant).
- Identity: owner-allowlisted authenticated JWT via refresh rotation;
  NEVER service-role (explicit in 7 modules).
- Execution gates intact: executed CHECK, execution_enabled forced false
  on writes, fail-closed controls, orchestrate-once capability chain,
  EXTERNAL_WRITE hard ceiling.
- Local state: ONLY a refresh-token credential cache (fails closed),
  derived dist/, isolated worktrees, logs. Locks/checkpoints/leases all
  in Supabase. No second canonical store.
- Airtable: dormant read-only TEST wrapper outside the runtime path;
  writeRecords() throws; policy denylist classifies airtable_write as
  blocked; prod Vercel has NO AIRTABLE_* env => unconfigured/fail-closed.
- Notion: zero references.

## Live convergence proof (2026-08-26 ~00:3x-00:5xZ)

A. submitPrestonGoal (ChatGPT/Preston Control, prod GPT surface):
   accepted - goal c882bfbe-d5a1-4299-9c5b-013d24279e08, job c1ef1c9a,
   approvals_required 0, request_id pc-ssot-proof-20260826.
B. Immediate read-back from prod Supabase: decomposed/pending/attempts 0,
   environment=production.
C/D. Worker convergence: earlier prod goals (MCPPRODB, GPTPRODB, Galaxy
   golden-baseline) transitioned to COMPLETED by the prod runtime -
   status written back to the same SSOT.
E. Dashboard /os/orchestration (prod) shows the SAME goal ids/states,
   SSOTPROOF goal at top.
F. Evidence/audit in same SSOT: job 493e0105 completed, assigned_role
   claude, attempts 1, evidence_refs real:...:executed:true +
   real-audit:...paths_ok:clean + real-provider:...role:claude.
G. No staging traffic (openapi/PRM/bridge all prod URLs; zero staging
   refs); no Airtable traffic (unconfigured).
H. Canonical id identity across ChatGPT -> SSOT -> Claude runtime ->
   evidence -> dashboard for the same goal/job ids.

## Findings

1. HERMES OBSERVER STALE (the one PARTIAL item): latest stored hermes
   observation bucket = 202608202133 (Aug 20). The prod hermes-observe
   timer has not persisted an observation since; the worker/orchestrator
   timer IS active (Aug 25 goals completed). Non-blocking for SSOT
   authority (observer is read-only), but the observer path is not
   currently converging. OWNER ACTION (host, SSH): systemctl status
   preston-hermes-observe.timer; check /var/lib/preston/hermes token
   store health; re-enable per runbook if intended.
2. Dead-letters (3) are historical drill residue (real_required tags);
   failed 0; non-blocking.
3. Dashboard Phase-7 page still shows "SIMULATION-ONLY" badge wording
   from the staging-era template while prod evidence refs show
   real:...executed:true - cosmetic stale text, already on the post-live
   backlog (UI badge), no state impact.
4. 0010's staging/simulation CHECK pins were evolved by later prod
   migrations (prod goals carry environment=production and complete with
   real evidence) - by design of the go-live; no action.

## Verdict

SSOT status: GREEN (with the hermes-liveness PARTIAL note). Production
Supabase is the single operational truth for every active component.
Airtable excluded. No split-brain, no dual-write, no staging leakage,
no authoritative local state. No RED changes required.
