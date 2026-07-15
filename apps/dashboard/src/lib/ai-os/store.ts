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
  events: 'os_events',
  checkpoints: 'job_checkpoints',
  controls: 'system_controls',
  agents: 'agents',
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
interface SelectChain {
  order(col: string, opts: { ascending: boolean }): OrderChain;
  limit(n: number): PromiseLike<QueryResult>;
}

// Minimal injectable client (same idiom as approvals-store). Tests provide a
// fake; production passes the RLS-bound server Supabase client.
export interface RuntimeClient {
  from(table: string): {
    insert(row: Record<string, unknown>): InsertChain;
    select(cols: string): SelectChain;
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
