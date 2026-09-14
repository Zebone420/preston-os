// Preston AI OS - internal capability registry (power-station master goal
// section 8). PURE, in-code, versioned. NOT a public plugin SDK and NOT a
// marketplace: every capability Preston can ever invoke is declared HERE, in
// code, reviewed and shipped like any other code change.
//
// Design rules (master goal sections 1/3/8):
//   - ZERO SSOT reads: the registry is a frozen in-process map. An idle
//     orchestrator tick never touches it; a provider-free job never pays for
//     it. It behaves like dormant equipment until a capability job invokes it.
//   - Unknown capabilities FAIL CLOSED: lookup of an unregistered name or a
//     version mismatch is a terminal refusal, never a retry.
//   - Risk classification reuses the EXISTING Preston taxonomy
//     (GREEN/YELLOW/RED/BLACK) - no parallel security authority.
//   - No provider adapter lives here. Definitions describe the contract; the
//     trusted executor (executor.ts) binds an adapter at invocation time and
//     refuses when none is installed.
//
// Naming: provider.resource.action (e.g. gmail.message.search).
//
// Phase 3 (2026-09-08, Safe Business Capability Foundation): the business
// capability set (business/definitions.ts) is registered alongside the
// dry-run provider. EVERY business provider is a SANDBOX adapter
// (providers/*-sandbox.ts): it validates, renders a canonical payload,
// records the ledger row, and returns provider_state 'sandbox_only'. No
// external provider is connected or credentialed; the real provider path is
// a later owner-gated activation. gmail.message.send is registered but
// enabled:false (disabled_reason 'owner_gate_not_opened') and the executor
// refuses it before any adapter step.

import { BUSINESS_DEFINITIONS } from './business/definitions';

export type CapabilityRiskClass = 'GREEN' | 'YELLOW' | 'RED' | 'BLACK';

export type CapabilityOperationKind = 'read' | 'write';

// Approval class (master build plan section 11):
//   INTERNAL - company-internal derived state only (no approval record)
//   EXTERNAL - something leaves Preston (owner approval, hash-bound)
//   STEP_UP  - money/legal/order/authority (stronger owner authentication;
//              no STEP_UP capability ships in Phase 3)
export type ApprovalClass = 'INTERNAL' | 'EXTERNAL' | 'STEP_UP';

// Field-level approval binding derived from a validated payload. The
// approval record must bind these (business/stale-approval.ts) in addition
// to the whole-payload hash: a stale payload is a stale approval.
export interface ApprovalBindingFields {
  project_id: string | null;
  document_hash: string | null; // document/version hash where applicable
  amount: number | null; // integer cents where applicable
  recipient: string | null; // sorted, comma-joined recipients
}

// Deterministic per-capability parameter validation (schema + business
// policy). Runs in the trusted executor BEFORE the ledger and BEFORE any
// adapter; a refusal is terminal with a static reason and touches nothing.
export type ParamsValidation =
  | { ok: true; canonical: Record<string, unknown>; binding: ApprovalBindingFields }
  | { ok: false; reason: string };

export type ParamsValidator = (params: Record<string, unknown>) => ParamsValidation;

export type IdempotencyStrategy =
  // The side-effect ledger's idempotency_key + CAS claim is the guard (the
  // default for every write; reads may use it for dedup bookkeeping too).
  | 'ledger_key'
  // The provider itself accepts an idempotency token (future providers).
  | 'provider_token';

export interface CapabilityDefinition {
  name: string; // provider.resource.action
  version: number; // bumped on any contract change; requests pin it
  provider: string; // registry segment before the first dot
  operation_kind: CapabilityOperationKind;
  risk_class: CapabilityRiskClass; // existing Preston taxonomy, reused as-is
  requires_approval: boolean; // owner approval gate (RED/BLACK always gate)
  target_scope: string; // human-readable bound of what it may touch
  timeout_ms: number; // hard adapter timeout
  idempotency_strategy: IdempotencyStrategy;
  dry_run_supported: boolean;
  artifact_input: boolean; // may consume stored artifacts (future)
  artifact_output: boolean; // may produce stored artifacts (future)
  // Phase 3 contract fields (master build plan section 10: schema,
  // provenance, actor, policy, approval class, validation, idempotency,
  // side-effect key, evidence, failure behavior).
  approval_class: ApprovalClass;
  enabled: boolean; // false => executor refuses before any adapter step
  disabled_reason: string | null; // static reason when enabled is false
  provenance: string; // who may originate the request
  actor: string; // who performs it (always the trusted executor)
  side_effect_key: string; // how the idempotency key is composed
  evidence: string; // what the ledger/evidence records
  failure_behavior: string; // static failure semantics
  validate_params: ParamsValidator | null; // null => no per-capability schema
}

// The dry-run provider (master goal section 15): a local, internal test
// provider that exercises the ENTIRE capability spine - registry lookup,
// policy classification, approval gate, trusted executor, side-effect
// ledger, idempotency, every outcome class, reconciliation - with NO
// external side effect. Its "write" writes nothing outside the ledger row
// it is recorded in; the adapter is pure in-process code.
export const DRYRUN_WRITE_TEST = 'preston.echo.write_test';
export const DRYRUN_READ_TEST = 'preston.echo.read_test';

const DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    name: DRYRUN_WRITE_TEST,
    version: 1,
    provider: 'preston.dryrun',
    operation_kind: 'write',
    // YELLOW + approval: deliberately exercises the approval gate so the
    // drill proves the gate, not just the happy path.
    risk_class: 'YELLOW',
    requires_approval: true,
    target_scope: 'internal echo only; no external system is touched',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: false,
    artifact_output: false,
    approval_class: 'INTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'dispatcher capability-dryrun drill (env-gated)',
    actor: 'trusted executor',
    side_effect_key: 'caller idempotency_key (drill key)',
    evidence: 'side_effects row + SideEffectRecorded event',
    failure_behavior: 'params.outcome selects terminal/retryable/uncertain',
    validate_params: null,
  },
  {
    name: DRYRUN_READ_TEST,
    version: 1,
    provider: 'preston.dryrun',
    operation_kind: 'read',
    risk_class: 'GREEN',
    requires_approval: false,
    target_scope: 'internal echo only; no external system is touched',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: false,
    artifact_output: false,
    approval_class: 'INTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'dispatcher capability-dryrun drill (env-gated)',
    actor: 'trusted executor',
    side_effect_key: 'caller idempotency_key (drill key)',
    evidence: 'side_effects row + SideEffectRecorded event',
    failure_behavior: 'params.outcome selects terminal/retryable/uncertain',
    validate_params: null,
  },
  ...BUSINESS_DEFINITIONS,
];

// Frozen name -> definition map. Freezing is structural: a runtime mutation
// attempt throws in strict mode instead of silently widening the registry.
const REGISTRY: ReadonlyMap<string, CapabilityDefinition> = new Map(
  DEFINITIONS.map((d) => [d.name, Object.freeze({ ...d })]),
);

export const CAPABILITY_NAME_RE = /^[a-z0-9_]+(\.[a-z0-9_]+){2,3}$/;

export type CapabilityLookup =
  | { ok: true; definition: CapabilityDefinition }
  | { ok: false; reason:
      | 'capability_name_invalid' | 'unknown_capability' | 'capability_version_mismatch' };

// The ONLY lookup path. Unknown name / malformed name / version mismatch all
// fail closed with a static reason the outcome authority rules TERMINAL.
export function lookupCapability(
  name: string,
  version: number,
): CapabilityLookup {
  const n = String(name ?? '').trim();
  if (!CAPABILITY_NAME_RE.test(n)) {
    return { ok: false, reason: 'capability_name_invalid' };
  }
  const def = REGISTRY.get(n);
  if (!def) return { ok: false, reason: 'unknown_capability' };
  if (def.version !== version) {
    return { ok: false, reason: 'capability_version_mismatch' };
  }
  return { ok: true, definition: def };
}

export function listCapabilities(): CapabilityDefinition[] {
  return [...REGISTRY.values()];
}
