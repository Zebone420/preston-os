# Preston AI OS - Distributed Architecture v1

Purpose: the reference architecture for turning Preston OS into a secure,
distributed AI operating system that coordinates multiple AI agents (Claude
Code, ChatGPT, Codex, Hermes, future agents/MCP servers) over ONE trusted
operational state. Phase 2. Staging only; everything non-executing/fail-closed
until owner-gated activation.

## 1. Sources of truth (unchanged, enforced)

- GitHub: code, docs, tests, runbooks, migrations. Nothing else owns code.
- Supabase: ALL operational state - agent registry, shared memory, locks,
  execution queue, events, approvals, audit, tasks, command packets. Nothing
  else owns operational state.

The dashboard app is a stateless client over these; future workers are too.

## 2. Layers

1. Contracts (code): apps/dashboard/src/lib/ai-os/types.ts - the shared typed
   vocabulary every agent uses (AgentRecord, MemoryEntry, LockRecord,
   ExecutionRecord, OsEvent + enums + PIPELINE_STAGES).
2. Pure coordination logic (code, unit-tested, no I/O): pipeline.ts, locks.ts,
   memory.ts, registry.ts, events.ts. These compute DECISIONS
   (advance/acquire/validate) so the DB can enforce them with a
   compare-and-set. Deterministic given an injected `now`.
3. Operational state (Supabase, migration 0003): agents, agent_memory, locks,
   execution_queue, os_events - all owner-only RLS, append-only where noted.
4. Orchestration (future, disabled): Hermes + Remote Runner.
5. Presentation: the owner control center (dashboard).

## 3. Shared memory spec

Table agent_memory (append-only, versioned). Every entry carries provenance:
timestamp (created_at), actor, source, version, correlation_id, audit_ref, and
a memory_type from: project, architecture, decision, task, execution,
deployment, connector, agent, checkpoint, conversation.

Rules (enforced in memory.ts):
- validateMemoryEntry() requires all provenance fields and rejects
  secret-shaped keys.
- redactSecrets() recursively strips secret-shaped fields from any value
  before persistence. Shared memory holds operational state, NEVER credentials.
- Updates are new version rows (append-only); readers take the highest version
  per (memory_type,key). RLS + revoked update/delete guarantee immutability.

Purpose: any agent can reconstruct "who am I / what's in flight / what's done /
what's blocked / what phase" from memory + registry, without chat history.

## 4. Agent registry spec

Table agents. Each agent: id, display_name, provider, model, capabilities,
allowed_connectors, permissions (via allowed_connectors + owner RLS), status,
current_task_id, last_seen (heartbeat), version, owner.

Liveness (registry.ts): effectiveStatus() treats any agent not seen within the
staleness window as offline regardless of recorded status - a crashed agent can
never appear "working". withHeartbeat() collapses unknown status to 'error'.

Seed agents (owner-run insert, example): claude-code (anthropic), chatgpt
(openai), codex (openai), hermes (preston, disabled). Owner assigns
capabilities + allowed_connectors per least-privilege.

## 5. Distributed locking spec

Table locks. Scopes: task, approval, document, repository, deployment,
execution. Guarantees (locks.ts + DB compare-and-set):
- Always expire (ttl > 0 required; no permanent locks) -> deadlock-safe.
- canAcquire(): free or expired -> acquirable; live -> only the owner
  (re-entrant). Stale locks are safely recoverable.
- Only the owner may release. Ownership + timestamps recorded.
- The DB conditional update (WHERE id AND (expired OR owner=me)) is the actual
  mutual-exclusion primitive; locks.ts computes the decision for tests.

## 6. Execution pipeline spec (nothing bypasses it)

Ordered stages (types.PIPELINE_STAGES): requested -> validation ->
safety_review -> approval_decision -> execution_intent -> execution_queue ->
worker_lease -> execution_attempt -> execution_result -> rollback -> audit.

advance() (pipeline.ts) permits exactly one step and is FAIL-CLOSED:
- no crossing into execution_intent+ without approved=true;
- RED/BLACK risk never reaches execution_attempt;
- execution_attempt requires execution_enabled globally AND per-record;
- execution_attempt requires a worker_lease.
Default execution_enabled is false in the schema and the context, so the
system is non-executing by default. This composes with the existing
evaluateExecution() guard (lib/approvals.ts).

## 7. Event bus spec

Table os_events (append-only). Typed events (types.EventType): TaskCreated/
Completed, ApprovalGranted/Rejected, ConnectorOnline/Offline, OAuthExpired/
Refreshed, WorkerStarted/Stopped, HermesStarted/Stopped, LockAcquired/Released,
ExecutionBlocked. events.makeEvent() shapes records. Transport
(publish/subscribe, e.g. Supabase Realtime or a poller) is a later gate; the
log itself is the durable, auditable fact stream now.

## 8. Remote Runner readiness (DISABLED)

Existing scaffold (lib/remote-control.ts): disabled-by-default runner,
OWNER_STOP kill switch, heartbeat, max-runtime, rollback, dry-run simulator.
To complete before a laptop-closed job (owner-gated):
- worker identity + lease (execution_queue.worker_lease + locks scope
  'execution'); timeouts, retry limits, checkpoint memory (memory_type
  'checkpoint'), crash/job recovery via expiring leases + idempotent stages;
  queue-health metrics via os_events. Least-privilege service identity (not the
  owner's OAuth). Activation is an owner-run staging drill (Phase 5 runbook).

## 9. Hermes readiness (DISABLED)

Hermes is the orchestration engine: poll execution_queue, dispatch leased work
to eligible workers, watch approvals + worker heartbeats + connector health,
maintain checkpoints + metrics + audit. It only ever calls advance() and
respects every gate; it cannot execute a RED/BLACK or unapproved or
execution-disabled record. Remains disabled; activation is a dedicated
owner-gated RED gate.

## 10. Plugin (connector) architecture

Connectors are capability modules keyed by name (google, airtable, slack,
teams, quickbooks, stripe, hubspot, andersen, voice, sms, mcp:*). Each agent's
allowed_connectors gates which it may use; every connector is read-only or
fail-closed by default and write paths stay blocked until an owner gate.
Current live connectors: google (read-only), airtable_test (read-only). The
uniform adapter shape (mock -> real by env presence, guard-enforced) is the
plugin contract; new connectors follow it.

## 11. Owner control center

The dashboard is the control center. Present: current phase/gate, system +
agent + runner + Hermes health, queue, memory, approvals, errors/warnings,
metrics, connectors, workers - all read from Supabase (registry, memory,
execution_queue, os_events). Presence-only status (no secret values), owner-only
behind the auth gate.

## 12. Security model

- Owner-only RLS on every operational table (public.is_owner()); append-only on
  memory + events; nothing granted to anon; service-role never in the app.
- Least privilege: agents.allowed_connectors + capabilities bound per agent.
- No secrets in shared memory (validated + redacted).
- Fail-closed pipeline; non-executing by default.
- Every state change is an auditable row (memory version / os_events / audit_log).

## 13. What is engineering-complete vs owner-gated

Complete now (code + schema + tests + docs): contracts, pure coordination
logic (pipeline/locks/memory/registry/events), migration 0003, this spec.
Owner-gated: apply migration 0003 (Stage 10 packet); seed agents; later gates
for event transport, Hermes, remote runner, and any connector write path.
Non-activating: no worker runs, no Hermes, no execution.
