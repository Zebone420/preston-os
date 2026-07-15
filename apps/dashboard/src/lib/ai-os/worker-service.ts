import { runWorkerCycleSimulation, type WorkerCycleInput } from './orchestrator';
import { isHalted, type SystemControls } from './controls';
import type { Checkpoint } from './checkpoint';
import {
  insertAttempt,
  insertCheckpoint,
  readSystemControls,
  releaseLease,
  type RuntimeClient,
} from './store';

// Preston AI OS - worker service wrapper (Phase 4B). SIMULATION ONLY.
// Wraps the tested runWorkerCycleSimulation with control-plane persistence:
// records a checkpoint + attempt, releases the lease. It NEVER launches a
// process (executed always false), never runs shell, never mutates business
// systems. The loop is BOUNDED (maxIterations) and halts on owner_stop / pause
// / execution-disabled - it is not a daemon.

export interface WorkerOnceInput {
  client: RuntimeClient;
  cycle: WorkerCycleInput; // eligibility + envelope + now
  jobId: string;
  agentId: string;
  checkpoint: Checkpoint; // template; status is overwritten from the sim result
  now: string;
}

export interface WorkerOnceResult {
  simulatedOk: boolean;
  eligible: boolean;
  envelopeValid: boolean;
  checkpointWritten: boolean;
  attemptWritten: boolean;
  leaseReleased: boolean;
  executed: false; // ALWAYS false
}

export async function workerOnce(input: WorkerOnceInput): Promise<WorkerOnceResult> {
  const sim = runWorkerCycleSimulation(input.cycle);
  const ok = sim.eligible && sim.envelopeValid;

  const cp = await insertCheckpoint(
    input.client,
    { ...input.checkpoint, status: ok ? 'complete' : 'blocked' },
    input.jobId,
  );
  const at = await insertAttempt(input.client, {
    id: 'att-' + input.jobId,
    job_id: input.jobId,
    attempt_no: 1,
    worker: input.agentId,
    correlation_id: input.checkpoint.correlation_id,
    outcome: ok ? 'completed' : 'failed',
  });
  const rel = await releaseLease(input.client, input.jobId, input.agentId, input.now);

  return {
    simulatedOk: ok,
    eligible: sim.eligible,
    envelopeValid: sim.envelopeValid,
    checkpointWritten: cp.ok,
    attemptWritten: at.ok,
    leaseReleased: rel.ok,
    executed: false,
  };
}

export interface WorkerLoopInput {
  client: RuntimeClient;
  candidates: WorkerOnceInput[];
  maxIterations: number;
  now: string;
}

export interface WorkerLoopResult {
  iterations: number;
  stoppedReason: 'completed' | 'halted' | 'max_iterations';
  results: WorkerOnceResult[];
}

// Bounded simulate-loop. Reads controls BEFORE each iteration and stops on any
// halt/pause. maxIterations is a hard cap - there is no unbounded loop.
export async function workerSimulateLoop(input: WorkerLoopInput): Promise<WorkerLoopResult> {
  const results: WorkerOnceResult[] = [];
  let i = 0;
  for (const c of input.candidates) {
    if (i >= input.maxIterations) {
      return { iterations: i, stoppedReason: 'max_iterations', results };
    }
    const controls = await readSystemControls(input.client);
    // Simulation is safe while execution is disabled (that is the drill), so we
    // halt only on a hard owner_stop or a soft pause - NOT on execution_enabled.
    if (controls.owner_stop || controls.paused) {
      return { iterations: i, stoppedReason: 'halted', results };
    }
    results.push(await workerOnce(c));
    i++;
  }
  return { iterations: i, stoppedReason: 'completed', results };
}

export interface WorkerHealth {
  halted: boolean;
  paused: boolean;
  execution_enabled: boolean;
  runner_enabled: boolean;
  hermes_mode: string;
}

export async function workerHealth(client: RuntimeClient): Promise<WorkerHealth> {
  const c = await readSystemControls(client);
  return {
    halted: isHalted(c),
    paused: c.paused,
    execution_enabled: c.execution_enabled,
    runner_enabled: c.remote_runner_enabled,
    hermes_mode: c.hermes_mode,
  };
}

// A simulate-loop stops on a hard owner_stop or a soft pause. Execution being
// globally disabled does NOT stop simulation (it is safe and the drill's point).
export function stopRequested(controls: SystemControls): boolean {
  return controls.owner_stop || controls.paused;
}
