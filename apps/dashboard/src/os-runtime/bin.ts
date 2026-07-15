import {
  EXIT,
  jsonLogger,
  parseArgs,
  runDispatcher,
  type DispatcherCommand,
} from './dispatcher';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import {
  createRuntimeClientWithToken,
  missingRuntimeEnv,
  resolveWorkerToken,
  type TokenStore,
} from './supabase-runtime';

// Host-side rotating refresh-token store. Security:
//  - read(): open with O_NOFOLLOW (refuse a symlink) and fstat the OPEN fd
//    (TOCTOU-resistant); refuse group/other permissions; THROWS on insecure/
//    unreadable so resolveWorkerToken fails closed.
//  - write(): a pid-unique O_EXCL temp created at 0600 (never follows/reuses a
//    stale or planted temp; guarantees 0600), fsync, then atomic rename. No
//    persistent lockfile (a crash-left lock would deadlock all future writes);
//    the single-worker timer + atomic rename provide single-writer semantics.
// Not unit-tested (fs); the decision logic is tested via a fake TokenStore.
function fileTokenStore(path: string): TokenStore {
  return {
    read() {
      if (!existsSync(path)) return null; // not bootstrapped
      let fd: number;
      try {
        fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      } catch {
        throw new Error('token store is not a regular readable file (symlink refused/unreadable)');
      }
      try {
        const st = fstatSync(fd);
        if ((st.mode & 0o077) !== 0) {
          throw new Error('token store has group/other access (insecure)');
        }
        const v = readFileSync(fd, 'utf8').trim();
        return v === '' ? null : v;
      } finally {
        closeSync(fd);
      }
    },
    write(refreshToken: string) {
      const tmp = path + '.tmp.' + process.pid;
      // O_CREAT|O_EXCL|O_WRONLY at 0600: fails if the temp already exists (stale
      // or symlink), and creates it with tight perms.
      const fd = openSync(tmp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      try {
        writeSync(fd, refreshToken);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path); // atomic on the same filesystem
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
    const token = await resolveWorkerToken(env, fetch, store, {
      diagnostic,
      allowBootstrap: process.argv.includes('--bootstrap'),
    });
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
