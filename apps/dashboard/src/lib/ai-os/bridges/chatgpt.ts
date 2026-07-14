import { normalizeCommand, type CommandPacket } from '../commands';
import { type SystemControls, isHalted } from '../controls';

// Preston AI OS - ChatGPT command bridge (Phase 3). PURE intake contract.
// ChatGPT does NOT mount the repo or run shell. A request becomes a normalized,
// default-deny command PACKET routed to Supabase for approval/queue/Hermes.
// This module validates + normalizes; it never executes anything and never
// exposes secrets/keys.

export interface ChatGptRequest {
  owner_identity: string; // must be on the owner allowlist
  requested_action: string;
  target_project: string;
  target_repository: string;
  requested_scope?: string;
  expected_outcome?: string;
  constraints?: string[];
  idempotency_key: string;
  correlation_id: string;
}

export type ChatGptStatus =
  | 'accepted'
  | 'rejected'
  | 'denied'
  | 'paused'
  | 'stopped';

export interface ChatGptResponse {
  status: ChatGptStatus;
  command_id: string | null;
  message: string;
  owner_action: string | null;
}

export interface ChatGptIntakeOpts {
  ownerAllowlist: string[]; // lowercased owner identities
  controls: SystemControls;
  now: string;
  commandId: string; // caller-provided id
  ttlMs?: number;
}

export interface ChatGptIntakeResult {
  response: ChatGptResponse;
  packet: CommandPacket | null; // null unless accepted
}

function ownerOk(identity: string, allowlist: string[]): boolean {
  const id = (identity ?? '').trim().toLowerCase();
  return id !== '' && allowlist.map((a) => a.trim().toLowerCase()).includes(id);
}

// Convert an authenticated ChatGPT request into a proposal. Owner identity must
// match the allowlist; a halted/paused runtime yields a status-only response
// (still no execution). Accepted requests return a default-deny command packet.
export function intakeChatGpt(
  req: ChatGptRequest,
  opts: ChatGptIntakeOpts,
): ChatGptIntakeResult {
  if (!ownerOk(req.owner_identity, opts.ownerAllowlist)) {
    return {
      response: { status: 'denied', command_id: null, message: 'owner identity not authorized', owner_action: null },
      packet: null,
    };
  }
  if (isHalted(opts.controls)) {
    return {
      response: { status: 'stopped', command_id: null, message: 'runtime is stopped (owner_stop or execution disabled)', owner_action: 'resume runtime to accept commands' },
      packet: null,
    };
  }
  if (opts.controls.paused) {
    return {
      response: { status: 'paused', command_id: null, message: 'runtime is paused', owner_action: 'resume to accept commands' },
      packet: null,
    };
  }

  const packet = normalizeCommand({
    id: opts.commandId,
    actor: req.owner_identity,
    source: 'chatgpt',
    requested_action: req.requested_action,
    target_project: req.target_project,
    target_repository: req.target_repository,
    requested_scope: req.requested_scope,
    expected_outcome: req.expected_outcome,
    constraints: req.constraints,
    correlation_id: req.correlation_id,
    idempotency_key: req.idempotency_key,
    now: opts.now,
    ttlMs: opts.ttlMs,
  });

  return {
    response: {
      status: 'accepted',
      command_id: packet.id,
      message: `command proposed (${packet.action_class}); approval ${packet.approval_required ? 'required' : 'not required'}`,
      owner_action: packet.approval_required ? 'owner approval required before any execution' : null,
    },
    packet,
  };
}

// Status-poll summary for a command (no secrets). Caller supplies the current
// packet + optional job status string.
export function summarizeStatus(packet: CommandPacket, jobStatus?: string): string {
  return `command ${packet.id}: ${packet.status}/${packet.action_class}` + (jobStatus ? `, job=${jobStatus}` : '');
}
