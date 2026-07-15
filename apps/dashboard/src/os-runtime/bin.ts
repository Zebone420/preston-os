import {
  EXIT,
  jsonLogger,
  parseArgs,
  runDispatcher,
  type DispatcherCommand,
} from './dispatcher';
import {
  existsSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  createRuntimeClientWithToken,
  missingRuntimeEnv,
  resolveWorkerToken,
  type TokenStore,
} from './supabase-runtime';

// Host-side rotating refresh-token store. Security: refuse a symlink, refuse
// group/other-accessible permissions, single-writer lock (O_EXCL lockfile),
// same-filesystem atomic replace (temp + rename), 0600. read() THROWS on an
// insecure/unreadable store so resolveWorkerToken fails closed. Not unit-tested
// (fs); the decision logic is tested via a fake TokenStore.
function fileTokenStore(path: string): TokenStore {
  const lock = path + '.lock';
  return {
    read() {
      if (!existsSync(path)) return null; // not bootstrapped
      const st = lstatSync(path);
      if (st.isSymbolicLink()) throw new Error('token store is a symlink (insecure)');
      if ((st.mode & 0o077) !== 0) throw new Error('token store has group/other access (insecure)');
      const v = readFileSync(path, 'utf8').trim();
      return v === '' ? null : v;
    },
    write(refreshToken: string) {
      let fd: number;
      try {
        fd = openSync(lock, 'wx'); // exclusive: fails if another writer holds it
      } catch {
        throw new Error('token store is locked by another writer (concurrent access)');
      }
      try {
        const tmp = path + '.tmp';
        writeFileSync(tmp, refreshToken, { mode: 0o600 });
        renameSync(tmp, path); // atomic on the same filesystem
      } finally {
        closeSync(fd);
        try {
          rmSync(lock);
        } catch {
          /* best-effort lock cleanup */
        }
      }
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
  const { command, maxIterations, diagnostic } = parseArgs(process.argv);
  const log = jsonLogger();
  const correlationId = 'disp-' + process.pid + '-' + command;

  // `health` can run without full runtime env (it reports the gap). Working
  // commands (worker-loop/hermes-loop/db-health) require the durable token
  // store unless --diagnostic (static access token, local only) is set.
  const env = process.env as Record<string, string | undefined>;
  let client;
  try {
    const missing = missingRuntimeEnv(env);
    if (missing.length) throw new Error('missing runtime env: ' + missing.join(', '));
    // Bootstrap-then-store: mint a fresh access token, capture + persist the
    // rotated refresh token. Service mode REQUIRES SUPABASE_RUNTIME_TOKEN_STORE.
    const storePath = env['SUPABASE_RUNTIME_TOKEN_STORE'];
    const store = storePath ? fileTokenStore(storePath) : null;
    const token = await resolveWorkerToken(env, fetch, store, { diagnostic });
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
