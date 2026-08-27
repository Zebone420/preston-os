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
// Naming: provider.resource.action (e.g. gmail.message.search). This goal
// ships ONLY the internal dry-run provider (preston.dryrun) - no external
// provider is registered, connected, or credentialed.

export type CapabilityRiskClass = 'GREEN' | 'YELLOW' | 'RED' | 'BLACK';

export type CapabilityOperationKind = 'read' | 'write';

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
  },
];

// Frozen name -> definition map. Freezing is structural: a runtime mutation
// attempt throws in strict mode instead of silently widening the registry.
const REGISTRY: ReadonlyMap<string, CapabilityDefinition> = new Map(
  DEFINITIONS.map((d) => [d.name, Object.freeze({ ...d })]),
);

export const CAPABILITY_NAME_RE = /^[a-z0-9_]+(\.[a-z0-9_]+){2,3}$/;

export type CapabilityLookup =
  | { ok: true; definition: CapabilityDefinition }
  | { ok: false; reason: 'capability_name_invalid' | 'unknown_capability' | 'capability_version_mismatch' };

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
