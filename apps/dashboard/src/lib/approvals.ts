import { isDisabled, neutralizeUntrusted, type ShutoffFlag } from './guards';

// Approval Center - Phase 2 GREEN local foundation. Fail-closed by design:
// the AI can create command packets and drafts, but NOTHING executes a live
// send or write. There are no live connectors in this module; the execution
// guard only ever decides + returns an audit-shaped event, and the "execute"
// path produces a MOCK artifact only. Reuses guards (isDisabled shutoff flags,
// neutralizeUntrusted). See docs/PRESTON_AI_APPROVAL_CENTER_SPEC_v1.md and
// docs/PRESTON_AI_COMMAND_GATEWAY_SPEC_v1.md.

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'blocked';

export type ActionType =
  | 'draft_email'
  | 'send_email'
  | 'calendar_write'
  | 'airtable_write'
  | 'supabase_write'
  | 'n8n_action'
  | 'remote_command';

export type RiskClass = 'GREEN' | 'YELLOW' | 'RED' | 'BLACK';

export type Environment = 'test_dev' | 'staging' | 'production';

type Env = Record<string, string | undefined>;

// Action types that would touch a live connector. NONE of these execute in
// Phase 2 - they can be drafted and approved, but there is no execution path.
// Only 'draft_email' produces a (mock) artifact, and only once approved.
export const LIVE_ACTION_TYPES: ActionType[] = [
  'send_email',
  'calendar_write',
  'airtable_write',
  'supabase_write',
  'n8n_action',
  'remote_command',
];

export interface CommandPacket {
  task_id: string;
  action_type: ActionType;
  risk_class: RiskClass;
  environment: Environment;
  summary: string; // human summary; external text is neutralized on create
  created_at: string; // ISO
  requires_owner_approval: boolean;
  rollback_note?: string;
}

export interface OwnerDecision {
  approval_id: string;
  decision: 'approved' | 'rejected';
  decided_at: string; // ISO
  decider: 'owner';
  reason?: string;
}

export interface ApprovalRequest {
  approval_id: string;
  packet: CommandPacket;
  status: ApprovalStatus;
  created_at: string; // ISO
  expires_at: string; // ISO
  owner_decision?: OwnerDecision;
}

export interface AuditEvent {
  at: string;
  approval_id: string;
  task_id: string;
  action_type: ActionType;
  risk_class: RiskClass;
  event: 'execution_blocked' | 'executed_mock';
  reason: string;
  production_touched: boolean;
  write_actions_performed: boolean;
}

export interface ExecutionDecision {
  allowed: boolean;
  reason: string;
  audit: AuditEvent;
}

// ---- Factories (deterministic; caller injects `now`, no ambient clock) ----

export function createCommandPacket(input: {
  task_id: string;
  action_type: ActionType;
  risk_class: RiskClass;
  environment?: Environment;
  summary: string;
  now: string;
  rollback_note?: string;
}): CommandPacket {
  return {
    task_id: input.task_id,
    action_type: input.action_type,
    risk_class: input.risk_class,
    environment: input.environment ?? 'staging',
    // External/quoted content is data only - neutralize before storing.
    summary: neutralizeUntrusted(input.summary),
    created_at: input.now,
    requires_owner_approval: true, // Phase 2: every action requires approval
    rollback_note: input.rollback_note,
  };
}

export function createApprovalRequest(
  packet: CommandPacket,
  opts: { now: string; ttlMinutes?: number },
): ApprovalRequest {
  const ttl = opts.ttlMinutes ?? 60;
  const created = new Date(opts.now);
  const expires = new Date(created.getTime() + ttl * 60_000);
  return {
    approval_id: 'ap_' + packet.task_id,
    packet,
    status: 'pending',
    created_at: opts.now,
    expires_at: expires.toISOString(),
  };
}

export function decide(
  req: ApprovalRequest,
  input: { decision: 'approved' | 'rejected'; now: string; reason?: string },
): ApprovalRequest {
  const owner_decision: OwnerDecision = {
    approval_id: req.approval_id,
    decision: input.decision,
    decided_at: input.now,
    decider: 'owner',
    reason: input.reason,
  };
  return {
    ...req,
    status: input.decision === 'approved' ? 'approved' : 'rejected',
    owner_decision,
  };
}

// Resolve the effective status, applying expiry. Fail-closed: an approval past
// its window is treated as expired even if it was 'approved'.
export function resolveStatus(req: ApprovalRequest, now?: string): ApprovalStatus {
  if (req.status === 'rejected' || req.status === 'blocked') return req.status;
  if (now && now >= req.expires_at) return 'expired';
  return req.status;
}

function relevantShutoffFlag(action: ActionType): ShutoffFlag | null {
  switch (action) {
    case 'send_email':
      return 'DISABLE_EMAIL_SEND';
    case 'calendar_write':
      return 'DISABLE_CALENDAR_WRITES';
    case 'airtable_write':
      return 'DISABLE_AIRTABLE_PROD_WRITES';
    case 'n8n_action':
      return 'DISABLE_N8N_ACTIVATION';
    case 'remote_command':
      return 'DISABLE_REMOTE_RUNNER';
    case 'supabase_write':
      return 'DISABLE_ALL_AI_WRITES';
    default:
      return null; // draft_email
  }
}

// ---- Fail-closed execution guard ----
// Decides whether an approval may execute. Never performs any live I/O.
export function evaluateExecution(
  req: ApprovalRequest,
  opts?: { env?: Env; now?: string },
): ExecutionDecision {
  const env = opts?.env ?? {};
  const now = opts?.now;
  const status = resolveStatus(req, now);
  const base = {
    at: now ?? req.created_at,
    approval_id: req.approval_id,
    task_id: req.packet.task_id,
    action_type: req.packet.action_type,
    risk_class: req.packet.risk_class,
    production_touched: false,
    write_actions_performed: false,
  };
  const block = (reason: string): ExecutionDecision => ({
    allowed: false,
    reason,
    audit: { ...base, event: 'execution_blocked', reason },
  });

  // 1. Missing/invalid owner approval blocks execution.
  if (
    !req.owner_decision ||
    req.owner_decision.decision !== 'approved' ||
    !req.owner_decision.approval_id
  ) {
    return block('no owner approval: execution requires an approved decision');
  }
  // 2. Effective status must be approved (blocks rejected/expired/blocked/pending).
  if (status !== 'approved') {
    return block('approval not executable: status is ' + status);
  }
  // 3. RED and BLACK never execute in Phase 2.
  if (req.packet.risk_class === 'RED' || req.packet.risk_class === 'BLACK') {
    return block('risk class ' + req.packet.risk_class + ' never executes in Phase 2');
  }
  // 4. Production is blocked.
  if (req.packet.environment === 'production') {
    return block('production execution is blocked');
  }
  // 5. Master emergency shutoff (fail-closed: missing/true blocks).
  if (isDisabled('DISABLE_ALL_AI_WRITES', env)) {
    return block('emergency shutoff: DISABLE_ALL_AI_WRITES blocks execution');
  }
  // 6. Action-specific shutoff flag.
  const flag = relevantShutoffFlag(req.packet.action_type);
  if (flag && isDisabled(flag, env)) {
    return block('emergency shutoff: ' + flag + ' blocks this action');
  }
  // 7. Live action types have NO execution path in Phase 2.
  if (LIVE_ACTION_TYPES.includes(req.packet.action_type)) {
    return block(
      'live action ' + req.packet.action_type + ' has no execution path in Phase 2',
    );
  }
  // Only an approved, GREEN/YELLOW, non-live, non-expired draft reaches here.
  return {
    allowed: true,
    reason: 'approved draft may be produced (mock only; no live send/write)',
    audit: { ...base, event: 'executed_mock', reason: 'draft produced (mock only)' },
  };
}

// Execute path. Even when allowed, produces only a MOCK artifact. Never calls
// a live connector - proves sends/writes cannot happen here regardless.
export function executeApproved(
  req: ApprovalRequest,
  opts?: { env?: Env; now?: string },
): { executed: boolean; audit: AuditEvent; result?: string } {
  const decision = evaluateExecution(req, opts);
  if (!decision.allowed) {
    return { executed: false, audit: decision.audit };
  }
  return {
    executed: true,
    audit: decision.audit,
    result: 'MOCK draft artifact for task ' + req.packet.task_id,
  };
}

// ---- Mock seed (D) ----
// A fixed, deterministic set for the UI and tests. No ambient clock.
const SEED_NOW = '2026-07-06T12:00:00.000Z';

function seedRequest(input: {
  task_id: string;
  action_type: ActionType;
  risk_class: RiskClass;
  summary: string;
  environment?: Environment;
  status?: ApprovalStatus;
}): ApprovalRequest {
  const packet = createCommandPacket({
    task_id: input.task_id,
    action_type: input.action_type,
    risk_class: input.risk_class,
    environment: input.environment,
    summary: input.summary,
    now: SEED_NOW,
  });
  const req = createApprovalRequest(packet, { now: SEED_NOW, ttlMinutes: 120 });
  return input.status ? { ...req, status: input.status } : req;
}

export const MOCK_APPROVALS: ApprovalRequest[] = [
  seedRequest({
    task_id: 'draft-lead-reply',
    action_type: 'draft_email',
    risk_class: 'GREEN',
    summary: 'MOCK - draft reply to a lead asking about a window quote',
  }),
  seedRequest({
    task_id: 'calendar-site-measure',
    action_type: 'calendar_write',
    risk_class: 'YELLOW',
    summary: 'MOCK - propose a site-measure calendar event (write, needs approval)',
  }),
  seedRequest({
    task_id: 'airtable-lead-status',
    action_type: 'airtable_write',
    risk_class: 'YELLOW',
    summary: 'MOCK - update a lead status field in Airtable (write, needs approval)',
  }),
  seedRequest({
    task_id: 'send-client-invoice',
    action_type: 'send_email',
    risk_class: 'RED',
    summary: 'MOCK - send an invoice email to a client (RED: blocked in Phase 2)',
  }),
  seedRequest({
    task_id: 'remote-deploy',
    action_type: 'remote_command',
    risk_class: 'BLACK',
    summary: 'MOCK - run a remote deploy command (BLACK: never executed)',
    status: 'blocked',
  }),
];

export function listPendingApprovals(
  seed: ApprovalRequest[] = MOCK_APPROVALS,
  now?: string,
): ApprovalRequest[] {
  return seed.filter((r) => resolveStatus(r, now) === 'pending');
}
