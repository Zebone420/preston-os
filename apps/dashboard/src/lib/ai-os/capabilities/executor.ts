// Preston AI OS - TRUSTED capability executor (power-station master goal
// sections 10/12). The ONLY component that may perform a provider side
// effect. Workers (Claude/Codex) PROPOSE typed CapabilityRequests; this
// executor verifies, classifies, gates, claims the idempotency ledger, and
// only then invokes the provider adapter. Workers never see provider
// credentials, never call providers, and cannot skip any step here.
//
//   CLAUDE / CODEX
//         | structured CapabilityRequest
//         v
//   TRUSTED EXECUTOR (this file)
//         |- validate contract          (invalid  -> terminal, no retry)
//         |- registry lookup            (unknown  -> terminal, fail closed)
//         |- ledger propose (idempotent)(dup done -> replay stored outcome)
//         |- policy classification      (BLACK    -> refused)
//         |- approval verification     (gated + unverified -> refused)
//         |- CAS claim                  (one executing claimant, ever)
//         |- adapter execution          (bounded by definition timeout)
//         `- settle + os_events record
//
// Outcome mapping feeds the SAME central authority as ordinary jobs
// (orchestration/outcomes.ts via contract.toJobFailureReason):
//   terminal  -> dead-letter on attempt 1 (no retry storm)
//   retryable -> the EXISTING bounded retry (no second retry engine)
//   uncertain -> parks; ONLY reconciliation settles it (never blind retry)
//
// Failure isolation (master goal section 16): this module is imported by
// nothing on the orchestrator tick path. A broken ledger refuses safely
// (nothing external ran); a missing adapter refuses; provider-free jobs
// never reach any code in this file.

import type { RuntimeClient } from '../store';
import { insertEvent } from '../store';
import { makeEnvelope } from '../transport';
import {
  deriveSideEffectId,
  sideEffectApprovalHash,
  toJobFailureReason,
  validateCapabilityRequest,
  type CapabilityError,
  type CapabilityRequest,
  type CapabilityResult,
} from './contract';
import { lookupCapability, type CapabilityDefinition } from './registry';
import {
  authorizeSideEffect,
  claimSideEffect,
  insertSideEffectProposal,
  markSideEffectUncertain,
  readSideEffect,
  refuseSideEffect,
  requeueSideEffectRetryable,
  settleSideEffectSuccess,
  settleSideEffectTerminal,
} from './ledger-store';
import { deploymentEnvironment } from '../runtime-environment';

// Durable attempt cap for one side-effect row (aligned with the job retry
// budget; the ledger's attempt_count survives restarts so the cap is real).
export const MAX_SIDE_EFFECT_ATTEMPTS = 3;

export type AdapterOutcome =
  | { status: 'ok'; provider_result_id: string | null; summary: string;
      artifact_refs?: string[] }
  | { status: 'terminal' | 'retryable' | 'uncertain'; reason: string };

// A provider adapter performs EXACTLY ONE already-authorized, already-
// claimed action. It resolves its own credentials through the broker it was
// constructed with (credentials.ts) - the executor and the ledger never
// touch credential material.
export interface CapabilityAdapter {
  execute(input: {
    definition: CapabilityDefinition;
    request: CapabilityRequest;
    payload_hash: string;
    attempt: number;
  }): Promise<AdapterOutcome>;
}

export interface CapabilityExecutorDeps {
  client: RuntimeClient;
  // Static provider -> adapter binding, composed by the caller. Absent
  // provider => terminal refusal (fail closed). Idle/provider-free paths
  // simply never construct these deps.
  adapters: Record<string, CapabilityAdapter>;
  actorId: string; // runtime identity label for the ledger row
  ownerIdentity: string; // owner email the approval must bind to
  now: () => number;
  // Approval record reader (fail-closed undefined). Injected so tests and
  // the web/runtime tiers can bind their own RLS-bound read.
  readApproval: (
    client: RuntimeClient, approvalId: string,
  ) => Promise<Record<string, unknown> | undefined>;
  log?: (fields: Record<string, unknown>) => void;
}

function errResult(
  sideEffectId: string, error: CapabilityError,
): CapabilityResult {
  return {
    ok: false, side_effect_id: sideEffectId, provider_result_id: null,
    summary: '', artifact_refs: [], error,
  };
}

const terminal = (reason: string): CapabilityError =>
  ({ error_class: 'terminal', reason });
const retryable = (reason: string): CapabilityError =>
  ({ error_class: 'retryable', reason });
const uncertain = (reason: string): CapabilityError =>
  ({ error_class: 'uncertain', reason });

// Authoritative side-effect approval verification. Same fail-closed shape as
// the job path (orchestration/store.verifyAuthoritativeApproval), rebound to
// the side-effect canonical envelope: approved, owner-bound, environment-
// bound, SHA-256 action-hash-bound (capability + payload hash + target +
// side_effect_id), nonce present, non-expired at the execution clock.
export function verifySideEffectApproval(
  record: Record<string, unknown> | undefined,
  args: {
    approval_id: string;
    definition: CapabilityDefinition;
    side_effect_id: string;
    target: string;
    payload_hash: string;
    owner_identity: string;
  },
  nowMs: number,
): { ok: boolean; reason: string } {
  if (!record) return { ok: false, reason: 'no_approval_record' };
  if (String(record.approval_id) !== args.approval_id) {
    return { ok: false, reason: 'approval_id_mismatch' };
  }
  if (String(record.status) !== 'approved') return { ok: false, reason: 'not_approved' };
  if (String(record.owner_identity) !== args.owner_identity) {
    return { ok: false, reason: 'owner_mismatch' };
  }
  if (String(record.environment) !== deploymentEnvironment()) {
    return { ok: false, reason: 'environment_mismatch' };
  }
  const expected = sideEffectApprovalHash({
    approval_id: args.approval_id,
    definition: args.definition,
    side_effect_id: args.side_effect_id,
    target: args.target,
    payload_hash: args.payload_hash,
    owner_identity: args.owner_identity,
    created_at: String(record.created_at ?? ''),
    expires_at: String(record.expires_at ?? ''),
  });
  if (String(record.action_hash) !== expected) {
    return { ok: false, reason: 'action_hash_mismatch' };
  }
  if (!record.nonce) return { ok: false, reason: 'nonce_missing' };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'execution_clock_invalid' };
  const expires = Date.parse(String(record.expires_at ?? ''));
  if (!Number.isFinite(expires) || nowMs >= expires) {
    return { ok: false, reason: 'expired_at_execution' };
  }
  return { ok: true, reason: 'authoritatively_approved' };
}

// Bounded adapter invocation. A WRITE that times out or throws is UNCERTAIN
// (the provider may have acted); a READ maps the same faults to RETRYABLE
// (re-reading cannot duplicate anything).
async function runAdapter(
  adapter: CapabilityAdapter,
  input: Parameters<CapabilityAdapter['execute']>[0],
): Promise<AdapterOutcome> {
  const isWrite = input.definition.operation_kind === 'write';
  const timeoutMs = input.definition.timeout_ms;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AdapterOutcome>((resolve) => {
    timer = setTimeout(() => resolve({
      status: isWrite ? 'uncertain' : 'retryable',
      reason: 'provider_timeout',
    }), timeoutMs);
  });
  try {
    return await Promise.race([adapter.execute(input), timeout]);
  } catch {
    return {
      status: isWrite ? 'uncertain' : 'retryable',
      reason: 'adapter_exception',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Replay a row that already holds a terminal/uncertain outcome WITHOUT
// executing anything (acceptance A / master goal section 12: a parent-job
// retry must never create a second external action).
function replayFromRow(
  row: Record<string, unknown>, sideEffectId: string,
): CapabilityResult | null {
  const status = String(row.status ?? '');
  if (status === 'succeeded') {
    return {
      ok: true, side_effect_id: sideEffectId,
      provider_result_id: row.provider_result_id == null
        ? null : String(row.provider_result_id),
      summary: 'replayed: side effect already succeeded (no re-execution)',
      artifact_refs: Array.isArray(row.evidence_refs)
        ? (row.evidence_refs as string[]).slice(0, 20) : [],
      error: null,
    };
  }
  if (status === 'failed' || status === 'refused') {
    return errResult(sideEffectId,
      terminal(String(row.error_message ?? 'side_effect_previously_failed')));
  }
  if (status === 'uncertain') {
    return errResult(sideEffectId, uncertain('awaiting_reconciliation'));
  }
  if (status === 'executing') {
    // Another claimant owns it right now: refuse without executing. The
    // bounded retry re-enters once the owner settles or requeues.
    return errResult(sideEffectId, retryable('execution_in_flight'));
  }
  return null; // proposed/authorized: resume the lifecycle
}

export async function executeCapability(
  deps: CapabilityExecutorDeps,
  request: CapabilityRequest,
): Promise<CapabilityResult> {
  const nowIso = () => new Date(deps.now()).toISOString();
  const log = (fields: Record<string, unknown>) =>
    deps.log?.({ event: 'capability_executor', ...fields });

  // 1. contract validation (invalid work terminalizes immediately).
  const v = validateCapabilityRequest(request);
  if (!v.ok) {
    log({ stage: 'validate', refused: v.reason });
    return errResult('', terminal(`contract_invalid:${v.reason}`));
  }

  // 2. registry lookup (unknown capability fails closed, terminal).
  const found = lookupCapability(request.capability, request.version);
  if (!found.ok) {
    log({ stage: 'lookup', refused: found.reason, capability: request.capability });
    return errResult('', terminal(found.reason));
  }
  const def = found.definition;
  const sideEffectId = deriveSideEffectId(request.idempotency_key);

  // 3. adapter presence (fail closed before any ledger write).
  const adapter = deps.adapters[def.provider];
  if (!adapter) {
    log({ stage: 'adapter', refused: 'provider_adapter_unavailable', provider: def.provider });
    return errResult(sideEffectId, terminal('provider_adapter_unavailable'));
  }

  // 4. idempotent ledger proposal. A ledger that cannot be written REFUSES
  // SAFELY (retryable - nothing external happened; master goal section 16).
  const ins = await insertSideEffectProposal(deps.client, {
    side_effect_id: sideEffectId,
    request_id: request.request_id,
    goal_id: request.goal_id,
    job_id: request.job_id,
    run_id: request.run_id,
    actor_id: deps.actorId,
    provider: def.provider,
    account_id: null,
    capability: def.name,
    capability_version: def.version,
    target: String(request.target).slice(0, 300),
    payload_hash: v.payload_hash,
    payload_summary: `${def.name} -> ${String(request.target).slice(0, 120)}`,
    risk_class: def.risk_class,
    approval_id: request.approval_id ?? null,
    idempotency_key: request.idempotency_key,
    evidence_refs: [],
  }, nowIso());
  if (!ins.ok) {
    log({ stage: 'ledger', refused: 'ledger_unavailable' });
    return errResult(sideEffectId, retryable('ledger_unavailable'));
  }
  // Existing row (duplicate request / worker retry / restart): converge on
  // its persisted state. Unreadable row => refuse safely.
  const row = await readSideEffect(deps.client, sideEffectId);
  if (!row) {
    log({ stage: 'ledger', refused: 'ledger_row_unreadable' });
    return errResult(sideEffectId, retryable('ledger_unreadable'));
  }
  const replay = replayFromRow(row, sideEffectId);
  if (replay) {
    log({ stage: 'replay', status: String(row.status), side_effect_id: sideEffectId });
    return replay;
  }

  // 5. policy classification (existing Preston risk taxonomy; BLACK never
  // executes; RED and requires_approval demand a verified owner approval).
  if (def.risk_class === 'BLACK') {
    await refuseSideEffect(deps.client, sideEffectId,
      String(row.status) === 'authorized' ? 'authorized' : 'proposed',
      'policy_black_refused', nowIso());
    await recordEvent(deps, sideEffectId, 'refused', 0, request, def);
    return errResult(sideEffectId, terminal('policy_black_refused'));
  }
  const needsApproval = def.requires_approval || def.risk_class === 'RED';

  // 6. approval gate (only when still proposed; an authorized row already
  // passed this gate and its approval binding is in the ledger).
  if (String(row.status) === 'proposed') {
    let approvalId: string | null = null;
    if (needsApproval) {
      const claimed = String(request.approval_id ?? '').trim();
      if (!claimed) {
        await refuseSideEffect(deps.client, sideEffectId, 'proposed',
          'approval_required', nowIso());
        await recordEvent(deps, sideEffectId, 'refused', 0, request, def);
        return errResult(sideEffectId, terminal('approval_required'));
      }
      const record = await deps.readApproval(deps.client, claimed);
      const check = verifySideEffectApproval(record, {
        approval_id: claimed, definition: def, side_effect_id: sideEffectId,
        target: request.target, payload_hash: v.payload_hash,
        owner_identity: deps.ownerIdentity,
      }, deps.now());
      if (!check.ok) {
        await refuseSideEffect(deps.client, sideEffectId, 'proposed',
          `approval_${check.reason}`, nowIso());
        await recordEvent(deps, sideEffectId, 'refused', 0, request, def);
        return errResult(sideEffectId, terminal(`approval_${check.reason}`));
      }
      approvalId = claimed;
    }
    const auth = await authorizeSideEffect(
      deps.client, sideEffectId, approvalId, nowIso());
    if (!auth.ok) {
      log({ stage: 'authorize', refused: auth.error });
      return errResult(sideEffectId, retryable('authorize_cas_lost'));
    }
  }

  // 7. durable attempt cap, then the one-winner EXECUTING claim.
  const attempts = Number(row.attempt_count ?? 0);
  if (attempts >= MAX_SIDE_EFFECT_ATTEMPTS) {
    await refuseSideEffect(deps.client, sideEffectId, 'authorized',
      'attempts_exhausted', nowIso());
    await recordEvent(deps, sideEffectId, 'refused', attempts, request, def);
    return errResult(sideEffectId, terminal('attempts_exhausted'));
  }
  const claim = await claimSideEffect(deps.client, sideEffectId, attempts, nowIso());
  if (!claim.ok) {
    // Lost the claim: a concurrent execution owns the row. NEVER a second
    // execution (acceptance A/C).
    log({ stage: 'claim', refused: claim.error });
    return errResult(sideEffectId, retryable('claim_lost'));
  }
  const attempt = attempts + 1;

  // 8. the ONE bounded provider invocation.
  const out = await runAdapter(adapter, {
    definition: def, request, payload_hash: v.payload_hash, attempt,
  });

  // 9. settle + record. Settle failures NEVER fabricate success: an
  // unsettleable success is reported UNCERTAIN (the action happened but the
  // ledger could not prove it - reconciliation path, not silence).
  if (out.status === 'ok') {
    const evidence = [`se:${sideEffectId}:attempt:${attempt}:succeeded`];
    const settled = await settleSideEffectSuccess(
      deps.client, sideEffectId,
      out.provider_result_id, evidence, nowIso());
    await recordEvent(deps, sideEffectId, settled.ok ? 'succeeded' : 'settle_failed',
      attempt, request, def);
    if (!settled.ok) {
      return errResult(sideEffectId, uncertain('success_unrecorded'));
    }
    return {
      ok: true, side_effect_id: sideEffectId,
      provider_result_id: out.provider_result_id,
      summary: String(out.summary ?? '').slice(0, 400),
      artifact_refs: (out.artifact_refs ?? []).slice(0, 20),
      error: null,
    };
  }
  if (out.status === 'terminal') {
    await settleSideEffectTerminal(deps.client, sideEffectId, out.reason, nowIso());
    await recordEvent(deps, sideEffectId, 'failed', attempt, request, def);
    return errResult(sideEffectId, terminal(out.reason));
  }
  if (out.status === 'uncertain') {
    await markSideEffectUncertain(deps.client, sideEffectId, out.reason, nowIso());
    await recordEvent(deps, sideEffectId, 'uncertain', attempt, request, def);
    return errResult(sideEffectId, uncertain(out.reason));
  }
  // retryable
  await requeueSideEffectRetryable(deps.client, sideEffectId, out.reason, nowIso());
  await recordEvent(deps, sideEffectId, 'retryable', attempt, request, def);
  return errResult(sideEffectId, retryable(out.reason));
}

// History rides the EXISTING append-only os_events mechanism (master goal
// section 11) - deterministic id => PK-idempotent on replay; a failed append
// never changes the execution outcome (observability, not authority).
async function recordEvent(
  deps: CapabilityExecutorDeps,
  sideEffectId: string,
  disposition: string,
  attempt: number,
  request: CapabilityRequest,
  def: CapabilityDefinition,
): Promise<void> {
  try {
    const id = `ev-se-${sideEffectId}-${attempt}-${disposition}`;
    await insertEvent(deps.client, makeEnvelope({
      id,
      type: 'SideEffectRecorded',
      actor: deps.actorId,
      source: 'capability-executor',
      correlation_id: `side_effect:${sideEffectId}`,
      idempotency_key: id,
      now: new Date(deps.now()).toISOString(),
      payload: {
        side_effect_id: sideEffectId,
        capability: def.name,
        provider: def.provider,
        disposition,
        attempt,
        goal_id: request.goal_id,
        job_id: request.job_id,
        run_id: request.run_id,
      },
    }));
  } catch {
    deps.log?.({ event: 'capability_executor', stage: 'record', error: 'event_append_failed' });
  }
}

export { toJobFailureReason };
