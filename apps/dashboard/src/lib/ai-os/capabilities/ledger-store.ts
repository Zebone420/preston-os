// Preston AI OS - universal side-effect ledger adapters (power-station
// master goal sections 11/12). Server-side, RLS-bound, REUSING the existing
// RuntimeClient/WriteOutcome idiom (../store.ts) - deliberately NOT a second
// state-machine architecture: one table, CAS transitions, history through
// the EXISTING os_events append mechanism (the executor appends events; this
// module persists ledger STATE only and executes nothing).
//
// Lifecycle (single authority for external actions):
//
//   proposed -> refused                      (policy/contract refusal)
//   proposed -> authorized                   (policy pass + approval if req.)
//   authorized -> executing                  (CAS claim; exactly one winner)
//   executing -> succeeded                   (provider confirmed)
//   executing -> failed                      (terminal provider/policy error)
//   executing -> uncertain                   (outcome unknown - timeout etc.)
//   executing -> authorized                  (retryable fault; bounded retry
//                                             re-claims through the SAME row)
//   uncertain -> succeeded | failed          (RECONCILIATION ONLY - with
//                                             provider evidence; never a
//                                             blind re-execution)
//
// Idempotency spine: side_effect_id is DERIVED from idempotency_key
// (contract.deriveSideEffectId), and the table carries unique(idempotency_
// key) - so duplicate requests, worker retries, and restarts all converge on
// ONE row, and the executing CAS admits exactly one execution at a time.

import type { RuntimeClient, WriteOutcome } from '../store';
import { deploymentEnvironment } from '../runtime-environment';

export const SIDE_EFFECT_TABLE = 'side_effects';

export type SideEffectStatus =
  | 'proposed' | 'refused' | 'authorized' | 'executing'
  | 'succeeded' | 'failed' | 'uncertain';

// Legal transition edges (mirrors transitions.ts style; kept local because
// the ledger lifecycle is intentionally tiny).
const EDGES: Readonly<Record<SideEffectStatus, readonly SideEffectStatus[]>> = {
  proposed: ['refused', 'authorized'],
  authorized: ['executing', 'refused'],
  executing: ['succeeded', 'failed', 'uncertain', 'authorized'],
  uncertain: ['succeeded', 'failed'],
  refused: [],
  succeeded: [],
  failed: [],
};

export function canTransitionSideEffect(
  from: string, to: string,
): boolean {
  const outs = EDGES[from as SideEffectStatus];
  return Array.isArray(outs) && outs.includes(to as SideEffectStatus);
}

export interface SideEffectRow {
  side_effect_id: string;
  request_id: string;
  goal_id: string;
  job_id: string;
  run_id: string;
  actor_id: string;
  provider: string;
  account_id: string | null;
  capability: string;
  capability_version: number;
  target: string;
  payload_hash: string;
  payload_summary: string;
  risk_class: string;
  approval_id: string | null;
  status: SideEffectStatus;
  attempt_count: number;
  idempotency_key: string;
  environment: string;
  provider_result_id: string | null;
  error_type: string | null; // terminal | retryable | uncertain
  error_message: string | null; // static reason codes only
  evidence_refs: string[];
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

// Idempotent PROPOSED insert. A duplicate (same side_effect_id or same
// idempotency_key) reports { ok: true, duplicate: true } - callers then READ
// the existing row and continue from its persisted status (acceptance A/C/D).
export async function insertSideEffectProposal(
  client: RuntimeClient,
  row: Omit<SideEffectRow, 'status' | 'attempt_count' | 'provider_result_id' |
    'error_type' | 'error_message' | 'environment'>,
  nowIso: string,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(SIDE_EFFECT_TABLE).insert({
      ...row,
      environment: deploymentEnvironment(), // forced to THIS deployment
      status: 'proposed',
      attempt_count: 0,
      provider_result_id: null,
      error_type: null,
      error_message: null,
      created_at: nowIso,
    }).select('side_effect_id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: row.side_effect_id };
      }
      return { ok: false, error: 'side_effects insert failed: ' + res.error.message };
    }
    return { ok: true, id: row.side_effect_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'side_effects insert failed' };
  }
}

// Fail-closed read: undefined on error/missing (callers refuse to act).
export async function readSideEffect(
  client: RuntimeClient,
  sideEffectId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await client.from(SIDE_EFFECT_TABLE)
      .select('*').eq('side_effect_id', sideEffectId).limit(1);
    if (res.error) return undefined;
    return res.data?.[0];
  } catch {
    return undefined;
  }
}

// Guarded CAS transition on the single ledger row. Extra conds tighten the
// claim (e.g. attempt_count fencing). A lost CAS is a refusal, never forced.
async function casSideEffect(
  client: RuntimeClient,
  sideEffectId: string,
  fromStatus: string,
  patch: Record<string, unknown>,
  nowIso: string,
  conds: Array<{ col: string; val: string }> = [],
): Promise<WriteOutcome> {
  const to = String(patch.status ?? '');
  if (!canTransitionSideEffect(fromStatus, to)) {
    return { ok: false, error: `illegal_transition:${fromStatus}->${to}` };
  }
  try {
    let q = client.from(SIDE_EFFECT_TABLE)
      .update({ ...patch, updated_at: nowIso })
      .eq('side_effect_id', sideEffectId)
      .eq('status', fromStatus);
    for (const c of conds) q = q.eq(c.col, c.val);
    const res = await q.select('side_effect_id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'status_changed_elsewhere' };
    }
    return { ok: true, id: sideEffectId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'transition failed' };
  }
}

export function refuseSideEffect(
  client: RuntimeClient, sideEffectId: string, fromStatus: 'proposed' | 'authorized',
  reason: string, nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, fromStatus, {
    status: 'refused', error_type: 'terminal', error_message: reason,
    completed_at: nowIso,
  }, nowIso);
}

export function authorizeSideEffect(
  client: RuntimeClient, sideEffectId: string, approvalId: string | null,
  nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'proposed', {
    status: 'authorized', approval_id: approvalId, authorized_at: nowIso,
  }, nowIso);
}

// The EXECUTING claim: CAS authorized -> executing fenced on the observed
// attempt_count, so exactly one claimant wins and a replayed/concurrent
// claim loses cleanly (acceptance A/C). The winner's attempt_count increments
// atomically with the claim.
export function claimSideEffect(
  client: RuntimeClient, sideEffectId: string, observedAttempts: number,
  nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'authorized', {
    status: 'executing', attempt_count: observedAttempts + 1,
    started_at: nowIso,
  }, nowIso, [{ col: 'attempt_count', val: String(observedAttempts) }]);
}

export function settleSideEffectSuccess(
  client: RuntimeClient, sideEffectId: string, providerResultId: string | null,
  evidenceRefs: string[], nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'executing', {
    status: 'succeeded', provider_result_id: providerResultId,
    error_type: null, error_message: null,
    evidence_refs: evidenceRefs, completed_at: nowIso,
  }, nowIso);
}

export function settleSideEffectTerminal(
  client: RuntimeClient, sideEffectId: string, reason: string, nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'executing', {
    status: 'failed', error_type: 'terminal', error_message: reason,
    completed_at: nowIso,
  }, nowIso);
}

// Uncertain: the provider MAY have acted. No completed_at (nothing is
// complete); reconciliation is the only way out (acceptance E/F).
export function markSideEffectUncertain(
  client: RuntimeClient, sideEffectId: string, reason: string, nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'executing', {
    status: 'uncertain', error_type: 'uncertain', error_message: reason,
  }, nowIso);
}

// Retryable fault: the row returns to authorized so the EXISTING bounded
// retry (parent job retry re-invoking the executor) can re-claim the SAME
// row. attempt_count is preserved (the claim incremented it) so the cap in
// the executor is durable across process restarts.
export function requeueSideEffectRetryable(
  client: RuntimeClient, sideEffectId: string, reason: string, nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'executing', {
    status: 'authorized', error_type: 'retryable', error_message: reason,
  }, nowIso);
}

// RECONCILIATION: settle an uncertain row from provider evidence. This NEVER
// executes anything - it records what reconciliation PROVED happened. The
// CAS on status='uncertain' makes it one-time (acceptance F).
export function reconcileSideEffect(
  client: RuntimeClient, sideEffectId: string,
  finding: 'succeeded' | 'failed', providerResultId: string | null,
  evidenceRef: string, nowIso: string,
): Promise<WriteOutcome> {
  return casSideEffect(client, sideEffectId, 'uncertain', {
    status: finding, provider_result_id: providerResultId,
    error_type: finding === 'failed' ? 'terminal' : null,
    error_message: finding === 'failed' ? 'reconciled_provider_failure' : null,
    evidence_refs: [evidenceRef], completed_at: nowIso,
  }, nowIso);
}
