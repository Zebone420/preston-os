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
    // Observe-only reads/records; it is safe while execution is disabled, so
    // only a hard owner_stop halts it (not execution_enabled).
    if (controls.owner_stop) {
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
