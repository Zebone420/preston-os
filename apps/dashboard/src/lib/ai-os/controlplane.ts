import { isOwnerEmail } from '../owner-auth';
import { logAudit, type AuditSink } from '../audit';
import {
  isValidRuntimeId,
  normalizeCommand,
  validateCommand,
  RUNTIME_ID_RE,
  type CommandPacket,
  type CommandSource,
} from './commands';
import {
  insertCommandPacket,
  insertStagingJob,
  readSystemControls,
  requestJobCancel,
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

// Exported (Phase 5J) so the ChatGPT intake route can re-screen a proposal
// against the same production markers before it ever reaches this module.
export function mentionsProduction(...parts: (string | undefined)[]): boolean {
  return parts.some((p) => /\bprod(uction)?\b/i.test(p ?? ''));
}

// Narrow deps a proposal-creation call actually needs (client + audit only) -
// a structural subset of ControlPlaneDeps, so both the owner path (which has
// a full ControlPlaneDeps) and the ChatGPT intake route (which has no
// env/now) can call this with their own deps object, no adapter required.
export interface CommandProposalDeps {
  client: RuntimeClient;
  audit: AuditSink | null;
}

export interface CreateProposalOptions {
  actor: string;
  // ChatGPT (and any other external connector) never gets an implicitly-
  // approved proposal: forces approval_required=true/execution_eligible=false
  // regardless of classifyRisk's verdict. The owner path leaves the packet's
  // own normalizeCommand-computed values untouched (omit/false).
  forceApproval?: boolean;
}

// Shared proposal-creation core (audit fix F4): screen->validate->insert->
// audit, in that exact order (production screen BEFORE insert), used by both
// submitCommandProposal (owner path) and processChatGptIntake (ChatGPT path)
// so the two can never drift on ordering, audit event names, or GREEN/RED
// classification. Mutates `packet` in place when forceApproval is set - same
// packet object the caller already holds and will read fields back from.
export async function createCommandProposal(
  deps: CommandProposalDeps,
  packet: CommandPacket,
  opts: CreateProposalOptions,
): Promise<HandlerResult> {
  if (opts.forceApproval) {
    packet.approval_required = true;
    packet.execution_eligible = false; // defense in depth (normalizeCommand already forces this)
  }

  if (mentionsProduction(packet.target_project, packet.target_repository, packet.requested_scope, packet.requested_action)) {
    await logAudit(
      { actor: opts.actor, action: 'command_rejected:production_target', action_class: 'RED', detail: { target_project: packet.target_project } },
      { supabase: deps.audit },
    );
    return { ok: false, code: 'production_rejected', message: 'production targets are not permitted' };
  }

  const v = validateCommand(packet);
  if (!v.ok) return { ok: false, code: 'invalid', message: v.errors.join(', ') };

  const w = await insertCommandPacket(deps.client, packet);
  if (!w.ok) return { ok: false, code: 'write_failed', message: w.error ?? 'insert failed' };

  await logAudit(
    { actor: opts.actor, action: 'command_proposed', action_class: 'GREEN', detail: { id: packet.id, action_class: packet.action_class, source: packet.source } },
    { supabase: deps.audit },
  );
  return {
    ok: true,
    code: w.duplicate ? 'duplicate' : 'proposed',
    message: 'command recorded as a proposal; approval ' + (packet.approval_required ? 'required' : 'not required'),
    id: w.id,
  };
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
  return createCommandProposal(deps, packet, { actor });
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

export type ControlAction = 'pause' | 'resume' | 'stop' | 'kill';

// Owner pause / resume / stop / kill. NONE of these ever touch
// execution_enabled, remote_runner_enabled, or hermes_mode - enabling
// execution or the runner stays owner-run SQL / a RED gate, never this path.
// `stop` sets owner_stop (hard halt); `pause` is a soft pause; `resume` clears
// both (execution_enabled remains whatever it was - default false); `kill`
// (Phase 5J) writes the IDENTICAL hard-halt patch as `stop` (owner_stop+paused
// in one update) but is audited RED instead of YELLOW - it is the same halt,
// just named and logged for an emergency/owner-kill-switch call site rather
// than a routine stop. Kill invents no new control-plane flag. `resume`
// remains the one and only reversal path for owner_stop regardless of
// whether it was set by `stop` or `kill` - that is unchanged/existing
// behavior (deliberately NOT special-cased here), so an owner-run `resume`
// always clears it; there is no separate "un-kill" flag to invent.
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
      : action === 'stop' || action === 'kill'
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

  const actionClass = action === 'kill' ? 'RED' : action === 'stop' ? 'YELLOW' : 'GREEN';
  await logAudit(
    { actor, action: 'control:' + action, action_class: actionClass, detail: patch },
    { supabase: deps.audit },
  );
  return { ok: true, code: action, message: 'runtime control updated: ' + action };
}

export interface CancelJobInput {
  ownerEmail: string | null;
  jobId: string; // uuid
  correlation_id: string;
  reason?: string;
}

// Owner job-cancel request (Phase 5J). Sets cancel_requested=true on one job
// so the worker/dispatcher loop can observe it and stop cooperatively at its
// next safe point - this handler itself performs NO execution, lease action,
// or lifecycle transition. Idempotent: a job already flagged cancel_requested
// is reported back as an already-true no-op (code 'already_requested')
// instead of re-auditing a fresh request. Owner-gated, uuid-validated, and
// only ever touches the one job row it targets.
export async function cancelJob(
  deps: ControlPlaneDeps,
  input: CancelJobInput,
): Promise<HandlerResult> {
  if (!ownerOk(input.ownerEmail, deps.env)) {
    return { ok: false, code: 'denied', message: 'owner authorization required' };
  }
  const actor = input.ownerEmail as string;
  if (!UUID_RE.test(input.jobId)) {
    return { ok: false, code: 'invalid', message: 'job_id must be a uuid' };
  }
  if (!isValidRuntimeId(input.correlation_id)) {
    return { ok: false, code: 'invalid', message: 'correlation_id required and must match ' + RUNTIME_ID_RE.source };
  }

  // Read first: an already-flagged job must be reported idempotently, never
  // re-audited as a fresh cancel request.
  const read = await deps.client
    .from(RUNTIME_TABLES.jobs)
    .select('*')
    .eq('id', input.jobId)
    .limit(1);
  if (read.error || !read.data || read.data.length === 0) {
    return { ok: false, code: 'unknown_job', message: 'job not found' };
  }
  const row = read.data[0];
  if (row['cancel_requested'] === true) {
    return { ok: true, code: 'already_requested', message: 'cancellation already requested', id: input.jobId };
  }

  const w = await requestJobCancel(deps.client, input.jobId, deps.now);
  if (!w.ok) {
    return { ok: false, code: 'not_cancellable', message: 'job is not in a cancellable state' };
  }

  await logAudit(
    {
      actor, action: 'job_cancel_requested', action_class: 'YELLOW',
      detail: { job_id: input.jobId, reason: input.reason ?? null, correlation_id: input.correlation_id },
    },
    { supabase: deps.audit },
  );
  return { ok: true, code: 'cancel_requested', message: 'cancellation requested', id: input.jobId };
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
