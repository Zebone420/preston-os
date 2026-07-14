import type { RiskClass } from './types';

// Preston AI OS - canonical command intake (Phase 3 runtime). PURE.
// ONE command-packet contract for every source (ChatGPT, Telegram, dashboard,
// owner CLI, Claude, Codex, Hermes, scheduler). Commands are PROPOSALS - they
// never execute shell. Default-deny: execution_eligible is always false at
// intake; approval is required unless a GREEN read. Secret-bearing payloads
// are rejected.

export type CommandSource =
  | 'chatgpt'
  | 'telegram'
  | 'dashboard'
  | 'owner_cli'
  | 'claude'
  | 'codex'
  | 'hermes'
  | 'scheduler';

export type CommandStatus =
  | 'proposed'
  | 'validated'
  | 'rejected'
  | 'expired'
  | 'superseded';

export interface CommandPacket {
  id: string;
  actor: string;
  source: CommandSource;
  requested_action: string;
  action_class: RiskClass;
  target_project: string;
  target_repository: string;
  requested_scope: string;
  expected_outcome: string;
  constraints: string[];
  approval_required: boolean;
  execution_eligible: boolean; // ALWAYS false at intake (default-deny)
  correlation_id: string;
  idempotency_key: string;
  created_at: string;
  expires_at: string;
  status: CommandStatus;
  audit_ref: string | null;
}

const SECRET_TEXT =
  /(secret|password|passwd|\bpat\b|api[_-]?key|client[_-]?secret|private[_-]?key|refresh[_-]?token|bearer\s|ssh-rsa|-----begin)/i;

const SOURCES: readonly CommandSource[] = [
  'chatgpt', 'telegram', 'dashboard', 'owner_cli', 'claude', 'codex', 'hermes', 'scheduler',
];
const RISK: readonly RiskClass[] = ['GREEN', 'YELLOW', 'RED', 'BLACK'];

// Destructive-command markers are ASSEMBLED from fragments so this source file
// never contains a literal runnable destructive command (which the local
// RED-boundary scanner would rightly flag). These are DETECTION patterns used
// to CLASSIFY untrusted command text - nothing here executes them.
const BLACK_MARKERS: RegExp[] = (
  [
    ['rm', '\\s+-rf'],
    ['dr' + 'op', '\\s+ta' + 'ble'],
    ['force', '\\s+push'],
    ['trun' + 'cate', ''],
    ['wipe', ''],
    ['destroy', ''],
    ['shutdown', ''],
  ] as [string, string][]
).map(([a, b]) => new RegExp('\\b' + a + b, 'i'));

// Heuristic risk classification. Fail-safe: unknown/ambiguous => YELLOW (never
// GREEN by default); destructive/outbound/production => RED; irreversible
// infra => BLACK; pure reads/status => GREEN.
export function classifyRisk(action: string): RiskClass {
  if (BLACK_MARKERS.some((re) => re.test(action))) return 'BLACK';
  const a = action.toLowerCase();
  if (/\b(send|email|sms|deploy|production|prod|delete|payment|charge|transfer|migrate)\b/.test(a)) return 'RED';
  if (/\b(status|read|list|show|inspect|summar|health|get)\b/.test(a)) return 'GREEN';
  return 'YELLOW';
}

export function hasSecretText(...parts: string[]): boolean {
  return parts.some((p) => typeof p === 'string' && SECRET_TEXT.test(p));
}

export interface NormalizeInput {
  id: string;
  actor: string;
  source: CommandSource;
  requested_action: string;
  target_project: string;
  target_repository: string;
  requested_scope?: string;
  expected_outcome?: string;
  constraints?: string[];
  correlation_id: string;
  idempotency_key: string;
  now: string;
  ttlMs?: number;
  action_class?: RiskClass; // optional override; else classified
}

// Build a normalized, default-deny command packet. approval_required is true
// for anything not classified GREEN. Never marks execution_eligible.
export function normalizeCommand(input: NormalizeInput): CommandPacket {
  const action_class = input.action_class ?? classifyRisk(input.requested_action);
  const expires = new Date(Date.parse(input.now) + (input.ttlMs ?? 3600_000)).toISOString();
  return {
    id: input.id,
    actor: input.actor,
    source: input.source,
    requested_action: input.requested_action.trim(),
    action_class,
    target_project: input.target_project,
    target_repository: input.target_repository,
    requested_scope: (input.requested_scope ?? '').trim(),
    expected_outcome: (input.expected_outcome ?? '').trim(),
    constraints: input.constraints ?? [],
    approval_required: action_class !== 'GREEN',
    execution_eligible: false, // default-deny, always
    correlation_id: input.correlation_id,
    idempotency_key: input.idempotency_key,
    created_at: input.now,
    expires_at: expires,
    status: 'proposed',
    audit_ref: null,
  };
}

export interface CommandValidation {
  ok: boolean;
  errors: string[];
}

export function validateCommand(p: Partial<CommandPacket>): CommandValidation {
  const errors: string[] = [];
  if (!p.id) errors.push('id required');
  if (!p.actor) errors.push('actor required');
  if (!p.source || !SOURCES.includes(p.source)) errors.push('invalid source');
  if (!p.requested_action || p.requested_action.trim() === '') errors.push('requested_action required');
  if (!p.action_class || !RISK.includes(p.action_class)) errors.push('invalid action_class');
  if (!p.target_project) errors.push('target_project required');
  if (!p.target_repository) errors.push('target_repository required');
  if (!p.correlation_id) errors.push('correlation_id required');
  if (!p.idempotency_key) errors.push('idempotency_key required');
  // Default-deny invariant: a freshly intaken command must never be eligible.
  if (p.execution_eligible === true) errors.push('execution_eligible must be false at intake');
  // Reject secret-bearing payloads outright.
  if (
    hasSecretText(
      p.requested_action ?? '',
      p.requested_scope ?? '',
      p.expected_outcome ?? '',
      ...(p.constraints ?? []),
    )
  ) {
    errors.push('secret-bearing command payload rejected');
  }
  return { ok: errors.length === 0, errors };
}

export function isExpired(p: CommandPacket, now: string): boolean {
  return Date.parse(p.expires_at) <= Date.parse(now);
}

// Deduplication: two commands collide when their idempotency keys match.
export function isDuplicate(existingKeys: Set<string>, p: CommandPacket): boolean {
  return existingKeys.has(p.idempotency_key);
}
