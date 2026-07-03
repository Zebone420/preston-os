# PRESTON AI COMMAND GATEWAY SPEC v1

Status: Phase 0A specification. Implementation begins Phase 0B.
Controlling plan: PRESTON_AI_BUSINESS_POWERSTATION_MASTER_PLAN_v2_1_REVISED.md (Section 5).

## Purpose

The Command Gateway is the safe bridge between AI intent and real tools.
Core principle: the brain has no hands unless the Gateway grants hands for
that specific task. Reasoning and execution are separate code paths.

## Command Packet Shape

Stored one row per requested action in the command_packets table:

    {
      "task_id": "string",
      "requested_by": "owner | staff | chatgpt | claude | codex | n8n",
      "environment": "test_dev | staging | production",
      "action_class": "GREEN | YELLOW | RED",
      "mode": "read_only | draft_only | approved_write | automated_low_risk | forbidden",
      "allowed_systems": [],
      "forbidden_systems": [],
      "allowed_actions": [],
      "forbidden_actions": [],
      "requires_owner_approval": true,
      "approval_id": "string",
      "rollback_note": "string",
      "max_runtime_seconds": 0,
      "production_touched": false,
      "write_actions_performed": false
    }

## Validation Pipeline (ordered, fail-closed)

Any failure rejects the packet and writes an audit record. There is no
default-allow path.

1. Schema-validate the packet. Unknown or missing fields: reject.
2. Emergency shutoff check. Any relevant DISABLE_* flag true or missing: reject.
3. Action class check. RED without an approval record with explicit
   confirmation: reject.
4. Environment check. production without Level 4 grant: reject.
5. Mode check. forbidden mode: reject. Any write mode without approval_id: reject.
6. Allow/forbid list check. Action or system on the forbidden list, or not
   on the allowed list: reject. The allowlist is authoritative.
7. Execute through a server-side tool adapter. Credentials load server-side
   only. Secret values never appear in results, logs, or error messages.
8. Write an audit_log row (actor, timestamp, environment, action class,
   rollback note) plus the result packet.
9. Enforce max_runtime_seconds. On timeout: kill, log, report.

## Responsibilities

1. Accept structured task requests.
2. Validate task class (GREEN / YELLOW / RED).
3. Check owner/staff approval status.
4. Enforce environment (test_dev / staging / production).
5. Enforce action mode.
6. Load credentials only server-side.
7. Hide raw secrets from AI prompts and logs.
8. Execute only allowed tools.
9. Write audit records.
10. Return machine-readable result packets.
11. Support emergency shutoff.

## Phase 0A Deliverable

This spec only. The guard behaviors it depends on are provided as local
check scripts in scripts/ during Phase 0A and become a shared library that
the Gateway imports in Phase 0B.
