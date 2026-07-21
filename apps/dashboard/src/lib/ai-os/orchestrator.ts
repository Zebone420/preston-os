import { classifyTask, decide, type HermesInput, type TaskTextHints } from './hermes';
import { simulationEligible } from './candidates';
import { eligibleWorker, type EligibilityInput } from './leases';
import { runPermitted, simulate, type ExecutionEnvelope } from './runner';
import { makeEnvelope } from './transport';
import {
  insertEvent,
  insertOrchestrationDecision,
  readSystemControls,
  type RuntimeClient,
} from './store';

// Preston AI OS - orchestrator entry points (Phase 3). NON-ACTIVATING.
// Two pure/adapter-driven flows used by the (future) worker CLI and Hermes
// observe-only executable:
//   - runWorkerCycleSimulation: runs the full guard chain and SIMULATES a job;
//     it never launches a process (executed is always false).
//   - runHermesObserveOnce: one-shot observe pass that computes + records
//     dispatch decisions and emits an event; it never leases or executes.
// No daemon, no polling loop is started here.

// --- worker cycle (simulation only) ----------------------------------------

export interface WorkerCycleInput {
  eligibility: EligibilityInput; // agent + job + controls + required caps/connectors
  envelope: ExecutionEnvelope;
  now: string;
  // 'execution' (default) applies the FULL gate set including execution_enabled.
  // 'simulation' (Phase 5) omits only the execution-enabled gate - nothing
  // executes either way (executed is ALWAYS false), so staging evidence can be
  // produced while execution stays globally disabled.
  mode?: 'execution' | 'simulation';
}

export interface WorkerCycleResult {
  registered: boolean;
  eligible: boolean;
  eligibilityReasons: string[];
  envelopeValid: boolean;
  envelopeErrors: string[];
  runPermitted: boolean; // would a REAL run be permitted? (default false)
  planned: string; // what WOULD run
  executed: false; // ALWAYS false - this never launches a process
  checkpointStatus: 'simulated_ok' | 'blocked';
}

// Full guard chain + simulation. Even when every gate passes, executed stays
// false and runPermitted is only true if the owner has enabled the runner AND
// the runtime (both default false).
export function runWorkerCycleSimulation(input: WorkerCycleInput): WorkerCycleResult {
  const elig = input.mode === 'simulation'
    ? simulationEligible(input.eligibility)
    : eligibleWorker(input.eligibility);
  const sim = simulate(input.envelope);
  const permitted = runPermitted(input.envelope, input.eligibility.controls);
  const ok = elig.ok && sim.valid;
  return {
    registered: true,
    eligible: elig.ok,
    eligibilityReasons: elig.reasons,
    envelopeValid: sim.valid,
    envelopeErrors: sim.errors,
    runPermitted: permitted,
    planned: sim.planned,
    executed: false,
    checkpointStatus: ok ? 'simulated_ok' : 'blocked',
  };
}

// --- Hermes observe-once ---------------------------------------------------

export interface ObserveCandidate {
  id: string; // job/candidate id
  input: HermesInput;
  // Optional routing hint (Phase 5J), sourced read-only from the job's command
  // packet when cheaply available. NEVER fed into input.command / eligibility -
  // it only feeds the observe-only routing RECOMMENDATION below, so it cannot
  // change a decision's dispatch/propose/observe/reject/noop outcome.
  packet?: TaskTextHints | null;
}

export interface ObserveOutcome {
  id: string;
  decision: string;
  reasons: string[];
}

export interface ObserveRunResult {
  hermesMode: string;
  observations: ObserveOutcome[];
  recorded: number; // orchestration_decisions written
  skipped: boolean; // true when Hermes is disabled/stopped
}

// One-shot observe pass. Reads controls; if Hermes is disabled/stopped it
// records nothing. Otherwise it computes a decision per candidate, records an
// orchestration_decision, and emits a HermesObserved event. It NEVER leases,
// executes, or approves - regardless of the computed decision value.
export async function runHermesObserveOnce(
  client: RuntimeClient,
  candidates: ObserveCandidate[],
  now: string,
): Promise<ObserveRunResult> {
  const controls = await readSystemControls(client);
  if (controls.hermes_mode === 'disabled' || controls.hermes_mode === 'stopped') {
    return { hermesMode: controls.hermes_mode, observations: [], recorded: 0, skipped: true };
  }

  const observations: ObserveOutcome[] = [];
  let recorded = 0;
  for (const c of candidates) {
    const res = decide(c.input); // decision only; this loop never acts on it
    // Attach a routing RECOMMENDATION only when Hermes actually observes
    // (never on noop/reject/etc). This is advisory metadata carried as reason
    // strings on the SAME 'observe' decision - it assigns nothing, mutates no
    // job, and calls no other agent.
    const reasons = res.decision === 'observe'
      ? [...res.reasons, ...routingReasons(c)]
      : res.reasons;
    observations.push({ id: c.id, decision: res.decision, reasons });
    // Correlation: command's when present, else the JOB's - so the decision +
    // event rows stay linkable to the drill evidence chain (audit fix; the
    // literal 'na' is the last resort for command-less, job-less candidates).
    const corr = c.input.command?.correlation_id
      || c.input.eligibility.job.correlation_id
      || 'na';
    const w = await insertOrchestrationDecision(client, {
      id: 'od-' + c.id,
      job_id: c.id,
      hermes_mode: controls.hermes_mode,
      decision: res.decision,
      reasons,
      correlation_id: corr,
    });
    if (w.ok && !w.duplicate) recorded++; // duplicates are idempotent no-ops, not new records
    await insertEvent(
      client,
      makeEnvelope({
        id: 'ev-od-' + c.id,
        type: 'HermesObserved',
        actor: 'hermes',
        source: 'hermes',
        correlation_id: corr,
        idempotency_key: 'od-' + c.id,
        now,
        payload: { candidate: c.id, decision: res.decision },
      }),
    );
  }
  return { hermesMode: controls.hermes_mode, observations, recorded, skipped: false };
}

// Structured, deterministic reason strings for the observe-only routing
// recommendation. classifyTask is pure/no-I/O; this wrapper just formats its
// output. 'route:mode=recommendation_only' makes explicit (in the audit
// trail) that nothing here assigns or dispatches work.
function routingReasons(c: ObserveCandidate): string[] {
  const cls = classifyTask(c.input.eligibility.job, c.packet ?? null);
  return [
    'route:implementer=' + cls.implementer,
    'route:reviewer=' + cls.reviewer,
    'route:task_kind=' + cls.task_kind,
    'route:mode=recommendation_only',
  ];
}
