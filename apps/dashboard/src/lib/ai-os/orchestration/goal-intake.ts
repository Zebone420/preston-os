// Preston AI OS - Phase 7 goal intake (ChatGPT / Telegram command bridge).
// PURE. Validates an authenticated owner command envelope and turns a
// "submit master goal" command into a MasterGoal. Reuses the runtime id shape
// and secret rejection. SIMULATION-ONLY: no network, no auth I/O here - the
// envelope's authentication is verified UPSTREAM (route + owner session); this
// layer enforces structure, freshness, replay-safety, and default-deny.

import { RUNTIME_ID_RE, hasSecretText } from '../commands';
import {
  DEFAULT_BUDGET,
  validateMasterGoal,
  type ExecutionBudget,
  type MasterGoal,
} from './model';

export type CommandType =
  | 'submit_master_goal'
  | 'status'
  | 'pause'
  | 'resume'
  | 'owner_stop'
  | 'global_kill'
  | 'approve'
  | 'reject'
  | 'request_more_info'
  | 'retry'
  | 'cancel';

export const COMMAND_TYPES: readonly CommandType[] = [
  'submit_master_goal', 'status', 'pause', 'resume', 'owner_stop',
  'global_kill', 'approve', 'reject', 'request_more_info', 'retry', 'cancel',
];

export interface CommandEnvelope {
  owner_identity: string; // resolved upstream; must be the allowlisted owner
  source: 'chatgpt' | 'telegram' | 'dashboard' | 'owner_cli';
  command_type: CommandType;
  correlation_id: string;
  nonce: string; // one-time; caller passes a seen-set
  issued_at: string;
  expires_at: string;
  // submit_master_goal payload:
  title?: string;
  objective?: string;
  budget?: Partial<ExecutionBudget>;
}

export type IntakeResult =
  | { ok: true; kind: 'goal'; goal: MasterGoal }
  | { ok: true; kind: 'control'; command_type: CommandType }
  | { ok: false; errors: string[] };

// Validate + normalize an envelope. Fail-closed: bad shape, stale/expired,
// replayed nonce, unknown command, non-allowlisted owner, or secret text all
// reject. `ownerAllowlist` and `seenNonces` are supplied by the caller.
export function intakeCommand(input: {
  envelope: CommandEnvelope;
  ownerAllowlist: ReadonlySet<string>;
  seenNonces: ReadonlySet<string>;
  goalId: string; // minted by caller for a new goal
  now: string;
}): IntakeResult {
  const e = input.envelope;
  const errors: string[] = [];

  if (!e.owner_identity || !input.ownerAllowlist.has(e.owner_identity)) {
    errors.push('owner_not_allowlisted');
  }
  if (!COMMAND_TYPES.includes(e.command_type)) errors.push('command_type_invalid');
  if (!RUNTIME_ID_RE.test(e.correlation_id)) errors.push('correlation_id_invalid');
  if (!e.nonce || input.seenNonces.has(e.nonce)) errors.push('nonce_replay');
  const now = Date.parse(input.now);
  if (!Number.isFinite(Date.parse(e.issued_at))) errors.push('issued_at_invalid');
  if (!Number.isFinite(Date.parse(e.expires_at))) errors.push('expires_at_invalid');
  else if (Date.parse(e.expires_at) < now) errors.push('envelope_expired');
  if (hasSecretText(e.title ?? '', e.objective ?? '')) errors.push('secret_in_goal');

  if (errors.length) return { ok: false, errors };

  if (e.command_type !== 'submit_master_goal') {
    // Control commands are structurally valid; the controlplane applies them.
    return { ok: true, kind: 'control', command_type: e.command_type };
  }

  // Build the master goal (default-deny budget merge; staging + simulation).
  const budget: ExecutionBudget = {
    max_iterations: e.budget?.max_iterations ?? DEFAULT_BUDGET.max_iterations,
    max_job_retries: e.budget?.max_job_retries ?? DEFAULT_BUDGET.max_job_retries,
    max_wall_ms: e.budget?.max_wall_ms ?? DEFAULT_BUDGET.max_wall_ms,
    max_jobs: e.budget?.max_jobs ?? DEFAULT_BUDGET.max_jobs,
  };
  const goal: MasterGoal = {
    id: input.goalId,
    title: (e.title ?? '').trim(),
    objective: (e.objective ?? '').trim(),
    source: e.source,
    requested_by: e.owner_identity,
    status: 'proposed',
    environment: 'staging',
    budget,
    correlation_id: e.correlation_id,
    simulation_only: true,
    created_at: input.now,
    updated_at: input.now,
  };
  const gerrs = validateMasterGoal(goal);
  if (gerrs.length) return { ok: false, errors: gerrs };
  return { ok: true, kind: 'goal', goal };
}
