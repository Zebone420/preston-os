import { redactSecrets } from '../lib/ai-os/memory';
import {
  workerHealth,
  workerSimulateLoop,
  type WorkerOnceInput,
} from '../lib/ai-os/worker-service';
import { hermesHealth, hermesObserveLoop } from '../lib/ai-os/hermes-service';
import type { ObserveCandidate } from '../lib/ai-os/orchestrator';
import { probeControls, type RuntimeClient } from '../lib/ai-os/store';
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
  }

  try {
    if (command === 'health') {
      const worker = await workerHealth(client);
      const hermes = await hermesHealth(client);
      log({ level: 'info', command, correlationId, event: 'health', worker, hermes });
      return { exitCode: EXIT.ok, summary: { worker, hermes } };
    }

    if (command === 'db-health') {
      // Authenticated read-only probe: proves the (refreshed) session can reach
      // the staging control plane. Writes nothing. A prod-looking URL is refused.
      const url = String(env['SUPABASE_URL'] ?? '');
      if (/\bprod(uction)?\b/i.test(url)) {
        log({ level: 'error', command, correlationId, event: 'db_health', error: 'production target refused' });
        return { exitCode: EXIT.config, summary: { error: 'production target refused' } };
      }
      const probe = await probeControls(client);
      log({ level: probe.ok ? 'info' : 'error', command, correlationId, event: 'db_health', ok: probe.ok, rows: probe.rows, error: probe.error });
      return { exitCode: probe.ok ? EXIT.ok : EXIT.error, summary: { ok: probe.ok, rows: probe.rows } };
    }

    if (command === 'worker-loop') {
      const res = await workerSimulateLoop({
        client,
        candidates: input.workerCandidates ?? [],
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

    // hermes-loop
    const res = await hermesObserveLoop(
      client,
      input.hermesBatches ?? [],
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
