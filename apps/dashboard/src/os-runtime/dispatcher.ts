import { redactSecrets } from '../lib/ai-os/memory';
import {
  workerHealth,
  workerSimulateLoop,
  type WorkerOnceInput,
} from '../lib/ai-os/worker-service';
import { hermesHealth, hermesObserveLoop } from '../lib/ai-os/hermes-service';
import type { ObserveCandidate } from '../lib/ai-os/orchestrator';
import { buildHermesObserveBatch, runStagingWorkerCycle } from '../lib/ai-os/staging-sim';
import type { AgentRecord } from '../lib/ai-os/types';
import { probeControls, readSystemControls, type RuntimeClient } from '../lib/ai-os/store';
import { missingRuntimeEnv } from './supabase-runtime';

// Preston AI OS - remote dispatcher core (Phase 4B.1). PURE + testable.
// The compiled entry (bin.ts) constructs a real client and calls runDispatcher;
// tests inject a fake client. It runs the tested worker/Hermes wrappers in
// SIMULATION / OBSERVE only - executes nothing, runs no shell, starts no daemon.
// Bounded by maxIterations. Structured JSON logs are redacted. Exit codes are
// structured so systemd can react.

export const EXIT = {
  ok: 0,
  halted: 75, // owner_stop / pause during the run
  error: 70, // unexpected failure
  config: 78, // missing/invalid environment (EX_CONFIG)
} as const;

export type Logger = (line: Record<string, unknown>) => void;

// JSON logger that redacts secret-shaped fields before emitting.
export function jsonLogger(sink: (s: string) => void = (s) => console.log(s)): Logger {
  return (line) => sink(JSON.stringify(redactSecrets({ source: 'ai-os-dispatcher', ...line })));
}

export type DispatcherCommand = 'health' | 'db-health' | 'worker-loop' | 'hermes-loop';

export interface DispatcherInput {
  command: DispatcherCommand;
  client: RuntimeClient;
  env: Record<string, string | undefined>;
  now: string;
  correlationId: string;
  log: Logger;
  maxIterations?: number;
  workerCandidates?: WorkerOnceInput[];
  hermesBatches?: ObserveCandidate[][];
}

export interface DispatcherResult {
  exitCode: number;
  summary: Record<string, unknown>;
}

export function parseArgs(argv: string[]): {
  command: DispatcherCommand;
  maxIterations: number;
  diagnostic: boolean;
} {
  const cmd = argv[2];
  const command: DispatcherCommand =
    cmd === 'worker-loop' ? 'worker-loop'
      : cmd === 'hermes-loop' ? 'hermes-loop'
        : cmd === 'db-health' ? 'db-health'
          : 'health';
  const maxIdx = argv.indexOf('--max');
  const maxIterations = maxIdx >= 0 ? Number(argv[maxIdx + 1]) || 5 : 5;
  return { command, maxIterations, diagnostic: argv.includes('--diagnostic') };
}

// Positive staging allowlist + production-URL denylist. Shared by db-health
// and (Phase 5) the DB-touching loops: NO loop may read or write any database
// the operator has not explicitly marked as staging.
function stagingGate(
  env: Record<string, string | undefined>,
  command: string,
  correlationId: string,
  log: Logger,
): DispatcherResult | null {
  if (env['SUPABASE_RUNTIME_ENV'] !== 'staging') {
    log({ level: 'error', command, correlationId, event: 'staging_gate', error: 'SUPABASE_RUNTIME_ENV must be staging (fail-closed)' });
    return { exitCode: EXIT.config, summary: { error: 'not marked staging' } };
  }
  if (/\bprod(uction)?\b/i.test(String(env['SUPABASE_URL'] ?? ''))) {
    log({ level: 'error', command, correlationId, event: 'staging_gate', error: 'production target refused' });
    return { exitCode: EXIT.config, summary: { error: 'production target refused' } };
  }
  return null;
}

function workerAgent(env: Record<string, string | undefined>, now: string): AgentRecord {
  return {
    id: env['WORKER_AGENT_ID'] ?? 'preston-worker', display_name: 'Preston Worker',
    provider: 'anthropic', model: 'dispatcher', capabilities: ['code'],
    allowed_connectors: ['github'], status: 'idle', current_task_id: null,
    last_seen: now, version: '1', owner: 'owner',
  };
}

function hermesAgent(env: Record<string, string | undefined>, now: string): AgentRecord {
  return {
    id: env['HERMES_AGENT_ID'] ?? 'preston-hermes', display_name: 'Preston Hermes',
    provider: 'anthropic', model: 'dispatcher', capabilities: [],
    allowed_connectors: [], status: 'idle', current_task_id: null,
    last_seen: now, version: '1', owner: 'owner',
  };
}

export async function runDispatcher(input: DispatcherInput): Promise<DispatcherResult> {
  const { command, client, env, now, correlationId, log } = input;

  // Fail-closed env validation for the working commands. `health` may run
  // without full runtime env so it can REPORT the config gap.
  if (command !== 'health') {
    const missing = missingRuntimeEnv(env);
    if (missing.length) {
      log({ level: 'error', command, correlationId, event: 'config_error', missing });
      return { exitCode: EXIT.config, summary: { error: 'missing runtime env', missing } };
    }
    // Every non-health command touches the database - staging only, always.
    const gate = stagingGate(env, command, correlationId, log);
    if (gate) return gate;
  }

  try {
    if (command === 'health') {
      const worker = await workerHealth(client);
      const hermes = await hermesHealth(client);
      log({ level: 'info', command, correlationId, event: 'health', worker, hermes });
      return { exitCode: EXIT.ok, summary: { worker, hermes } };
    }

    if (command === 'db-health') {
      // Authenticated read-only probe. The staging allowlist + production
      // denylist already ran in stagingGate (shared with the loops).
      const probe = await probeControls(client);
      // Require an actually-readable row: PostgREST returns [] (no error) when RLS
      // filters everything, which must NOT count as healthy read authorization.
      const healthy = probe.ok && probe.rows >= 1;
      log({ level: healthy ? 'info' : 'error', command, correlationId, event: 'db_health', ok: probe.ok, rows: probe.rows, error: probe.error });
      return { exitCode: healthy ? EXIT.ok : EXIT.error, summary: { ok: healthy, rows: probe.rows } };
    }

    if (command === 'worker-loop') {
      // Pre-loop halt gate: a halted runtime always yields EXIT.halted from
      // the shipped unit, even before any candidate work.
      const pre = await readSystemControls(client);
      if (pre.owner_stop || pre.paused) {
        log({ level: 'info', command, correlationId, event: 'worker_loop', iterations: 0, stoppedReason: 'halted', executed: false });
        return { exitCode: EXIT.halted, summary: { iterations: 0, stoppedReason: 'halted' } };
      }
      // Injected candidates = test/simulation harness path (legacy shape).
      if (input.workerCandidates !== undefined) {
        const res = await workerSimulateLoop({
          client,
          candidates: input.workerCandidates,
          maxIterations: input.maxIterations ?? 5,
          now,
        });
        log({
          level: 'info', command, correlationId, event: 'worker_loop',
          iterations: res.iterations, stoppedReason: res.stoppedReason, executed: false,
        });
        return {
          exitCode: res.stoppedReason === 'halted' ? EXIT.halted : EXIT.ok,
          summary: { iterations: res.iterations, stoppedReason: res.stoppedReason },
        };
      }
      // Phase 5E: DB-sourced bounded staging cycle (evidence-producing,
      // executed ALWAYS false, staging-gated above).
      const cycle = await runStagingWorkerCycle(client, {
        agent: workerAgent(env, now),
        maxJobs: input.maxIterations ?? 5,
        leaseTtlMs: 120000,
        now,
      });
      log({
        level: 'info', command, correlationId, event: 'worker_loop',
        iterations: cycle.evidence.length,
        stoppedReason: cycle.halted ? 'halted' : 'completed',
        executed: false,
        considered: cycle.considered,
        recovered: cycle.recovered,
        outcomes: cycle.evidence.map((e) => ({ job: e.jobId, outcome: e.outcome })),
        rejected: cycle.rejected.length,
      });
      return {
        exitCode: cycle.halted ? EXIT.halted : EXIT.ok,
        summary: {
          iterations: cycle.evidence.length,
          stoppedReason: cycle.halted ? 'halted' : 'completed',
          outcomes: cycle.evidence.map((e) => e.outcome),
        },
      };
    }

    // hermes-loop
    // Same pre-loop gate as worker-loop (per-round checks need a non-empty
    // batch list). Disabled mode is a clean no-op exit, not a halt.
    const pre = await readSystemControls(client);
    if (pre.hermes_mode === 'disabled' || pre.hermes_mode === 'stopped') {
      log({ level: 'info', command, correlationId, event: 'hermes_loop', rounds: 0, stoppedReason: 'disabled', recorded: 0 });
      return { exitCode: EXIT.ok, summary: { rounds: 0, stoppedReason: 'disabled' } };
    }
    if (pre.owner_stop || pre.paused || pre.hermes_mode === 'paused') {
      log({ level: 'info', command, correlationId, event: 'hermes_loop', rounds: 0, stoppedReason: 'halted', recorded: 0 });
      return { exitCode: EXIT.halted, summary: { rounds: 0, stoppedReason: 'halted' } };
    }
    // Injected batches = test path; otherwise source one bounded observe batch
    // from queued jobs (Phase 5E). Observe-only: decisions + events, no lease.
    const batches = input.hermesBatches !== undefined
      ? input.hermesBatches
      : [await buildHermesObserveBatch(client, hermesAgent(env, now), input.maxIterations ?? 5, now)];
    const res = await hermesObserveLoop(
      client,
      batches,
      input.maxIterations ?? 5,
      now,
    );
    log({
      level: 'info', command, correlationId, event: 'hermes_loop',
      rounds: res.rounds, stoppedReason: res.stoppedReason, recorded: res.totalRecorded,
    });
    return {
      exitCode: res.stoppedReason === 'halted' ? EXIT.halted : EXIT.ok,
      summary: { rounds: res.rounds, stoppedReason: res.stoppedReason },
    };
  } catch (err) {
    log({ level: 'error', command, correlationId, event: 'dispatch_error', message: (err as Error).message });
    return { exitCode: EXIT.error, summary: { error: (err as Error).message } };
  }
}
