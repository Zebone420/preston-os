import type { RiskClass } from './types';
import type { CommandPacket } from './commands';
import type { Job } from './queue';
import { validateBaseRef, validateWorktreePath } from './worktree';

// Preston AI OS - shared multi-agent job envelope (Phase 5J orchestration). PURE.
// The envelope is the ONE contract every orchestrated staging job must satisfy
// before Hermes/dispatcher code (owned elsewhere) may act on it. It is strictly
// additive on top of CommandPacket + Job: it never replaces either. Fail-closed
// throughout - construction always goes through validateJobEnvelope; there is
// no way to obtain a JobEnvelope value without passing validation.
//
// Hard invariants enforced here (never relaxed by a caller):
//   - environment is always the literal 'staging'.
//   - execution, push, deploy are always the literal false.
//   - risk_class is never RED or BLACK.
//   - assigned_implementer and assigned_reviewer are always different actors.
//   - allowed_operations is a bounded allowlist - no shell/exec/network verbs.
//   - prohibited_operations always names the baseline: push, deploy,
//     production_access, secret_access, network_egress.
//   - worktree_path always resolves under /srv/worktrees, no traversal.
//   - no field anywhere may contain secret-shaped text.

export type EnvelopeSource =
  | 'chatgpt'
  | 'telegram'
  | 'dashboard'
  | 'owner_cli'
  | 'claude'
  | 'codex'
  | 'hermes'
  | 'scheduler';

const SOURCES: readonly EnvelopeSource[] = [
  'chatgpt', 'telegram', 'dashboard', 'owner_cli', 'claude', 'codex', 'hermes', 'scheduler',
];

// Reused verbatim from commands.ts's secret-detection stance (kept local so
// this module has no hidden coupling to another agent's file beyond the
// read-only type imports above).
const SECRET_TEXT =
  /(secret|password|passwd|\bpat\b|api[_-]?key|client[_-]?secret|private[_-]?key|refresh[_-]?token|bearer\s|ssh-rsa|-----begin)/i;

function hasSecretText(...parts: string[]): boolean {
  return parts.some((p) => typeof p === 'string' && SECRET_TEXT.test(p));
}

// Bounded operation allowlist. Deliberately excludes any shell/exec/network
// verb - staging jobs may read, edit, and validate; they may never run
// arbitrary commands or reach the network.
export const ALLOWED_OPERATIONS = [
  'read_repo',
  'edit_docs',
  'edit_code',
  'run_tests',
  'run_lint',
  'run_build',
  'secret_scan',
  'boundary_scan',
] as const;
export type AllowedOperation = (typeof ALLOWED_OPERATIONS)[number];
const ALLOWED_OPERATIONS_SET: ReadonlySet<string> = new Set(ALLOWED_OPERATIONS);

// Baseline prohibitions every envelope must declare. Additional prohibitions
// may be appended, but these five may never be omitted.
export const REQUIRED_PROHIBITED_OPERATIONS = [
  'push',
  'deploy',
  'production_access',
  'secret_access',
  'network_egress',
] as const;

// Reject any operation string carrying shell metacharacters, even if it
// otherwise matches the allowlist by coincidence of substring - defense in
// depth against a mutated/concatenated operation string.
const SHELL_METACHARS = /[;&|`$(){}<>\\\n]|(\.\.\/)|(^-)/;

// base_branch/base_commit/worktree_path shape checks are delegated to the
// shared worktree.ts validators (validateBaseRef, validateWorktreePath) so
// this module can never drift from the stricter, single-source rules used
// to actually prepare a worktree (reject leading '-', '..', leading-dot
// segments, enforce lowercase 40-hex, length caps).

export type ApprovalState = 'pending_owner' | 'owner_approved' | 'owner_rejected';

export interface JobEnvelope {
  correlation_id: string;
  command_packet_id: string;
  job_id: string;
  environment: 'staging';
  requested_by: string;
  source: EnvelopeSource;
  title: string;
  objective: string;
  scope: string;
  constraints: string[];
  risk_class: RiskClass;
  allowed_operations: AllowedOperation[];
  prohibited_operations: string[];
  base_branch: string;
  base_commit: string; // 40-hex git sha
  worktree_path: string; // must be under /srv/worktrees
  assigned_implementer: 'claude';
  assigned_reviewer: 'codex';
  required_tests: string[];
  required_evidence: string[];
  checkpoint_state: string;
  approval_state: ApprovalState;
  execution: false;
  push: false;
  deploy: false;
  created_at: string; // ISO
  updated_at: string; // ISO
  audit_refs: string[];
}

export interface EnvelopeValidationOk {
  ok: true;
  envelope: JobEnvelope;
}
export interface EnvelopeValidationFail {
  ok: false;
  errors: string[];
}
export type EnvelopeValidation = EnvelopeValidationOk | EnvelopeValidationFail;

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

// Every key a JobEnvelope may legally carry. Any input key outside this set
// is an unknown-key rejection (strict object shape - no arbitrary fields, in
// particular no shell-command-shaped fields can ever hide in "extras").
const ENVELOPE_KEYS: ReadonlySet<string> = new Set<keyof JobEnvelope>([
  'correlation_id',
  'command_packet_id',
  'job_id',
  'environment',
  'requested_by',
  'source',
  'title',
  'objective',
  'scope',
  'constraints',
  'risk_class',
  'allowed_operations',
  'prohibited_operations',
  'base_branch',
  'base_commit',
  'worktree_path',
  'assigned_implementer',
  'assigned_reviewer',
  'required_tests',
  'required_evidence',
  'checkpoint_state',
  'approval_state',
  'execution',
  'push',
  'deploy',
  'created_at',
  'updated_at',
  'audit_refs',
]);

// Strict, fail-closed validator. Accepts unknown input (e.g. a parsed JSON
// payload from any source) and either returns a fully-typed, invariant-safe
// JobEnvelope or a non-empty list of reasons. There is deliberately no partial
// success: any single violation rejects the whole envelope.
export function validateJobEnvelope(input: unknown): EnvelopeValidation {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['envelope must be a non-null object'] };
  }
  const o = input as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (!ENVELOPE_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }

  if (!isNonEmptyString(o.correlation_id)) errors.push('correlation_id required');
  if (!isNonEmptyString(o.command_packet_id)) errors.push('command_packet_id required');
  if (!isNonEmptyString(o.job_id)) errors.push('job_id required');

  if (o.environment !== 'staging') errors.push("environment must be 'staging'");

  if (!isNonEmptyString(o.requested_by)) errors.push('requested_by required');

  if (!isString(o.source) || !SOURCES.includes(o.source as EnvelopeSource)) {
    errors.push('invalid source');
  }

  if (!isNonEmptyString(o.title)) errors.push('title required');
  if (!isNonEmptyString(o.objective)) errors.push('objective required');
  if (!isNonEmptyString(o.scope)) errors.push('scope required');

  if (!isStringArray(o.constraints)) errors.push('constraints must be a string array');

  const RISK: readonly RiskClass[] = ['GREEN', 'YELLOW', 'RED', 'BLACK'];
  if (!isString(o.risk_class) || !RISK.includes(o.risk_class as RiskClass)) {
    errors.push('invalid risk_class');
  } else if (o.risk_class === 'RED' || o.risk_class === 'BLACK') {
    errors.push('risk_class RED/BLACK never permitted in an orchestration envelope');
  }

  if (!isStringArray(o.allowed_operations)) {
    errors.push('allowed_operations must be a string array');
  } else {
    for (const op of o.allowed_operations) {
      if (SHELL_METACHARS.test(op)) errors.push(`allowed_operations contains shell metacharacters: ${op}`);
      else if (!ALLOWED_OPERATIONS_SET.has(op)) errors.push(`unknown allowed_operation: ${op}`);
    }
  }

  if (!isStringArray(o.prohibited_operations)) {
    errors.push('prohibited_operations must be a string array');
  } else {
    for (const op of o.prohibited_operations) {
      if (SHELL_METACHARS.test(op)) errors.push(`prohibited_operations contains shell metacharacters: ${op}`);
    }
    for (const required of REQUIRED_PROHIBITED_OPERATIONS) {
      if (!o.prohibited_operations.includes(required)) {
        errors.push(`prohibited_operations missing required baseline entry: ${required}`);
      }
    }
  }

  {
    const branchInput = isString(o.base_branch) ? o.base_branch : '';
    const commitInput = isString(o.base_commit) ? o.base_commit : '';
    const refCheck = validateBaseRef(branchInput, commitInput);
    if (!refCheck.ok) {
      if (refCheck.reason && refCheck.reason.startsWith('commit')) {
        errors.push('base_commit must be a 40-character hex git sha');
      } else {
        errors.push('invalid base_branch: ' + refCheck.reason);
      }
    }
  }

  if (!isString(o.worktree_path)) {
    errors.push('worktree_path must match /srv/worktrees/<name> with no traversal');
  } else {
    const pathCheck = validateWorktreePath(o.worktree_path);
    if (!pathCheck.ok) {
      errors.push('invalid worktree_path: ' + pathCheck.reason);
    }
  }

  if (o.assigned_implementer !== 'claude') errors.push("assigned_implementer must be 'claude'");
  if (o.assigned_reviewer !== 'codex') errors.push("assigned_reviewer must be 'codex'");
  if (
    isString(o.assigned_implementer) &&
    isString(o.assigned_reviewer) &&
    o.assigned_implementer === o.assigned_reviewer
  ) {
    errors.push('assigned_implementer and assigned_reviewer must differ');
  }

  if (!isStringArray(o.required_tests)) errors.push('required_tests must be a string array');
  if (!isStringArray(o.required_evidence)) errors.push('required_evidence must be a string array');

  if (!isNonEmptyString(o.checkpoint_state)) errors.push('checkpoint_state required');

  const APPROVAL_STATES: readonly ApprovalState[] = ['pending_owner', 'owner_approved', 'owner_rejected'];
  if (!isString(o.approval_state) || !APPROVAL_STATES.includes(o.approval_state as ApprovalState)) {
    errors.push('invalid approval_state');
  }

  if (o.execution !== false) errors.push('execution must be false');
  if (o.push !== false) errors.push('push must be false');
  if (o.deploy !== false) errors.push('deploy must be false');

  if (!isIsoTimestamp(o.created_at)) errors.push('created_at must be an ISO timestamp');
  if (!isIsoTimestamp(o.updated_at)) errors.push('updated_at must be an ISO timestamp');

  if (!isStringArray(o.audit_refs)) errors.push('audit_refs must be a string array');

  // Secret-shaped text may not appear ANYWHERE in the FREE-TEXT surface of the
  // envelope, including nested string-array fields. allowed_operations and
  // prohibited_operations are deliberately excluded from this scan: they are
  // bounded, fixed-vocabulary fields checked against their own allowlists
  // above (e.g. the required baseline includes the literal 'secret_access',
  // which is a vocabulary token, not free text, and must not self-reject).
  const secretCandidates: string[] = [
    isString(o.correlation_id) ? o.correlation_id : '',
    isString(o.command_packet_id) ? o.command_packet_id : '',
    isString(o.job_id) ? o.job_id : '',
    isString(o.requested_by) ? o.requested_by : '',
    isString(o.title) ? o.title : '',
    isString(o.objective) ? o.objective : '',
    isString(o.scope) ? o.scope : '',
    isString(o.base_branch) ? o.base_branch : '',
    isString(o.base_commit) ? o.base_commit : '',
    isString(o.worktree_path) ? o.worktree_path : '',
    isString(o.checkpoint_state) ? o.checkpoint_state : '',
    ...(isStringArray(o.constraints) ? o.constraints : []),
    ...(isStringArray(o.required_tests) ? o.required_tests : []),
    ...(isStringArray(o.required_evidence) ? o.required_evidence : []),
    ...(isStringArray(o.audit_refs) ? o.audit_refs : []),
  ];
  if (hasSecretText(...secretCandidates)) {
    errors.push('secret-shaped text rejected from job envelope');
  }

  if (errors.length > 0) return { ok: false, errors };

  // Every field has now been shape- and invariant-checked above; the cast is
  // the single, deliberate seam between "validated unknown" and JobEnvelope.
  return { ok: true, envelope: o as unknown as JobEnvelope };
}

export interface EnvelopeExtras {
  environment: 'staging';
  title: string;
  objective: string;
  scope: string;
  allowed_operations: string[];
  prohibited_operations: string[];
  base_branch: string;
  base_commit: string;
  worktree_path: string;
  assigned_implementer: string;
  assigned_reviewer: string;
  required_tests: string[];
  required_evidence: string[];
  checkpoint_state: string;
  approval_state: ApprovalState;
  created_at: string;
  updated_at: string;
  audit_refs: string[];
}

// Build an envelope from an existing CommandPacket + Job, plus the
// orchestration-only extras neither of those types carry. Never returns an
// unvalidated JobEnvelope - the assembled candidate is always run through
// validateJobEnvelope, and this function returns exactly that result.
export function envelopeFromPacketAndJob(
  packet: CommandPacket,
  job: Job,
  extras: EnvelopeExtras,
): EnvelopeValidation {
  const candidate = {
    correlation_id: job.correlation_id,
    command_packet_id: packet.id,
    job_id: job.id,
    environment: extras.environment,
    requested_by: packet.actor,
    source: packet.source,
    title: extras.title,
    objective: extras.objective,
    scope: extras.scope,
    constraints: packet.constraints,
    risk_class: job.risk_class,
    allowed_operations: extras.allowed_operations,
    prohibited_operations: extras.prohibited_operations,
    base_branch: extras.base_branch,
    base_commit: extras.base_commit,
    worktree_path: extras.worktree_path,
    assigned_implementer: extras.assigned_implementer,
    assigned_reviewer: extras.assigned_reviewer,
    required_tests: extras.required_tests,
    required_evidence: extras.required_evidence,
    checkpoint_state: extras.checkpoint_state,
    approval_state: extras.approval_state,
    execution: false as const,
    push: false as const,
    deploy: false as const,
    created_at: extras.created_at,
    updated_at: extras.updated_at,
    audit_refs: extras.audit_refs,
  };
  return validateJobEnvelope(candidate);
}
