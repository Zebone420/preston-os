# N8N FIRST BOUNDED WORKFLOW PACKET v1 (INERT - PLAN ONLY)

Date: 2026-08-17. Status: PLAN. Nothing here activates anything.
CLAUDE.md rule 6 stands: no workflow activation, no active flag in
any payload, until the owner-approved RED gate in this packet's
section 6 - and that gate is sequenced AFTER Hermes H2 in the
activation order (status record sequence).

## 1. Scope decision (bounded by design)

The first n8n workflow is an INTAKE-ONLY actor. It submits neutral
doc-task requests into the existing SSOT bearer path
(public.submit_remote_intake) under its own identity n8n-1 and
reads back status via public.read_ssot_status. It executes nothing,
sends nothing, writes no business data, and has no DB credentials -
only the two SECURITY DEFINER gateway functions the anon key can
already reach (0011/0013 pattern; same path ChatGPT proved).

Explicitly OUT of scope for workflow 1: sends of any kind, calendar,
Airtable writes, business tables, execution, approvals, any second
workflow. Each of those is its own later gate.

## 2. Prerequisites (in order)

1. P2 PASS, Codex proof, T-mode proof, Hermes H1+H2 closed (the
   canonical sequence; n8n adds a NEW external service = late RED).
2. Migration 0016 OWNER-APPLIED (adds 'n8n' to the actor_registry
   role CHECK; grants nothing). Draft is committed:
   supabase/migrations/0016_actor_role_n8n.sql.
3. n8n host decision closed: the legacy public n8n console finding
   (LA-1, automation.prestonwd.com - unknown patch/auth state) must
   be resolved (harden or replace) BEFORE that instance gets a
   production token. A credentialed workflow on an unhardened
   public console is an instant fail condition.
4. Actor row: provision n8n-1 via
   scripts/p1/p1_actor_provision.ps1 -OnlyActor n8n-1
   (fresh prod token, hash-only in DB, 64-char check, 1Password
   entry PROD-n8n-1). Row starts enabled=false.

## 3. Workflow definition (bounded contract)

- Trigger: manual or single owner-controlled schedule (no public
  webhook in workflow 1; webhook exposure is its own later gate).
- Step 1: build a request body: request_id 'n8n-<date>-<seq>'
  (idempotency key), owner_identity fixed to the owner email,
  raw_request = a NEUTRAL doc task sentence (composer rejects
  execution-mode markers by design - keep text like
  "Create one task to document the n8n intake proof."),
  source 'api'.
- Step 2: POST to the intake route with the n8n-1 bearer token
  (n8n credential store; never in the workflow JSON export).
- Step 3: read back via the status route; record accepted/duplicate.
- No other nodes. No branches that write anywhere else.

Allowed inputs: the fixed neutral task text template.
Allowed outputs: the HTTP response status ONLY (logged in n8n).
Side-effect limit: one remote_intake_requests row per unique
request_id; everything downstream is the already-proven
composer -> approval -> driver machinery under owner control.

## 4. Approval requirements

Workflow 1 submissions are intake only; whether the resulting goal
parks for approval is decided by the SAME policy engine as every
other actor (no n8n-specific bypass). The n8n gate itself is RED:
owner enables the actor row, installs the credential in n8n, and
flips the workflow active - all owner-run.

## 5. Production proof (PASS criteria)

1. Submission accepted: remote_intake_requests row with
   actor_id='n8n-1', source='api', status pending->consumed.
2. Attribution: resulting master_goals row requested_by/actor
   stamping shows the n8n-1 identity (mirror the ChatGPT proof
   evidence shape in reports/PRESTON_CHATGPT_PROD_PROOF.md).
3. Idempotency: re-firing the workflow with the SAME request_id
   yields duplicate handling (no second row).
4. Negative: with n8n-1 disabled (enabled=false), the same call
   returns 401-class refusal - proven BEFORE enabling and again
   AFTER revocation (step 6), bracketing the proof.
5. No side effects beyond the intake row (evidence via
   scripts/p2/p2_drill_verify.ps1 capture pattern; files under
   reports/n8n_evidence/).

## 6. Revocation / rollback (prove one to close)

- update actor_registry set enabled=false where actor_id='n8n-1'
  (owner SQL) -> workflow submission refused. AND/OR
- deactivate the workflow in n8n (owner console action).
- Global: owner_stop=true halts all downstream processing anyway.
Rollback of a bad submission: rows are append-only intake; a bad
goal is cancelled/dead-lettered through the existing owner path.

## 7. Explicitly forbidden in this gate

Public webhook exposure; any n8n credential for Supabase beyond the
bearer token; any send node; any Airtable/business node; scheduling
more than one workflow; embedding the token in an exported workflow
JSON; running on the unhardened legacy console (see prerequisite 3).
