import { isOwnerEmail } from '../owner-auth';
import { logAudit, type AuditSink } from '../audit';
import { normalizeCommand, validateCommand, type CommandSource } from './commands';
import {
  insertCommandPacket,
  insertStagingJob,
  readSystemControls,
  RUNTIME_TABLES,
  type RuntimeClient,
} from './store';

// Preston AI OS - control-plane handlers (Phase 3). The owner-checked,
// validated, audited logic every future HTTP route / Server Action calls.
// Each handler: re-checks owner authorization server-side, validates input,
// rejects production targets, writes an audit entry, exposes no secret, and
// runs NO shell / business action. Commands become proposals only (default-
// deny). pause/resume/stop are safe owner controls; enabling execution or the
// runner is NOT exposed here (stays owner-run SQL / RED gate).

type Env = Record<string, string | undefined>;

export interface ControlPlaneDeps {
  client: RuntimeClient;
  audit: AuditSink | null;
  env: Env;
  now: string;
}

export interface HandlerResult {
  ok: boolean;
  code: string;
  message: string;
  id?: string;
}

function ownerOk(ownerEmail: string | null | undefined, env: Env): boolean {
  return isOwnerEmail(ownerEmail ?? null, env);
}

function mentionsProduction(...parts: (string | undefined)[]): boolean {
  return parts.some((p) => /\bprod(uction)?\b/i.test(p ?? ''));
}

export interface SubmitInput {
  ownerEmail: string | null;
  source: CommandSource;
  requested_action: string;
  target_project: string;
  target_repository: string;
  requested_scope?: string;
  expected_outcome?: string;
  constraints?: string[];
  correlation_id: string;
  idempotency_key: string;
  commandId: string;
}

// Submit a command PROPOSAL. Never eligible for execution; owner-gated,
// production-rejected, audited.
export async function submitCommandProposal(
  deps: ControlPlaneDeps,
  input: SubmitInput,
): Promise<HandlerResult> {
  if (!ownerOk(input.ownerEmail, deps.env)) {
    return { ok: false, code: 'denied', message: 'owner authorization required' };
  }
  const actor = input.ownerEmail as string;
  if (mentionsProduction(input.target_project, input.target_repository, input.requested_scope, input.requested_action)) {
    await logAudit(
      { actor, action: 'command_rejected:production_target', action_class: 'RED', detail: { target_project: input.target_project } },
      { supabase: deps.audit },
    );
    return { ok: false, code: 'production_rejected', message: 'production targets are not permitted' };
  }
  const packet = normalizeCommand({
    id: input.commandId,
    actor,
    source: input.source,
    requested_action: input.requested_action,
    target_project: input.target_project,
    target_repository: input.target_repository,
    requested_scope: input.requested_scope,
    expected_outcome: input.expected_outcome,
    constraints: input.constraints,
    correlation_id: input.correlation_id,
    idempotency_key: input.idempotency_key,
    now: deps.now,
  });
  const v = validateCommand(packet);
  if (!v.ok) return { ok: false, code: 'invalid', message: v.errors.join(', ') };

  const w = await insertCommandPacket(deps.client, packet);
  if (!w.ok) return { ok: false, code: 'write_failed', message: w.error ?? 'insert failed' };

  await logAudit(
    { actor, action: 'command_proposed', action_class: 'GREEN', detail: { id: packet.id, action_class: packet.action_class, source: packet.source } },
    { supabase: deps.audit },
  );
  return {
    ok: true,
    code: w.duplicate ? 'duplicate' : 'proposed',
    message: 'command recorded as a proposal; approval ' + (packet.approval_required ? 'required' : 'not required'),
    id: w.id,
  };
}

export interface EnqueueInput {
  ownerEmail: string | null;
  jobId: string; // uuid, route-generated
  command_id: string; // must reference an existing runtime command packet
  approval_id: string; // owner approval evidence (uuid)
  correlation_id: string;
  idempotency_key: string;
  priority?: number;
  ttl_ms?: number;
}

const ENQUEUE_TTL_MIN_MS = 60_000; // 1 min
const ENQUEUE_TTL_MAX_MS = 24 * 3600_000; // 24 h
const ENQUEUE_TTL_DEFAULT_MS = 3600_000; // 1 h
const ENQUEUE_PRIORITY_BOUND = 1_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Enqueue one QUEUED staging job for an already-proposed command (Phase 5D).
// Queue-only: this NEVER executes, leases, or enables anything. Owner-gated,
// audited, idempotent (job idempotency_key is DB-unique - a replay dedupes to
// the existing job), GREEN-only, bounded expiry. The referenced command packet
// must exist, be GREEN, and mention no production target.
export async function enqueueStagingJob(
  deps: ControlPlaneDeps,
  input: EnqueueInput,
): Promise<HandlerResult> {
  if (!ownerOk(input.ownerEmail, deps.env)) {
    await logAudit(
      { actor: input.ownerEmail ?? 'unknown', action: 'job_enqueue_rejected:denied', action_class: 'YELLOW', detail: {} },
      { supabase: deps.audit },
    );
    return { ok: false, code: 'denied', message: 'owner authorization required' };
  }
  const actor = input.ownerEmail as string;
  if (!input.command_id || !input.approval_id || !input.correlation_id || !input.idempotency_key) {
    return { ok: false, code: 'invalid', message: 'command_id, approval_id, correlation_id, idempotency_key required' };
  }
  // Shape validation BEFORE any DB round-trip: both ids land in uuid columns,
  // so reject malformed input with a clean message instead of surfacing a raw
  // DB cast error (audit fix). Priority is bounded to a sane integer.
  if (!UUID_RE.test(input.command_id) || !UUID_RE.test(input.approval_id)) {
    return { ok: false, code: 'invalid', message: 'command_id and approval_id must be uuids' };
  }
  if (input.priority !== undefined
    && (!Number.isInteger(input.priority) || Math.abs(input.priority) > ENQUEUE_PRIORITY_BOUND)) {
    return { ok: false, code: 'invalid', message: 'priority must be an integer within +/-' + ENQUEUE_PRIORITY_BOUND };
  }

  // The command packet must already exist as a proposal - intake cannot invent
  // work. Re-screen it against production markers (defense in depth).
  const read = await deps.client
    .from(RUNTIME_TABLES.commandPackets)
    .select('*')
    .eq('id', input.command_id)
    .limit(1);
  if (read.error || !read.data || read.data.length === 0) {
    await logAudit(
      { actor, action: 'job_enqueue_rejected:unknown_command', action_class: 'YELLOW', detail: { command_id: input.command_id } },
      { supabase: deps.audit },
    );
    return { ok: false, code: 'unknown_command', message: 'command packet not found' };
  }
  const packet = read.data[0];
  if (String(packet['action_class']) !== 'GREEN') {
    await logAudit(
      { actor, action: 'job_enqueue_rejected:not_green', action_class: 'YELLOW', detail: { command_id: input.command_id, action_class: String(packet['action_class']) } },
      { supabase: deps.audit },
    );
    return { ok: false, code: 'not_green', message: 'staging jobs require a GREEN command' };
  }
  if (mentionsProduction(
    String(packet['requested_action'] ?? ''),
    String(packet['target_project'] ?? ''),
    String(packet['target_repository'] ?? ''),
  )) {
    await logAudit(
      { actor, action: 'job_rejected:production_target', action_class: 'RED', detail: { command_id: input.command_id } },
      { supabase: deps.audit },
    );
    return { ok: false, code: 'production_rejected', message: 'production targets are not permitted' };
  }

  const ttl = Math.min(ENQUEUE_TTL_MAX_MS, Math.max(ENQUEUE_TTL_MIN_MS, input.ttl_ms ?? ENQUEUE_TTL_DEFAULT_MS));
  const w = await insertStagingJob(deps.client, {
    id: input.jobId,
    command_id: input.command_id,
    approval_id: input.approval_id,
    risk_class: 'GREEN',
    priority: input.priority ?? 0,
    not_before: deps.now,
    expires_at: new Date(Date.parse(deps.now) + ttl).toISOString(),
    idempotency_key: input.idempotency_key,
    correlation_id: input.correlation_id,
  });
  if (!w.ok) return { ok: false, code: 'write_failed', message: w.error ?? 'insert failed' };

  await logAudit(
    {
      actor, action: 'job_enqueued', action_class: 'GREEN',
      detail: { job_id: input.jobId, command_id: input.command_id, duplicate: w.duplicate === true },
    },
    { supabase: deps.audit },
  );
  return {
    ok: true,
    code: w.duplicate ? 'duplicate' : 'queued',
    message: w.duplicate
      ? 'idempotent replay; existing job unchanged'
      : 'staging job queued (execution stays disabled)',
    id: w.duplicate ? undefined : input.jobId,
  };
}

export type ControlAction = 'pause' | 'resume' | 'stop';

// Owner pause / resume / stop. Never enables execution or the runner. `stop`
// sets owner_stop (hard halt); `pause` is a soft pause; `resume` clears both
// (execution_enabled remains whatever it was - default false).
export async function requestControl(
  deps: ControlPlaneDeps,
  ownerEmail: string | null,
  action: ControlAction,
): Promise<HandlerResult> {
  if (!ownerOk(ownerEmail, deps.env)) {
    return { ok: false, code: 'denied', message: 'owner authorization required' };
  }
  const actor = ownerEmail as string;
  const patch =
    action === 'pause'
      ? { paused: true }
      : action === 'stop'
        ? { owner_stop: true, paused: true }
        : { paused: false, owner_stop: false };
  const res = await deps.client
    .from(RUNTIME_TABLES.controls)
    .update({ ...patch, updated_at: deps.now })
    .eq('id', 'global')
    .select('id');
  if (res.error) return { ok: false, code: 'write_failed', message: res.error.message };
  if (!res.data || res.data.length === 0) {
    // Zero matched rows (e.g. unseeded singleton): an owner control that wrote
    // nothing must not report success. Controls already fail closed to stopped.
    return { ok: false, code: 'write_failed', message: 'no control row updated; nothing changed' };
  }

  await logAudit(
    { actor, action: 'control:' + action, action_class: action === 'stop' ? 'YELLOW' : 'GREEN', detail: patch },
    { supabase: deps.audit },
  );
  return { ok: true, code: action, message: 'runtime control updated: ' + action };
}

export interface StatusView {
  execution_enabled: boolean;
  owner_stop: boolean;
  paused: boolean;
  hermes_mode: string;
  remote_runner_enabled: boolean;
}

// Read-only status (no secrets). Fail-closed via readSystemControls.
export async function readStatus(deps: ControlPlaneDeps): Promise<StatusView> {
  const c = await readSystemControls(deps.client);
  return {
    execution_enabled: c.execution_enabled,
    owner_stop: c.owner_stop,
    paused: c.paused,
    hermes_mode: c.hermes_mode,
    remote_runner_enabled: c.remote_runner_enabled,
  };
}
