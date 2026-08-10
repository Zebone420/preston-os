import { runHermesObserveOnce, type ObserveCandidate, type ObserveRunResult } from './orchestrator';
import { isHalted } from './controls';
import { readSystemControls, type RuntimeClient } from './store';

// Preston AI OS - Hermes observe-only service wrapper (Phase 4B). OBSERVE ONLY.
// Wraps the tested runHermesObserveOnce. It reads state and records decisions +
// events; it NEVER leases, executes, approves, enables execution/runner, sends
// messages, or runs shell. Disabled by default. The loop is BOUNDED (maxRounds)
// and stops on disabled/stopped/halted - not a daemon.

export async function hermesObserveOnce(
  client: RuntimeClient,
  candidates: ObserveCandidate[],
  now: string,
): Promise<ObserveRunResult> {
  return runHermesObserveOnce(client, candidates, now);
}

export interface HermesLoopResult {
  rounds: number;
  stoppedReason: 'completed' | 'disabled' | 'halted' | 'max_rounds';
  totalRecorded: number;
}

export async function hermesObserveLoop(
  client: RuntimeClient,
  batches: ObserveCandidate[][],
  maxRounds: number,
  now: string,
): Promise<HermesLoopResult> {
  let recorded = 0;
  let r = 0;
  for (const batch of batches) {
    if (r >= maxRounds) return { rounds: r, stoppedReason: 'max_rounds', totalRecorded: recorded };
    const controls = await readSystemControls(client);
    if (controls.hermes_mode === 'disabled' || controls.hermes_mode === 'stopped') {
      return { rounds: r, stoppedReason: 'disabled', totalRecorded: recorded };
    }
    // Observe-only reads/records; it is safe while execution is disabled, so we
    // do NOT gate on execution_enabled. But it must stop on a hard owner_stop OR
    // a soft pause OR hermes paused mode (mirrors the worker loop).
    if (controls.owner_stop || controls.paused || controls.hermes_mode === 'paused') {
      return { rounds: r, stoppedReason: 'halted', totalRecorded: recorded };
    }
    const res = await runHermesObserveOnce(client, batch, now);
    recorded += res.recorded;
    r++;
  }
  return { rounds: r, stoppedReason: 'completed', totalRecorded: recorded };
}

export interface HermesHealth {
  mode: string;
  halted: boolean;
}

export async function hermesHealth(client: RuntimeClient): Promise<HermesHealth> {
  const c = await readSystemControls(client);
  return { mode: c.hermes_mode, halted: isHalted(c) };
}

// --- Phase 8: orchestration status observation (READ-ONLY) -----------------
//
// Connects Hermes to the Phase 7 goal graph as a STATUS observer: it reads
// the fail-closed bridge readiness summary (goals/approvals/failures
// aggregates + posture) and records ONE bounded, idempotent status decision
// per time bucket. It approves nothing, unlocks nothing, sends nothing -
// remote callers and the dashboard read the recorded status; owner
// NOTIFICATION remains the status surfaces (a Hermes send channel is a
// separate, later owner gate).

import { loadBridgeReadiness } from './orchestration/read-model';
import { insertOrchestrationDecision } from './store';

export interface HermesOrchestrationObservation {
  recorded: boolean;
  status: string;
  open_approvals: number;
  failed_jobs: number;
  dead_lettered_jobs: number;
  approval_attention: boolean; // an owner decision is being waited on
}

export async function hermesObserveOrchestration(
  client: RuntimeClient,
  nowIso: string,
): Promise<HermesOrchestrationObservation> {
  const controls = await readSystemControls(client);
  const out: HermesOrchestrationObservation = {
    recorded: false, status: 'skipped', open_approvals: 0,
    failed_jobs: 0, dead_lettered_jobs: 0, approval_attention: false,
  };
  if (controls.hermes_mode === 'disabled' || controls.hermes_mode === 'stopped' ||
      controls.owner_stop || controls.paused || controls.hermes_mode === 'paused') {
    return out; // same halt semantics as the observe loop
  }
  const ready = await loadBridgeReadiness(client);
  out.status = ready.status;
  out.open_approvals = ready.open_approvals;
  out.failed_jobs = ready.failed_jobs;
  out.dead_lettered_jobs = ready.dead_lettered_jobs;
  out.approval_attention = ready.open_approvals > 0;
  // One decision row per minute bucket (PK idempotency): a repeatedly-fired
  // observer never floods the decisions log.
  // decision MUST be a value allowed by the 0004 CHECK constraint
  // (dispatch|propose|observe|reject|noop) - the live DB rejects anything
  // else and the row silently never lands (found 2026-08-10 before first
  // live fire; the fake DB enforces no CHECKs). The status observation is
  // an 'observe' row; its identity lives in the od-orchstatus- id prefix
  // and the leading 'orchestration_status' reason marker.
  const bucket = nowIso.slice(0, 16).replace(/[-:T]/g, '');
  const dec = await insertOrchestrationDecision(client, {
    id: `od-orchstatus-${bucket}`,
    hermes_mode: controls.hermes_mode,
    decision: 'observe',
    reasons: [
      'orchestration_status',
      `status:${ready.status}`,
      `open_approvals:${ready.open_approvals}`,
      `failed:${ready.failed_jobs}`,
      `dead_lettered:${ready.dead_lettered_jobs}`,
      ...(out.approval_attention ? ['approval_attention'] : []),
    ],
    correlation_id: `orchstatus-${bucket}`,
  });
  out.recorded = dec.ok;
  return out;
}
