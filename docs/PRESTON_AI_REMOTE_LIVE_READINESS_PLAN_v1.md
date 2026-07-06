# PRESTON AI REMOTE-LIVE READINESS PLAN v1

Status: Planning doc. Files-only. Defines what must be TRUE and PROVEN before
the system can run remotely without the owner's laptop ("laptop-close-safe").
Reuses: SSH spec (PRESTON_AI_SSH_ACCESS_SPEC_v1), emergency shutoff spec
(DISABLE_REMOTE_RUNNER), Command Gateway (max_runtime_seconds, audit).
Nothing here authorizes a remote runner. DISABLE_REMOTE_RUNNER stays true.

## Definition

"Laptop-close-safe" = the approved workload continues correctly and safely on
the remote host with the owner's laptop closed, AND every safety control
(shutoff, audit, rollback, bounded runtime) works without the laptop present.
This claim is FORBIDDEN until every item below is proven with evidence.

## Preconditions (all required, none yet proven)

1. Remote host reachable per SSH spec; known_hosts fingerprint owner-verified
   against the Hetzner console. (Currently PENDING - agent SSH forbidden.)
2. All eight emergency shutoff flags present and fail-closed on the remote
   host, and settable by the owner without the laptop.
3. Command Gateway enforced remotely: no default-allow path; every action
   validated fail-closed; audit rows written remotely.
4. No live send/write path enabled. Remote runner is read-only / draft-only
   until a later RED gate.

## Remote runner stop controls

- DISABLE_REMOTE_RUNNER (fail-closed): true blocks any runner invocation.
  Flipping to false is a RED action requiring the corresponding gate.
- Owner kill works without the laptop: setting DISABLE_ALL_AI_WRITES=true on
  the host halts every write/send path (master kill).
- A documented, owner-tested procedure to stop the runner via the host
  (systemd stop / container stop) independent of the agent.

## Heartbeat

- The runner emits a heartbeat (timestamp + status) to an owner-visible
  surface (audit table / dashboard) at a fixed interval.
- Missed heartbeats beyond a threshold => auto-halt and owner alert. No silent
  continuation.

## Max runtime

- Every task carries max_runtime_seconds (Command Gateway). On timeout: kill,
  log, report. No unbounded loops.
- A global session cap bounds total remote runtime between owner check-ins.

## Emergency shutoff (remote)

- The eight flags apply on the host exactly as locally; missing/unparseable =
  blocked. Owner Kill Procedure (shutoff spec) requires no agent cooperation.

## Rollback

- Every remote change carries a rollback_note. Code changes are git-revertable.
- Infra changes are owner-approved and reversible; no destructive commands
  (SSH spec forbidden list).

## ChatGPT review checkpoint

- Before any escalation to remote-live, a review checkpoint re-confirms scope,
  boundaries, and that no RED boundary is silently crossed. External review
  output is advisory; it never overrides owner approval or a safety guard.

## Proof requirements (evidence, not claims)

Each of these must be demonstrated and recorded in a gate report before
"laptop-close-safe" may be stated:

- [ ] Shutoff flag flip on the host halts a running task (observed).
- [ ] Heartbeat present; simulated stall triggers auto-halt (observed).
- [ ] max_runtime_seconds kills a long task (observed).
- [ ] Audit rows written remotely for start/stop/timeout (observed).
- [ ] Owner stop procedure works with the laptop closed (observed).
- [ ] Rollback of a remote change verified (observed).

## Why current state is NOT laptop-close-safe

- No remote runner exists or is authorized; DISABLE_REMOTE_RUNNER is true.
- SSH fingerprint verification is PENDING; agent SSH is forbidden.
- Heartbeat, max-runtime enforcement, and remote audit are unbuilt/unproven.
- No evidence run has demonstrated remote stop/rollback.
- Therefore any laptop-close-safe claim now would be false (BLACK to claim).

## Next steps (later, owner-gated)

1. Owner verifies the SSH known_hosts fingerprint (YELLOW read-only inspection).
2. Build heartbeat + max-runtime enforcement locally with tests (GREEN).
3. Bounded staging drill proving the six proof items (YELLOW/RED as scoped).
4. Only then a report may record remote-live readiness for owner decision.
