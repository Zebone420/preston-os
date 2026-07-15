import {
  EXIT,
  jsonLogger,
  parseArgs,
  runDispatcher,
  type DispatcherCommand,
} from './dispatcher';
import { createRuntimeClient } from './supabase-runtime';

// Preston AI OS - compiled remote dispatcher entry (Phase 4B.1).
// Invoked by the disabled systemd oneshot services (see deploy/systemd). Builds
// the RLS-bound service-identity client, runs one bounded dispatch, and exits
// with a structured code. It executes NOTHING live, starts no daemon, and never
// loops forever. The owner does not hand-write this file - it ships in the repo
// and is compiled by `npm run build:os-runtime`.

async function main(): Promise<void> {
  const { command, maxIterations } = parseArgs(process.argv);
  const log = jsonLogger();
  const correlationId = 'disp-' + process.pid + '-' + command;

  // `health` can run without full runtime env (it reports the gap). The working
  // commands construct the real client, which fails closed if env is missing.
  let client;
  try {
    client = createRuntimeClient(process.env as Record<string, string | undefined>);
  } catch (err) {
    if (command !== 'health') {
      log({ level: 'error', command, correlationId, event: 'config_error', message: (err as Error).message });
      process.exit(EXIT.config);
    }
    // Health without env: report and exit non-zero config so monitoring notices.
    log({ level: 'warn', command, correlationId, event: 'health_no_env', message: (err as Error).message });
    process.exit(EXIT.config);
  }

  const result = await runDispatcher({
    command: command as DispatcherCommand,
    client,
    env: process.env as Record<string, string | undefined>,
    now: new Date().toISOString(),
    correlationId,
    log,
    maxIterations,
  });
  process.exit(result.exitCode);
}

void main();
