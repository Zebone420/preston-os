// Preston AI OS - capability request/result contract (power-station master
// goal section 9). PURE (no I/O). The typed boundary between a bounded
// worker's PROPOSAL and the trusted executor's ACTION:
//
//   worker (Claude/Codex)  --CapabilityRequest-->  trusted executor
//   trusted executor       --CapabilityResult-->   worker / evidence
//
// Workers never call providers and never hold provider credentials; they
// only produce these typed requests. Every executor error maps into exactly
// one of terminal / retryable / uncertain, and those feed the SAME central
// outcome authority (orchestration/outcomes.ts) used by ordinary jobs - no
// second retry engine (master goal sections 2/9/20).

import { createHash } from 'node:crypto';
import { canonicalActionHash } from '../orchestration/crypto-binding';
import type { ActionEnvelope } from '../orchestration/crypto-binding';
import { deploymentEnvironment } from '../runtime-environment';
import type { CapabilityDefinition } from './registry';

export type CapabilityErrorClass = 'terminal' | 'retryable' | 'uncertain';

export interface CapabilityRequest {
  capability: string; // provider.resource.action
  version: number; // must equal the registered definition's version
  target: string; // WHAT the action touches (recorded + approval-bound)
  params: Record<string, unknown>; // provider params; NEVER secrets
  goal_id: string;
  job_id: string;
  run_id: string;
  request_id: string; // caller correlation id
  idempotency_key: string; // ledger uniqueness key (dedup authority)
  // Reference to an owner approval record when the capability is gated.
  // NEVER an authorization by itself: the executor verifies the record
  // authoritatively (approved, owner-bound, hash-bound, non-expired).
  approval_id?: string | null;
}

export interface CapabilityError {
  error_class: CapabilityErrorClass;
  reason: string; // static reason code, never provider free text
}

export interface CapabilityResult {
  ok: boolean;
  side_effect_id: string;
  provider_result_id: string | null;
  summary: string; // bounded, secret-screened
  artifact_refs: string[];
  error: CapabilityError | null;
}

// Map an executor/adapter error class onto the job failure_reason prefix the
// central outcome authority classifies. terminal -> TERMINAL (dead-letter,
// attempt 1); retryable -> RETRYABLE (existing bounded retry); uncertain ->
// UNCERTAIN (parks; never blind-retried; ledger reconciliation settles it).
export function toJobFailureReason(e: CapabilityError): string {
  if (e.error_class === 'uncertain') return `side_effect_uncertain:${e.reason}`;
  if (e.error_class === 'terminal') return `prohibited_action:${e.reason}`;
  return `capability_retryable:${e.reason}`;
}

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_PARAMS_CHARS = 8_000;

export type RequestValidation =
  | { ok: true; canonical_params: string; payload_hash: string }
  | { ok: false; reason: string };

// Canonical JSON: keys sorted recursively so the payload hash is stable for
// semantically identical params regardless of construction order.
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

export function payloadHash(params: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(params), 'utf8').digest('hex');
}

// Fail-closed structural validation of a request AGAINST its definition.
// Contract-invalid work terminalizes immediately (master goal section 2).
export function validateCapabilityRequest(
  req: CapabilityRequest,
): RequestValidation {
  for (const [field, val] of [
    ['goal_id', req.goal_id], ['job_id', req.job_id], ['run_id', req.run_id],
    ['request_id', req.request_id], ['idempotency_key', req.idempotency_key],
  ] as const) {
    if (typeof val !== 'string' || !ID_RE.test(val)) {
      return { ok: false, reason: `invalid_${field}` };
    }
  }
  const target = String(req.target ?? '').trim();
  if (!target || target.length > 300) {
    return { ok: false, reason: 'invalid_target' };
  }
  if (!req.params || typeof req.params !== 'object' || Array.isArray(req.params)) {
    return { ok: false, reason: 'invalid_params' };
  }
  const canonical = canonicalJson(req.params);
  if (canonical.length > MAX_PARAMS_CHARS) {
    return { ok: false, reason: 'params_too_large' };
  }
  return { ok: true, canonical_params: canonical, payload_hash: payloadHash(req.params) };
}

// Deterministic side-effect id: the SAME idempotency key always yields the
// SAME ledger row id, so a worker retry, an orchestrator restart, or a
// duplicate request converge on one row (idempotency acceptance A/C/D).
export function deriveSideEffectId(idempotencyKey: string): string {
  const h = createHash('sha256').update(String(idempotencyKey), 'utf8').digest('hex');
  return `se-${h.slice(0, 32)}`;
}

// Canonical approval envelope for an approval-gated side effect. Reuses the
// EXISTING Phase 7 canonical SHA-256 binding (no parallel crypto authority):
// capability name, payload hash, target, provider, risk, owner and validity
// window are each bound independently, so a swapped payload or capability can
// never inherit an old approval.
export function sideEffectApprovalEnvelope(args: {
  approval_id: string;
  definition: CapabilityDefinition;
  side_effect_id: string;
  target: string;
  payload_hash: string;
  owner_identity: string;
  created_at: string;
  expires_at: string;
}): ActionEnvelope {
  return {
    approval_id: args.approval_id,
    action: `${args.definition.name}: ${args.target}`,
    affected_resource: `side_effect:${args.side_effect_id}`,
    environment: deploymentEnvironment(),
    owner_identity: args.owner_identity,
    risk_class: args.definition.risk_class,
    created_at: args.created_at,
    expires_at: args.expires_at,
    job_kind: args.definition.name,
    job_objective: args.payload_hash,
    job_title: args.target,
    assigned_role: args.definition.provider,
  };
}

export function sideEffectApprovalHash(
  args: Parameters<typeof sideEffectApprovalEnvelope>[0],
): string {
  return canonicalActionHash(sideEffectApprovalEnvelope(args));
}
