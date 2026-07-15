import { isOwnerEmail } from '../owner-auth';
import { logAudit, type AuditSink } from '../audit';
import { normalizeCommand, validateCommand, type CommandSource } from './commands';
import {
  insertCommandPacket,
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
  if (mentionsProduction(input.target_project, input.target_repository, input.requested_scope)) {
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
