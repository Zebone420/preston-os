// Phase 4 - Deterministic Business Runner: playbook declaration model
// (FINAL MASTER BUILD PLAN v1 sections 2.5 and 9).
//
// Playbooks are versioned TypeScript declarations, NOT a workflow DSL.
// Every declaration names its trigger, required data, allowed capability
// ids, deterministic predicate names, worker use, approval class per
// capability, evidence policy, bounded retries, exception routes and exit
// condition. Validation is fail-closed: a declaration that could propose a
// capability outside its allow-list, or an EXTERNAL/STEP_UP capability
// without an approval class, is rejected before it can ever be registered.
//
// PURE: no I/O, no clock, no randomness. Predicates and capabilities from
// other lanes are referenced by STRING NAME only; nothing here imports or
// executes them.

import { createHash } from 'node:crypto';

export type ApprovalClass = 'INTERNAL' | 'EXTERNAL' | 'STEP_UP';

export const APPROVAL_CLASSES: readonly ApprovalClass[] = [
  'INTERNAL',
  'EXTERNAL',
  'STEP_UP',
];

const CLASS_RANK: Record<ApprovalClass, number> = {
  INTERNAL: 0,
  EXTERNAL: 1,
  STEP_UP: 2,
};

export function approvalRank(c: ApprovalClass): number {
  return CLASS_RANK[c];
}

// The step vocabulary is exactly plan section 2.5. Nothing else exists.
export const STEP_KINDS = [
  'check_clock',
  'check_stage',
  'check_identity',
  'evaluate_gate',
  'render_document',
  'propose_capability',
  'wait_for_event',
  'advance_state',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface PlaybookStep {
  kind: StepKind;
  args: Record<string, unknown>;
}

export type ExceptionRoute = 'block' | 'wait' | 'complete';
export const EXCEPTION_ROUTES: readonly ExceptionRoute[] = [
  'block',
  'wait',
  'complete',
];

export type WorkerUse =
  | { kind: 'none' }
  | { kind: 'claude' | 'codex'; purpose: string };

export type EvidencePolicy = 'every_step' | 'proposals_and_exceptions';

export interface RetryPolicy {
  max: number; // bounded retry count per step (0..10)
  backoff_ms: number; // linear backoff base (0..7d)
}

export interface PlaybookDeclaration {
  id: string;
  version: number;
  trigger: string;
  required_data: string[];
  allowed_capabilities: string[];
  predicates: string[];
  worker_use: WorkerUse;
  approvals: Record<string, ApprovalClass>;
  evidence_policy: EvidencePolicy;
  retries: RetryPolicy;
  exception_routes: Record<string, ExceptionRoute>;
  exit_condition: string;
  steps: PlaybookStep[];
}

// Minimum approval class per known capability id (plan section 10 groups:
// 10.1 read, 10.2 internal derived writes, 10.3 external preparation ->
// INTERNAL; 10.4 external side effects -> EXTERNAL; 10.5 high consequence
// -> STEP_UP). A declaration may raise a class, never lower it. Unknown
// ids have no floor and are rejected (fail closed).
export const CAPABILITY_CLASS_FLOOR: Readonly<Record<string, ApprovalClass>> =
  Object.freeze({
    // 10.1 read
    'gmail.thread.read': 'INTERNAL',
    'gmail.message.search': 'INTERNAL',
    'calendar.availability.read': 'INTERNAL',
    'drive.file.lookup': 'INTERNAL',
    'vendor.quote.parse': 'INTERNAL',
    'iqplus.report.ingest': 'INTERNAL',
    'knowledge.search': 'INTERNAL',
    // 10.2 internal derived writes
    'deal.finding.record': 'INTERNAL',
    'timeline.event.record': 'INTERNAL',
    'document.register': 'INTERNAL',
    'project.match.propose': 'INTERNAL',
    'knowledge.fact.propose': 'INTERNAL',
    'vendor.quote.reconcile': 'INTERNAL',
    'follow_up.clock.arm': 'INTERNAL',
    'follow_up.clock.touch': 'INTERNAL',
    // 10.3 external preparation
    'gmail.message.draft': 'INTERNAL',
    'proposal.document.render': 'INTERNAL',
    'po.document.render': 'INTERNAL',
    'calendar.event.draft': 'INTERNAL',
    'contract.package.render': 'INTERNAL',
    // 10.4 external side effects
    'gmail.message.send': 'EXTERNAL',
    'calendar.event.create': 'EXTERNAL',
    'drive.file.write': 'EXTERNAL',
    'vendor.quote.request.send': 'EXTERNAL',
    'docusign.envelope.send': 'EXTERNAL',
    // 10.5 high consequence / step-up
    'payment.charge': 'STEP_UP',
    'payment.refund': 'STEP_UP',
    'vendor.order.place': 'STEP_UP',
    'production.deploy': 'STEP_UP',
    'database.migrate': 'STEP_UP',
    'autonomy.grant': 'STEP_UP',
    'kill_switch.clear': 'STEP_UP',
  });

// States a playbook may NEVER set itself. Money/legal/order states are
// advanced by the order-chain lane from verified evidence, and won/lost is
// the owner's final call (plan PHASE 4 Follow-up, section 19).
export const FORBIDDEN_ADVANCE_TARGETS: readonly string[] = [
  'contract_signed',
  'deposit_received',
  'ordered',
  'charged',
  'won',
  'lost',
  'closed_lost',
  'closed_won',
];

// Dotted or single-segment (plan section 9 names 'follow_up').
export const PLAYBOOK_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const CAPABILITY_ID_RE = /^[a-z0-9_]+(\.[a-z0-9_]+){1,3}$/;
export const PREDICATE_RE = /^[a-z][a-z0-9_]*([.:][a-z0-9_]+)*$/;

const MAX_STEPS = 64;
const MAX_RETRIES = 10;
const MAX_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;

export interface DeclarationValidation {
  ok: boolean;
  errors: string[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isApprovalClass(v: unknown): v is ApprovalClass {
  return typeof v === 'string' && (APPROVAL_CLASSES as string[]).includes(v);
}

function stepCapabilityId(step: PlaybookStep): string | null {
  if (step.kind !== 'propose_capability' && step.kind !== 'render_document') {
    return null;
  }
  const id = step.args.capability_id;
  return typeof id === 'string' ? id : '';
}

// Fail-closed structural + policy validation of a declaration.
export function validateDeclaration(
  decl: PlaybookDeclaration,
): DeclarationValidation {
  const errors: string[] = [];
  if (typeof decl.id !== 'string' || !PLAYBOOK_ID_RE.test(decl.id)) {
    errors.push('id_invalid');
  }
  if (!Number.isSafeInteger(decl.version) || decl.version < 1) {
    errors.push('version_invalid');
  }
  if (typeof decl.trigger !== 'string' || decl.trigger.trim() === '') {
    errors.push('trigger_missing');
  }
  if (!isStringArray(decl.required_data)) errors.push('required_data_invalid');
  if (!isStringArray(decl.allowed_capabilities)) {
    errors.push('allowed_capabilities_invalid');
  }
  if (!isStringArray(decl.predicates)) errors.push('predicates_invalid');
  if (typeof decl.exit_condition !== 'string' || !decl.exit_condition.trim()) {
    errors.push('exit_condition_missing');
  }
  if (
    decl.evidence_policy !== 'every_step' &&
    decl.evidence_policy !== 'proposals_and_exceptions'
  ) {
    errors.push('evidence_policy_invalid');
  }
  const wu = decl.worker_use;
  if (!wu || typeof wu !== 'object') {
    errors.push('worker_use_invalid');
  } else if (wu.kind === 'none') {
    // ok
  } else if (wu.kind === 'claude' || wu.kind === 'codex') {
    if (typeof wu.purpose !== 'string' || !wu.purpose.trim()) {
      errors.push('worker_use_purpose_missing');
    }
  } else {
    errors.push('worker_use_invalid');
  }
  const r = decl.retries;
  if (
    !r ||
    !Number.isSafeInteger(r.max) ||
    r.max < 0 ||
    r.max > MAX_RETRIES ||
    !Number.isSafeInteger(r.backoff_ms) ||
    r.backoff_ms < 0 ||
    r.backoff_ms > MAX_BACKOFF_MS
  ) {
    errors.push('retries_invalid');
  }
  if (errors.length > 0) return { ok: false, errors };

  const allowed = new Set(decl.allowed_capabilities);
  const predicates = new Set(decl.predicates);
  for (const p of decl.predicates) {
    if (!PREDICATE_RE.test(p)) errors.push(`predicate_name_invalid:${p}`);
  }
  for (const cap of decl.allowed_capabilities) {
    if (!CAPABILITY_ID_RE.test(cap)) {
      errors.push(`capability_id_invalid:${cap}`);
      continue;
    }
    const floor = CAPABILITY_CLASS_FLOOR[cap];
    const declared = decl.approvals[cap];
    if (!floor) {
      errors.push(`capability_unknown:${cap}`);
    }
    if (declared === undefined) {
      errors.push(`approval_class_missing:${cap}`);
    } else if (!isApprovalClass(declared)) {
      errors.push(`approval_class_invalid:${cap}`);
    } else if (floor && approvalRank(declared) < approvalRank(floor)) {
      errors.push(`approval_class_below_floor:${cap}`);
    }
  }
  for (const cap of Object.keys(decl.approvals)) {
    if (!allowed.has(cap)) errors.push(`approval_for_disallowed:${cap}`);
  }
  for (const [name, route] of Object.entries(decl.exception_routes)) {
    if (!PREDICATE_RE.test(name)) errors.push(`route_name_invalid:${name}`);
    if (!(EXCEPTION_ROUTES as string[]).includes(route)) {
      errors.push(`route_invalid:${name}`);
    }
  }

  if (!Array.isArray(decl.steps) || decl.steps.length === 0) {
    errors.push('steps_missing');
  } else if (decl.steps.length > MAX_STEPS) {
    errors.push('steps_too_many');
  } else {
    decl.steps.forEach((step, i) => {
      const at = `steps[${i}]`;
      if (!(STEP_KINDS as readonly string[]).includes(step.kind)) {
        errors.push(`${at}.kind_invalid`);
        return;
      }
      if (!step.args || typeof step.args !== 'object') {
        errors.push(`${at}.args_invalid`);
        return;
      }
      const cap = stepCapabilityId(step);
      if (cap !== null) {
        if (!cap) errors.push(`${at}.capability_id_missing`);
        else if (!allowed.has(cap)) {
          errors.push(`${at}.capability_not_allowed:${cap}`);
        }
      }
      if (step.kind === 'evaluate_gate' || step.kind === 'check_identity') {
        const p = step.args.predicate;
        if (typeof p !== 'string' || !p) {
          errors.push(`${at}.predicate_missing`);
        } else if (!predicates.has(p)) {
          errors.push(`${at}.predicate_undeclared:${p}`);
        }
      }
      if (step.kind === 'check_stage') {
        const any = step.args.any_of;
        if (!isStringArray(any) || any.length === 0) {
          errors.push(`${at}.any_of_missing`);
        }
      }
      if (step.kind === 'check_clock') {
        if (typeof step.args.clock !== 'string' || !step.args.clock) {
          errors.push(`${at}.clock_missing`);
        }
      }
      if (step.kind === 'wait_for_event') {
        if (typeof step.args.event !== 'string' || !step.args.event) {
          errors.push(`${at}.event_missing`);
        }
        const t = step.args.timeout_hours;
        if (t !== undefined && (typeof t !== 'number' || !(t > 0))) {
          errors.push(`${at}.timeout_invalid`);
        }
      }
      if (step.kind === 'advance_state') {
        const to = step.args.to;
        if (typeof to !== 'string' || !to) {
          errors.push(`${at}.to_missing`);
        } else if (FORBIDDEN_ADVANCE_TARGETS.includes(to)) {
          errors.push(`${at}.advance_forbidden:${to}`);
        }
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

// Canonical JSON: keys sorted recursively so semantically identical
// declarations hash identically regardless of construction order.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') +
    '}'
  );
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function declarationHash(decl: PlaybookDeclaration): string {
  return sha256Hex(canonicalJson(decl));
}

// Approval class the runner attaches to a proposal. Fail closed: a
// capability outside the allow-list or without a class yields null and
// the runner blocks instead of proposing.
export function approvalClassFor(
  decl: PlaybookDeclaration,
  capabilityId: string,
): ApprovalClass | null {
  if (!decl.allowed_capabilities.includes(capabilityId)) return null;
  const c = decl.approvals[capabilityId];
  return isApprovalClass(c) ? c : null;
}
