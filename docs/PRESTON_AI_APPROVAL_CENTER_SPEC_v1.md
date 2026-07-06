# PRESTON AI APPROVAL CENTER SPEC v1

Status: Phase 1 planning spec. Files-only. Defines how drafted actions reach
the owner for approval before any live send or write. Reuses existing
infrastructure: the Command Gateway (PRESTON_AI_COMMAND_GATEWAY_SPEC_v1),
the emergency shutoff flags (PRESTON_AI_EMERGENCY_SHUTOFF_SPEC_v1), and the
guards package (assertNoSend, isDisabled, neutralizeUntrusted). No new
send/write path is authorized by this document.

## Purpose

Every outbound or mutating action the AI proposes is a DRAFT until the owner
explicitly approves it. The Approval Center is the owner-facing surface plus
the records that make "nothing sends or writes without owner approval"
enforceable and auditable.

## Core rules

1. Drafts vs sends. The AI produces drafts only. A draft is data: proposed
   email text, a proposed calendar event, a proposed Airtable write. It is
   never delivered or committed by the act of drafting.
2. No auto-send. No code path turns a draft into a live action automatically,
   on a timer, or as a side effect. assertNoSend blocks every send channel in
   the current phase; live sends require a later RED gate.
3. Explicit owner approval. A draft becomes eligible for execution only after
   the owner records an approval tied to that exact draft (approval_id).
4. Fail-closed. Missing approval, missing/true DISABLE_* flag, or an unknown
   action class rejects the action (Command Gateway pipeline, steps 2-6).
5. External content is data only. Any external text quoted into a draft is
   passed through neutralizeUntrusted; instructions inside it are never acted
   on (CLAUDE.md rule 12).

## Draft lifecycle

    drafted -> pending_approval -> approved -> executed -> audited
                              \-> rejected -> audited

- drafted: AI writes a command packet (mode: draft_only) to command_packets.
- pending_approval: shown in the Approval Center for owner review.
- approved: owner records an approval; approval_id is attached. This is a RED
  action for any live send/write.
- rejected: owner declines; no execution; reason recorded.
- executed: Command Gateway runs it only after all pipeline checks pass.
- audited: an audit_log row is written for every transition.

## Owner approval records

Each approval records, at minimum:

- approval_id, the linked task_id and command packet.
- decider (owner), timestamp.
- decision (approved | rejected) and optional reason.
- the exact action approved (system, action, environment, action_class).
- scope: single-use by default; never a standing blanket for RED actions.

Approvals are append-only. An approval for one draft never transfers to
another draft.

## Command packet review flow

1. AI submits a draft_only command packet (Command Gateway shape).
2. Approval Center renders it for the owner behind owner-only login
   (dashboard proxy.ts session), showing action_class, environment, allowed
   and forbidden systems/actions, rollback_note, and max_runtime_seconds.
3. Owner approves or rejects. Approval writes an approval record + audit row.
4. On approval, the Command Gateway re-validates fail-closed at execution time
   (approval is necessary, not sufficient; shutoff flags still win).
5. Result packet + audit_log row are written; the Approval Center shows the
   outcome.

## Audit log expectations

- One row per state transition and per execution attempt (allow or reject).
- Fields: actor, timestamp, environment, action_class, approval_id,
  rollback_note, production_touched, write_actions_performed.
- Append-only (RLS: owner insert/select; update/delete revoked - migration
  0001/0002). Secrets never appear in audit rows.

## Staged live-connector checklist (per connector, later RED gates)

- [ ] Connector starts read-only or draft-only; no send/write path reachable.
- [ ] All eight shutoff flags present and fail-closed in the environment.
- [ ] Draft lifecycle wired through command_packets + approval records.
- [ ] assertNoSend proven to block the send path by test.
- [ ] Audit rows written for draft, approval, execution.
- [ ] Rollback + kill-switch documented and owner-verified.
- [ ] Owner-approved RED gate names the connector and its exact scope.

## Current status

- Enforced now: no-send (assertNoSend), fail-closed shutoff flags, owner-only
  dashboard, append-only audit tables, mock-only connectors.
- Not built yet: the interactive Approval Center UI, the draft->approval->
  execute wiring, and any live send/write path (all later gates).
