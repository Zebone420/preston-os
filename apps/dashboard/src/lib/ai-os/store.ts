import { validateCommand, type CommandPacket } from './commands';
import {
  DEFAULT_CONTROLS,
  type HermesMode,
  type SystemControls,
} from './controls';
import { validateEnvelope, type EventEnvelope } from './transport';
import { validateCheckpoint, type Checkpoint } from './checkpoint';
import { redactSecrets } from './memory';

// Preston AI OS - Supabase runtime adapters (Phase 3 wiring). Server-side,
// RLS-bound (owner session via the anon key). The service-role key is NEVER
// used here. Every write validates first, is idempotent (DB unique keys), and
// fails closed on error; reads fail closed to safe defaults. No secret is
// logged. This module persists control-plane STATE only; it executes nothing.

// Runtime table names. The command-intake table is runtime_command_packets -
// NEVER the legacy public.command_packets (migration 0001, different schema).
export const RUNTIME_TABLES = {
  commandPackets: 'runtime_command_packets',
  jobs: 'os_jobs',
  leases: 'worker_leases',
  attempts: 'job_attempts',
  deadLetters: 'dead_letters',
  events: 'os_events',
  checkpoints: 'job_checkpoints',
  controls: 'system_controls',
  agents: 'agents',
  memory: 'agent_memory',
  locks: 'locks',
  executionQueue: 'execution_queue',
  worktrees: 'repository_worktrees',
  orchestration: 'orchestration_decisions',
} as const;

export interface QueryResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

interface InsertChain {
  select(cols: string): PromiseLike<QueryResult>;
}
interface OrderChain {
  limit(n: number): PromiseLike<QueryResult>;
}
interface EqLimitChain {
  limit(n: number): PromiseLike<QueryResult>;
}
interface SelectChain {
  eq(col: string, val: string): EqLimitChain;
  order(col: string, opts: { ascending: boolean }): OrderChain;
  limit(n: number): PromiseLike<QueryResult>;
}
interface UpdateEqChain {
  select(cols: string): PromiseLike<QueryResult>;
  eq(col: string, val: string): { select(cols: string): PromiseLike<QueryResult> };
}
interface UpdateBuilder {
  eq(col: string, val: string): UpdateEqChain;
}

// Minimal injectable client (same idiom as approvals-store). Tests provide a
// fake; production passes the RLS-bound server Supabase client. Supports
// insert().select(), select().eq()/.order()/.limit(), and conditional
// update().eq()[.eq()].select() for compare-and-set writes.
export interface RuntimeClient {
  from(table: string): {
    insert(row: Record<string, unknown>): InsertChain;
    select(cols: string): SelectChain;
    update(row: Record<string, unknown>): UpdateBuilder;
  };
}

export interface WriteOutcome {
  ok: boolean;
  id?: string;
  duplicate?: boolean; // idempotent no-op (row already existed)
  error?: string;
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

function firstId(res: QueryResult, fallback: string): string {
  const v = res.data?.[0]?.['id'];
  return v ? String(v) : fallback;
}

// --- command packets -------------------------------------------------------

function mapCommandRow(p: CommandPacket): Record<string, unknown> {
  return {
    id: p.id,
    actor: p.actor,
    source: p.source,
    requested_action: p.requested_action,
    action_class: p.action_class,
    target_project: p.target_project,
    target_repository: p.target_repository,
    requested_scope: p.requested_scope,
    expected_outcome: p.expected_outcome,
    constraints: p.constraints,
    approval_required: p.approval_required,
    execution_eligible: false, // defense in depth: never persist as eligible
    correlation_id: p.correlation_id,
    idempotency_key: p.idempotency_key,
    status: p.status,
    audit_ref: p.audit_ref,
    expires_at: p.expires_at,
  };
}

export async function insertCommandPacket(
  client: RuntimeClient,
  packet: CommandPacket,
): Promise<WriteOutcome> {
  const v = validateCommand(packet);
  if (!v.ok) return { ok: false, error: 'invalid command: ' + v.errors.join(', ') };
  const res = await client
    .from(RUNTIME_TABLES.commandPackets)
    .insert(mapCommandRow(packet))
    .select('id');
  if (res.error) {
    if (isUniqueViolation(res.error.message)) {
      return { ok: true, duplicate: true, id: packet.id }; // idempotent
    }
    return { ok: false, error: 'command insert failed: ' + res.error.message };
  }
  return { ok: true, id: firstId(res, packet.id) };
}

export async function listCommandPackets(
  client: RuntimeClient,
  limit = 20,
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const res = await client
    .from(RUNTIME_TABLES.commandPackets)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) return { rows: [], error: res.error.message };
  return { rows: res.data ?? [] };
}

// --- system controls (fail-closed) -----------------------------------------

const HERMES_MODES: readonly HermesMode[] = [
  'disabled', 'observe_only', 'propose_only', 'dispatch_eligible', 'paused', 'stopped',
];

function mapControls(r: Record<string, unknown>): SystemControls {
  const mode = String(r['hermes_mode'] ?? 'disabled');
  return {
    execution_enabled: r['execution_enabled'] === true,
    owner_stop: r['owner_stop'] === true,
    paused: r['paused'] === true,
    hermes_mode: (HERMES_MODES as readonly string[]).includes(mode)
      ? (mode as HermesMode)
      : 'disabled',
    remote_runner_enabled: r['remote_runner_enabled'] === true,
    updated_at: String(r['updated_at'] ?? DEFAULT_CONTROLS.updated_at),
  };
}

// Read the single controls row. Missing row, RLS error, or any failure yields
// the fully-stopped DEFAULT_CONTROLS (fail-closed) - the runtime never treats
// an unreadable control plane as "active".
export async function readSystemControls(
  client: RuntimeClient,
): Promise<SystemControls> {
  try {
    const res = await client.from(RUNTIME_TABLES.controls).select('*').limit(1);
    if (res.error || !res.data || res.data.length === 0) {
      return { ...DEFAULT_CONTROLS };
    }
    return mapControls(res.data[0]);
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
}

// --- events (append-only) --------------------------------------------------

export async function insertEvent(
  client: RuntimeClient,
  e: EventEnvelope,
): Promise<WriteOutcome> {
  const v = validateEnvelope(e);
  if (!v.ok) return { ok: false, error: 'invalid event: ' + v.errors.join(', ') };
  const res = await client
    .from(RUNTIME_TABLES.events)
    .insert({
      id: e.id,
      type: e.type,
      actor: e.actor,
      correlation_id: e.correlation_id,
      payload: e.payload, // already redacted by makeEnvelope
    })
    .select('id');
  if (res.error) {
    if (isUniqueViolation(res.error.message)) return { ok: true, duplicate: true, id: e.id };
    return { ok: false, error: 'event insert failed: ' + res.error.message };
  }
  return { ok: true, id: firstId(res, e.id) };
}

// --- checkpoints (append-only) ---------------------------------------------

export async function insertCheckpoint(
  client: RuntimeClient,
  cp: Checkpoint,
  jobId: string,
): Promise<WriteOutcome> {
  const v = validateCheckpoint(cp);
  if (!v.ok) return { ok: false, error: 'invalid checkpoint: ' + v.errors.join(', ') };
  // Persist conclusions/evidence only, redacted - never raw secrets/reasoning.
  const detail = redactSecrets({
    files_changed: cp.files_changed,
    tests_run: cp.tests_run,
    validation: cp.validation,
    blockers: cp.blockers,
    owner_actions: cp.owner_actions,
    next_action: cp.next_action,
    rollback: cp.rollback,
  });
  const res = await client
    .from(RUNTIME_TABLES.checkpoints)
    .insert({
      job_id: jobId,
      agent_id: cp.agent_id,
      phase: cp.phase,
      gate: cp.gate,
      base_commit: cp.base_commit,
      current_commit: cp.current_commit,
      status: cp.status,
      detail,
      correlation_id: cp.correlation_id,
    })
    .select('id');
  if (res.error) return { ok: false, error: 'checkpoint insert failed: ' + res.error.message };
  return { ok: true, id: firstId(res, jobId) };
}

// Generic append helper for append-only / plain inserts (idempotent on unique).
async function appendRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
  id: string,
): Promise<WriteOutcome> {
  const res = await client.from(table).insert(row).select('id');
  if (res.error) {
    if (isUniqueViolation(res.error.message)) return { ok: true, duplicate: true, id };
    return { ok: false, error: table + ' write failed: ' + res.error.message };
  }
  return { ok: true, id: firstId(res, id) };
}

async function listRows(
  client: RuntimeClient,
  table: string,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const res = await client.from(table).select('*').order('created_at', { ascending: false }).limit(limit);
  if (res.error) return { rows: [], error: res.error.message };
  return { rows: res.data ?? [] };
}

// --- os_jobs ---------------------------------------------------------------

export async function insertJob(
  client: RuntimeClient,
  job: { id: string; command_id: string; correlation_id: string; idempotency_key: string; risk_class: string; expires_at: string; not_before: string },
): Promise<WriteOutcome> {
  // execution_enabled forced false on write (fail-closed; runtime never
  // persists a job as executable at intake).
  return appendRow(client, RUNTIME_TABLES.jobs, {
    id: job.id, command_id: job.command_id, status: 'proposed', risk_class: job.risk_class,
    execution_enabled: false, cancel_requested: false, correlation_id: job.correlation_id,
    idempotency_key: job.idempotency_key, expires_at: job.expires_at, not_before: job.not_before,
  }, job.id);
}

export function listJobs(client: RuntimeClient, limit = 20) {
  return listRows(client, RUNTIME_TABLES.jobs, limit);
}

// Conditional status change (compare-and-set): only transitions a job whose
// current status matches `from`. Zero matched rows => lost race / wrong state.
export async function updateJobStatus(
  client: RuntimeClient,
  jobId: string,
  from: string,
  to: string,
  now: string,
): Promise<WriteOutcome> {
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .update({ status: to, updated_at: now })
    .eq('id', jobId)
    .eq('status', from)
    .select('id');
  if (res.error) return { ok: false, error: 'job update failed: ' + res.error.message };
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: 'job not in expected state (lost race); nothing changed' };
  }
  return { ok: true, id: jobId };
}

// --- worker_leases (CAS relies on the DB unique(job_id) + this decision) ----

export async function readLease(
  client: RuntimeClient,
  jobId: string,
): Promise<{ owner: string; token: string; acquired_at: string; expires_at: string } | null> {
  const res = await client.from(RUNTIME_TABLES.leases).select('*').eq('job_id', jobId).limit(1);
  if (res.error || !res.data || res.data.length === 0) return null;
  const r = res.data[0];
  return {
    owner: String(r['owner']), token: String(r['token']),
    acquired_at: String(r['acquired_at']), expires_at: String(r['expires_at']),
  };
}

// Release only the caller's own lease (owner match), by expiring it now.
export async function releaseLease(
  client: RuntimeClient,
  jobId: string,
  owner: string,
  now: string,
): Promise<WriteOutcome> {
  const res = await client
    .from(RUNTIME_TABLES.leases)
    .update({ expires_at: now })
    .eq('job_id', jobId)
    .eq('owner', owner)
    .select('job_id');
  if (res.error) return { ok: false, error: 'lease release failed: ' + res.error.message };
  return { ok: true, id: jobId };
}

// --- append-only logs ------------------------------------------------------

export function insertAttempt(client: RuntimeClient, row: { id: string; job_id: string; attempt_no: number; worker: string; correlation_id: string; outcome?: string; error_class?: string }): Promise<WriteOutcome> {
  return appendRow(client, RUNTIME_TABLES.attempts, row, row.id);
}

export function insertDeadLetter(client: RuntimeClient, row: { id: string; job_id?: string; command_id?: string; reason: string; correlation_id: string; error_class?: string }): Promise<WriteOutcome> {
  return appendRow(client, RUNTIME_TABLES.deadLetters, row, row.id);
}

export function insertOrchestrationDecision(client: RuntimeClient, row: { id: string; job_id?: string; hermes_mode: string; decision: string; reasons: string[]; correlation_id: string }): Promise<WriteOutcome> {
  return appendRow(client, RUNTIME_TABLES.orchestration, row, row.id);
}

// --- agents ----------------------------------------------------------------

export async function upsertAgent(
  client: RuntimeClient,
  agent: { id: string; display_name: string; provider: string; model: string; capabilities: string[]; allowed_connectors: string[]; status: string; last_seen: string | null; version: string; owner: string },
): Promise<WriteOutcome> {
  const row = { ...agent };
  const upd = await client.from(RUNTIME_TABLES.agents).update(row).eq('id', agent.id).select('id');
  if (!upd.error && upd.data && upd.data.length > 0) return { ok: true, id: agent.id };
  return appendRow(client, RUNTIME_TABLES.agents, row, agent.id);
}

export function listAgents(client: RuntimeClient, limit = 50): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  return (async () => {
    const res = await client.from(RUNTIME_TABLES.agents).select('*').limit(limit);
    if (res.error) return { rows: [], error: res.error.message };
    return { rows: res.data ?? [] };
  })();
}

// --- agent_memory (append-only; validated + secret-free) -------------------

export async function insertMemory(
  client: RuntimeClient,
  entry: { id: string; memory_type: string; key: string; value: unknown; actor: string; source: string; version: number; correlation_id: string; audit_ref?: string | null },
): Promise<WriteOutcome> {
  const row = { ...entry, value: redactSecrets(entry.value), audit_ref: entry.audit_ref ?? null };
  return appendRow(client, RUNTIME_TABLES.memory, row, entry.id);
}

// --- locks (decision in locks.ts; DB unique(id) is the real guard) ---------

export async function readLock(client: RuntimeClient, id: string): Promise<Record<string, unknown> | null> {
  const res = await client.from(RUNTIME_TABLES.locks).select('*').eq('id', id).limit(1);
  if (res.error || !res.data || res.data.length === 0) return null;
  return res.data[0];
}

export async function releaseLock(client: RuntimeClient, id: string, owner: string, now: string): Promise<WriteOutcome> {
  const res = await client.from(RUNTIME_TABLES.locks).update({ expires_at: now }).eq('id', id).eq('owner', owner).select('id');
  if (res.error) return { ok: false, error: 'lock release failed: ' + res.error.message };
  return { ok: true, id };
}

// --- execution_queue -------------------------------------------------------

export function insertExecution(client: RuntimeClient, row: { id: string; packet_id: string; correlation_id: string; risk_class: string }): Promise<WriteOutcome> {
  return appendRow(client, RUNTIME_TABLES.executionQueue, {
    id: row.id, packet_id: row.packet_id, stage: 'requested', state: 'pending',
    risk_class: row.risk_class, approved: false, execution_enabled: false, correlation_id: row.correlation_id,
  }, row.id);
}

// --- repository_worktrees --------------------------------------------------

export async function upsertWorktree(
  client: RuntimeClient,
  wt: { id: string; repo: string; path: string; agent: string | null; job_id: string | null; status: string; dirty: boolean; lock_id: string | null },
): Promise<WriteOutcome> {
  const upd = await client.from(RUNTIME_TABLES.worktrees).update({ ...wt }).eq('id', wt.id).select('id');
  if (!upd.error && upd.data && upd.data.length > 0) return { ok: true, id: wt.id };
  return appendRow(client, RUNTIME_TABLES.worktrees, { ...wt }, wt.id);
}
