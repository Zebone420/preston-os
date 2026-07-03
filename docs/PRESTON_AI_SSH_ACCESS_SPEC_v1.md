# PRESTON AI SSH ACCESS SPEC v1 (no secrets)

Status: Phase 0A document. NO SSH use occurs in Phase 0A. First permitted
use is a YELLOW read-only inspection in a later gate that names it.

## Host Alias

    preston-agent-staging

Already configured in the user's SSH config (verified by name only).

## User

Owner-approved non-root user. The owner confirms the username at Gate 0A-5.
Root login is never used by the agent.

## Key

Owner-provisioned SSH key. The agent never generates, reads, copies, moves,
or prints private keys. Keys are referenced by config alias only.

## known_hosts

Owner-verified fingerprint is REQUIRED before the agent's first connection.
Current state: known_hosts exists; fingerprint verification PENDING owner
confirmation against the Hetzner console. Until verified, agent SSH is
forbidden.

## Allowed Remote Paths

- /opt/preston-ai-os
- Owner-approved staging worktrees only.

## Forbidden

- Root access, unless separately approved by an owner RED gate.
- sudo changes.
- Firewall changes (ufw, iptables, nftables).
- Destructive commands (recursive deletes, disk tools, shutdown, killing
  unrelated processes).
- Production deploys.
- Printing secrets, .env contents, or key material.
- Editing SSH server configuration.
- StrictHostKeyChecking=no or auto-accepting fingerprints.
- Editing known_hosts to silence a warning.

## Required Stop (RED)

Unknown or changed host fingerprint, host key mismatch warning, or
authentication mismatch: hard stop, write audit note, owner review.
