import {
  EXIT,
  jsonLogger,
  parseArgs,
  runDispatcher,
  type DispatcherCommand,
} from './dispatcher';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  createRuntimeClientWithToken,
  missingRuntimeEnv,
  resolveRuntimeToken,
  type TokenStore,
} from './supabase-runtime';

// Atomic file store for the rotating refresh token (host only). Write to a temp
// file then rename (atomic on one filesystem); 0600 perms. Single-worker timer
// (no overlap) means no concurrent writers.
function fileTokenStore(path: string): TokenStore {
  return {
    read() {
      try {
        return existsSync(path) ? readFileSync(path, 'utf8').trim() || null : null;
      } catch {
        return null;
      }
    },
    write(refreshToken: string) {
      const tmp = path + '.tmp';
      writeFileSync(tmp, refreshToken, { mode: 0o600 });
      renameSync(tmp, path);
    },
  };
}

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
  const env = process.env as Record<string, string | undefined>;
  let client;
  try {
    const missing = missingRuntimeEnv(env);
    if (missing.length) throw new Error('missing runtime env: ' + missing.join(', '));
    // Durable: mint a fresh access token from the (rotating) refresh token at
    // startup, persisting the rotated token to the store for the next run.
    const storePath = env['SUPABASE_RUNTIME_TOKEN_STORE'];
    const store = storePath ? fileTokenStore(storePath) : null;
    const token = await resolveRuntimeToken(env, fetch, store);
    client = createRuntimeClientWithToken(env, token);
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
