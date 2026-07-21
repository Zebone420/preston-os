import { validateCommand, type CommandPacket } from './commands';
import {
  DEFAULT_CONTROLS,
  type HermesMode,
  type SystemControls,
} from './controls';
import { validateEnvelope, type EventEnvelope } from './transport';
import { validateCheckpoint, type Checkpoint } from './checkpoint';
import { redactSecrets, validateMemoryEntry } from './memory';
import type { MemoryType } from './types';

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
  telegramUpdates: 'telegram_updates', // migration 0006 (durable replay dedup)
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
// eq() is recursive and may be followed by order()+limit() so reads can stack
// filters deterministically (e.g. status filter -> priority order -> bound).
interface EqLimitChain {
  limit(n: number): PromiseLike<QueryResult>;
  eq(col: string, val: string): EqLimitChain;
  order(col: string, opts: { ascending: boolean }): OrderChain;
}
interface SelectChain {
  eq(col: string, val: string): EqLimitChain;
  order(col: string, opts: { ascending: boolean }): OrderChain;
  limit(n: number): PromiseLike<QueryResult>;
}
// Recursive guard chain so conditional writes can stack any number of guards
// (e.g. releaseLease filters job_id + owner + token; lease takeover filters
// job_id + expired-by lte; renewal filters live-until gt).
interface UpdateEqChain {
  select(cols: string): PromiseLike<QueryResult>;
  eq(col: string, val: string): UpdateEqChain;
  lte(col: string, val: string): UpdateEqChain;
  gt(col: string, val: string): UpdateEqChain;
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

// Controls read that DISTINGUISHES an unreadable control plane from a healthy
// "everything stopped" row (audit fix: the simulation loop must treat a read
// FAILURE as halted, because DEFAULT_CONTROLS' owner_stop=false would
// otherwise fail OPEN for the halt gate). readOk=false also covers a missing
// singleton row - the loop must not proceed on an unseeded control plane.
export async function readSystemControlsChecked(
  client: RuntimeClient,
): Promise<{ controls: SystemControls; readOk: boolean }> {
  try {
    const res = await client.from(RUNTIME_TABLES.controls).select('*').limit(1);
    if (res.error || !res.data || res.data.length === 0) {
      return { controls: { ...DEFAULT_CONTROLS }, readOk: false };
    }
    return { controls: mapControls(res.data[0]), readOk: true };
  } catch {
    return { controls: { ...DEFAULT_CONTROLS }, readOk: false };
  }
}

// Authenticated read-only connectivity probe (for db-health). Unlike
// readSystemControls (which fails closed to defaults), this SURFACES the error
// so a bad token / RLS denial is visible. Writes nothing.
export async function probeControls(
  client: RuntimeClient,
): Promise<{ ok: boolean; rows: number; error?: string }> {
  try {
    const res = await client.from(RUNTIME_TABLES.controls).select('*').limit(1);
    if (res.error) return { ok: false, rows: 0, error: res.error.message };
    return { ok: true, rows: (res.data ?? []).length };
  } catch (err) {
    return { ok: false, rows: 0, error: (err as Error).message };
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

// Jobs still in flight - the only statuses a cancel request may target.
// Anything terminal (done/failed/expired/superseded/etc.) is left untouched.
const CANCELLABLE_JOB_STATUSES = [
  'proposed', 'validated', 'queued', 'leased', 'running', 'checkpointed',
] as const;

// Request cancellation of one job (Phase 5J owner-cancel control). Sets
// cancel_requested=true via a conditional per-status CAS loop (the shared
// RuntimeClient surface has no `.in()`, so this tries each cancellable status
// in turn and stops at the first match) - race-safe, and it NEVER changes
// `status`, leases, or any execution field itself. The worker/dispatcher loop
// remains solely responsible for observing the flag and stopping at its own
// next safe checkpoint. Zero rows matched across every cancellable status
// (job not found, or already in a terminal state) is reported as a failure;
// the caller (controlplane.cancelJob) reads the row FIRST so an already
// cancel_requested job is reported idempotently instead of landing here.
//
// Accepted races (L3): (1) two concurrent cancelJob calls can both pass the
// caller's read-first check before either write lands, so both CAS updates
// below may match and both audit `job_cancel_requested` - a harmless double
// audit of an idempotent flag, not a double cancellation. (2) a job that
// transitions to a terminal status BETWEEN this loop's per-status attempts
// (the shared RuntimeClient has no `.in()`, so each cancellable status is
// tried in sequence) can fall through every eq('status', ...) attempt and
// come back not_cancellable even though it briefly held one of the
// cancellable statuses - fail-closed, the owner simply retries the cancel.
export async function requestJobCancel(
  client: RuntimeClient,
  jobId: string,
  now: string,
): Promise<WriteOutcome> {
  for (const status of CANCELLABLE_JOB_STATUSES) {
    const res = await client
      .from(RUNTIME_TABLES.jobs)
      .update({ cancel_requested: true, updated_at: now })
      .eq('id', jobId)
      .eq('status', status)
      .select('id');
    if (res.error) return { ok: false, error: 'job cancel failed: ' + res.error.message };
    if (res.data && res.data.length > 0) return { ok: true, id: jobId };
  }
  return { ok: false, error: 'job not in a cancellable state (or not found); nothing changed' };
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

// Release only the caller's own lease GENERATION (owner + token match), by
// expiring it now. The token guard fences stale generations: a delayed release
// from a crashed/expired attempt must never expire a successor's live lease.
export async function releaseLease(
  client: RuntimeClient,
  jobId: string,
  owner: string,
  token: string,
  now: string,
): Promise<WriteOutcome> {
  const res = await client
    .from(RUNTIME_TABLES.leases)
    .update({ expires_at: now })
    .eq('job_id', jobId)
    .eq('owner', owner)
    .eq('token', token)
    .select('job_id');
  if (res.error) return { ok: false, error: 'lease release failed: ' + res.error.message };
  return { ok: true, id: jobId };
}

// --- lease acquisition / renewal (Phase 5B; DB unique(job_id) is the CAS) ---

export interface LeaseAcquisition {
  ok: boolean;
  via?: 'fresh' | 'takeover';
  error?: string;
}

// Atomically acquire the lease for a job. Two paths, both race-safe:
//  1. INSERT a new lease row - the unique(job_id) constraint means exactly one
//     concurrent acquirer wins; a duplicate here is NOT idempotent success (a
//     second worker must lose), so this deliberately does not use appendRow.
//  2. If a lease row exists, TAKE OVER only when it is already expired, via a
//     conditional update guarded by lte(expires_at, now) - an unexpired lease
//     can never be stolen, and two takeover racers resolve by rows-matched.
export async function acquireLease(
  client: RuntimeClient,
  jobId: string,
  owner: string,
  token: string,
  ttlMs: number,
  now: string,
): Promise<LeaseAcquisition> {
  if (!(ttlMs > 0)) return { ok: false, error: 'ttl must be > 0 (no permanent leases)' };
  if (!owner || !token) return { ok: false, error: 'owner and token required' };
  const expires = new Date(Date.parse(now) + ttlMs).toISOString();

  const ins = await client
    .from(RUNTIME_TABLES.leases)
    .insert({ job_id: jobId, owner, token, acquired_at: now, expires_at: expires })
    .select('job_id');
  if (!ins.error) return { ok: true, via: 'fresh' };
  if (!isUniqueViolation(ins.error.message)) {
    return { ok: false, error: 'lease insert failed: ' + ins.error.message };
  }

  const take = await client
    .from(RUNTIME_TABLES.leases)
    .update({ owner, token, acquired_at: now, expires_at: expires })
    .eq('job_id', jobId)
    .lte('expires_at', now)
    .select('job_id');
  if (take.error) return { ok: false, error: 'lease takeover failed: ' + take.error.message };
  if (!take.data || take.data.length === 0) {
    return { ok: false, error: 'lease held by a live owner (not stealable)' };
  }
  return { ok: true, via: 'takeover' };
}

// Renew only the caller's own LIVE lease (owner+token+not-yet-expired). Zero
// matched rows = the lease was lost (expired/taken) - the caller must treat
// that as lease loss and stop writing.
export async function renewLeaseDb(
  client: RuntimeClient,
  jobId: string,
  owner: string,
  token: string,
  ttlMs: number,
  now: string,
): Promise<WriteOutcome> {
  if (!(ttlMs > 0)) return { ok: false, error: 'ttl must be > 0' };
  const res = await client
    .from(RUNTIME_TABLES.leases)
    .update({ expires_at: new Date(Date.parse(now) + ttlMs).toISOString() })
    .eq('job_id', jobId)
    .eq('owner', owner)
    .eq('token', token)
    .gt('expires_at', now)
    .select('job_id');
  if (res.error) return { ok: false, error: 'lease renew failed: ' + res.error.message };
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: 'lease lost (expired or taken over); stop work' };
  }
  return { ok: true, id: jobId };
}

// CAS the job row into 'leased' and stamp the lease fields, guarded on the
// expected prior status. Zero rows = lost race; the caller must release the
// lease row it just acquired (compensation) and move on.
export async function markJobLeased(
  client: RuntimeClient,
  jobId: string,
  owner: string,
  token: string,
  leaseExpiresAt: string,
  now: string,
): Promise<WriteOutcome> {
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .update({
      status: 'leased', lease_owner: owner, lease_token: token,
      lease_expires_at: leaseExpiresAt, updated_at: now,
    })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id');
  if (res.error) return { ok: false, error: 'job lease update failed: ' + res.error.message };
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: 'job not queued anymore (lost race); nothing changed' };
  }
  return { ok: true, id: jobId };
}

// Complete one bounded simulation generation: leased -> checkpointed, with the
// attempt counter stamped from the known snapshot and the write fenced by the
// caller's own lease token so a stale generation can never complete a job it
// no longer owns.
export async function completeSimulatedJob(
  client: RuntimeClient,
  jobId: string,
  token: string,
  attempts: number,
  now: string,
): Promise<WriteOutcome> {
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .update({ status: 'checkpointed', attempts, updated_at: now })
    .eq('id', jobId)
    .eq('status', 'leased')
    .eq('lease_token', token)
    .select('id');
  if (res.error) return { ok: false, error: 'job completion failed: ' + res.error.message };
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: 'job not leased by this generation (fenced); nothing changed' };
  }
  return { ok: true, id: jobId };
}

// Recover jobs stranded in 'leased' by a crashed generation (audit fix: the
// selector only considers 'queued', so without this sweep a crash between
// markJobLeased and completion strands the job forever). Time-fenced: only
// rows whose lease_expires_at has passed are requeued, so a LIVE generation
// can never be yanked. Attempts are not incremented here - the crashed
// generation's attempt (if written) is already dedup-keyed by its lease token.
export async function recoverExpiredLeasedJobs(
  client: RuntimeClient,
  now: string,
): Promise<{ recovered: number; error?: string }> {
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .update({ status: 'queued', updated_at: now })
    .eq('status', 'leased')
    .lte('lease_expires_at', now)
    .select('id');
  if (res.error) return { recovered: 0, error: res.error.message };
  return { recovered: (res.data ?? []).length };
}

// Requeue a job after a blocked/failed simulation attempt: leased -> queued,
// attempts stamped, fenced by the caller's lease token. The lease fields stay
// on the row as evidence of the last generation; selection ignores them.
export async function requeueJob(
  client: RuntimeClient,
  jobId: string,
  token: string,
  attempts: number,
  now: string,
): Promise<WriteOutcome> {
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .update({ status: 'queued', attempts, updated_at: now })
    .eq('id', jobId)
    .eq('status', 'leased')
    .eq('lease_token', token)
    .select('id');
  if (res.error) return { ok: false, error: 'job requeue failed: ' + res.error.message };
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: 'job not leased by this generation (fenced); nothing changed' };
  }
  return { ok: true, id: jobId };
}

// Bounded, deterministic read of jobs in one status (selection logic itself is
// pure - candidates.selectCandidateJobs). Read-only; no side effect.
export async function listJobsByStatus(
  client: RuntimeClient,
  status: string,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .select('*')
    .eq('status', status)
    .order('priority', { ascending: false })
    .limit(Math.max(0, limit));
  if (res.error) return { rows: [], error: res.error.message };
  return { rows: res.data ?? [] };
}

// --- checkpoint read path (Phase 5C) ---------------------------------------

export async function readLatestCheckpoint(
  client: RuntimeClient,
  jobId: string,
): Promise<{ row: Record<string, unknown> | null; error?: string }> {
  const res = await client
    .from(RUNTIME_TABLES.checkpoints)
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (res.error) return { row: null, error: res.error.message };
  return { row: res.data?.[0] ?? null };
}

// --- staging job intake (Phase 5D; queue-only, never executable) -----------

export interface StagingJobInput {
  id: string;
  command_id: string;
  approval_id: string;
  risk_class: string;
  priority?: number;
  not_before: string;
  expires_at: string;
  idempotency_key: string;
  correlation_id: string;
  max_attempts?: number;
}

// Insert a QUEUED staging job. Forces the fail-closed posture on write:
// execution_enabled=false, cancel_requested=false, attempts=0. GREEN only -
// anything else is refused before any write. idempotency_key is DB-unique, so
// a replayed intake dedupes to the existing job (duplicate:true) and can never
// create a second one.
export async function insertStagingJob(
  client: RuntimeClient,
  job: StagingJobInput,
): Promise<WriteOutcome> {
  if (job.risk_class !== 'GREEN') {
    return { ok: false, error: 'staging jobs must be GREEN (got ' + job.risk_class + ')' };
  }
  if (!job.approval_id) return { ok: false, error: 'approval_id required (fail-closed)' };
  if (!job.correlation_id || !job.idempotency_key) {
    return { ok: false, error: 'correlation_id and idempotency_key required' };
  }
  const res = await client
    .from(RUNTIME_TABLES.jobs)
    .insert({
      id: job.id, command_id: job.command_id, approval_id: job.approval_id,
      status: 'queued', risk_class: 'GREEN', priority: job.priority ?? 0,
      not_before: job.not_before, expires_at: job.expires_at,
      attempts: 0, max_attempts: job.max_attempts ?? 3,
      idempotency_key: job.idempotency_key, correlation_id: job.correlation_id,
      execution_enabled: false, cancel_requested: false,
    })
    .select('id');
  if (res.error) {
    if (isUniqueViolation(res.error.message)) return { ok: true, duplicate: true, id: job.id };
    return { ok: false, error: 'staging job insert failed: ' + res.error.message };
  }
  return { ok: true, id: firstId(res, job.id) };
}

// --- telegram durable replay dedup (Phase 5G; migration 0006) --------------

// Record an update_id durably. duplicate:true = REPLAY (the caller must treat
// the update as already consumed). Any other error fails closed (caller must
// NOT proceed as if the update were fresh).
export async function recordTelegramUpdate(
  client: RuntimeClient,
  updateId: number,
  correlationId: string,
): Promise<WriteOutcome> {
  if (!Number.isInteger(updateId) || updateId <= 0) {
    return { ok: false, error: 'invalid update_id' };
  }
  const res = await client
    .from(RUNTIME_TABLES.telegramUpdates)
    .insert({ update_id: updateId, correlation_id: correlationId })
    .select('update_id');
  if (res.error) {
    if (isUniqueViolation(res.error.message)) return { ok: true, duplicate: true };
    return { ok: false, error: 'telegram update record failed: ' + res.error.message };
  }
  return { ok: true };
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
  // Enforce the memory contract before any write: provenance + reject
  // secret-shaped keys / bad version (matches every sibling adapter).
  const v = validateMemoryEntry({
    memory_type: entry.memory_type as MemoryType,
    key: entry.key,
    actor: entry.actor,
    source: entry.source,
    version: entry.version,
    correlation_id: entry.correlation_id,
  });
  if (!v.ok) return { ok: false, error: 'invalid memory: ' + v.errors.join(', ') };
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
