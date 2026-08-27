import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../lib/ai-os/memory';
import {
  deploymentEnvironment, strictRuntimeEnvironment,
  foreignProjectRefs, instanceProductionRef, instanceStagingRef,
} from '../lib/ai-os/runtime-environment';
import {
  workerHealth,
  workerSimulateLoop,
  type WorkerOnceInput,
} from '../lib/ai-os/worker-service';
import { hermesHealth, hermesObserveLoop, hermesObserveOrchestration } from '../lib/ai-os/hermes-service';
import type { ObserveCandidate } from '../lib/ai-os/orchestrator';
import { buildHermesObserveBatch, runStagingWorkerCycle } from '../lib/ai-os/staging-sim';
import type { AgentRecord } from '../lib/ai-os/types';
import {
  probeControls,
  readSystemControls,
  readSystemControlsChecked,
  type RuntimeClient,
} from '../lib/ai-os/store';
import {
  checkClaimedApprovalUnlockable,
  driveGoal,
  JOB_READ_LIMIT,
  MAX_GOAL_JOBS,
  type DriverLockContext,
} from '../lib/ai-os/orchestration/driver';
import {
  listDependenciesForGoal,
  listGoalsByStatus,
  listJobsForGoal,
  probeSimulationPinViolations,
} from '../lib/ai-os/orchestration/store';
import { isMigrationAbsentError } from '../lib/ai-os/orchestration/read-model';
import { consumeRemoteIntakeOnce } from '../lib/ai-os/orchestration/remote-intake';
import type { ComposerClient } from '../lib/ai-os/orchestration/composer-persist';
import { resolveExecutionLevel } from '../lib/ai-os/execution-capability';
import { notifyAttentionOnce } from '../lib/ai-os/notifications';
import { runtimeNotifyOwner } from './telegram-notify';
import { buildRealExecutor } from './real-executor';
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

export type DispatcherCommand =
  | 'health'
  | 'db-health'
  | 'worker-loop'
  | 'hermes-loop'
  | 'orchestrate-once'
  | 'capability-dryrun';

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
  // capability-dryrun ONLY: scenario + explicit idempotency key (a repeated
  // key proves the ledger's duplicate convergence on a live drill).
  dryrun?: { scenario: string; key: string | null };
  // Test-injection seams for orchestrate-once ONLY. Production (bin.ts) never
  // sets these: the command then uses the real clock, a crypto-random
  // per-invocation lock-token seed, and the driver's own crypto-random run-id
  // minting (driveGoal's default newRunId).
  orchestrate?: {
    clock?: () => number;
    lockTokenSeed?: () => string;
    newRunId?: () => string;
  };
}

export interface DispatcherResult {
  exitCode: number;
  summary: Record<string, unknown>;
}

export function parseArgs(argv: string[]): {
  command: DispatcherCommand;
  maxIterations: number;
  diagnostic: boolean;
  dryrun: { scenario: string; key: string | null };
} {
  const cmd = argv[2];
  const command: DispatcherCommand =
    cmd === 'worker-loop' ? 'worker-loop'
      : cmd === 'hermes-loop' ? 'hermes-loop'
        : cmd === 'db-health' ? 'db-health'
          : cmd === 'orchestrate-once' ? 'orchestrate-once'
            : cmd === 'capability-dryrun' ? 'capability-dryrun'
              : 'health';
  const maxIdx = argv.indexOf('--max');
  const maxIterations = maxIdx >= 0 ? Number(argv[maxIdx + 1]) || 5 : 5;
  const scIdx = argv.indexOf('--scenario');
  const keyIdx = argv.indexOf('--key');
  return {
    command, maxIterations, diagnostic: argv.includes('--diagnostic'),
    dryrun: {
      scenario: scIdx >= 0 ? String(argv[scIdx + 1] ?? 'success') : 'success',
      key: keyIdx >= 0 ? String(argv[keyIdx + 1] ?? '') || null : null,
    },
  };
}

// Positive environment allowlist + cross-environment URL denylist (P2).
// Shared by db-health and the DB-touching loops: NO loop may touch any
// database the operator has not explicitly marked with THIS deployment's
// environment, and the URL must not belong to the OTHER environment.
function stagingGate(
  env: Record<string, string | undefined>,
  command: string,
  correlationId: string,
  log: Logger,
): DispatcherResult | null {
  const runtimeEnv = strictRuntimeEnvironment(env);
  if (runtimeEnv === null) {
    log({ level: 'error', command, correlationId, event: 'staging_gate', error: 'SUPABASE_RUNTIME_ENV must be staging or production (fail-closed)' });
    return { exitCode: EXIT.config, summary: { error: 'not marked staging' } };
  }
  const url = String(env['SUPABASE_URL'] ?? '').toLowerCase();
  // Foreign-instance denylist (Gate 2 instance contract): a deployment
  // configured as a clone must NEVER touch the origin instance's projects
  // in ANY environment. Strictly additive refusal; empty for Preston.
  for (const foreign of foreignProjectRefs(env)) {
    if (url.includes(foreign)) {
      log({ level: 'error', command, correlationId, event: 'staging_gate', error: 'foreign instance target refused' });
      return { exitCode: EXIT.config, summary: { error: 'foreign instance target refused' } };
    }
  }
  if (runtimeEnv === 'staging' &&
      (/\bprod(uction)?\b/.test(url) || url.includes(instanceProductionRef(env)))) {
    log({ level: 'error', command, correlationId, event: 'staging_gate', error: 'production target refused' });
    return { exitCode: EXIT.config, summary: { error: 'production target refused' } };
  }
  if (runtimeEnv === 'production' && url.includes(instanceStagingRef(env))) {
    log({ level: 'error', command, correlationId, event: 'staging_gate', error: 'staging target refused in production' });
    return { exitCode: EXIT.config, summary: { error: 'staging target refused' } };
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

// --- orchestrate-once (Phase 7 goal driving; SIMULATION ONLY) ---------------

// Statuses the durable driver can make progress on. 'proposed' is non-terminal
// but NOT driveable: decomposition is an owner/dashboard action, and driving a
// job-less goal would only burn its bounded iteration budget.
const DRIVEABLE_GOAL_STATUSES = ['decomposed', 'running', 'blocked'] as const;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'cancelled', 'dead_lettered']);
// Park-scan refusal reasons that are ORDINARY parking (nothing decided yet,
// or nothing decidable) rather than a decided-but-unverifiable record worth
// surfacing in the tick log.
const QUIET_PARK_REASONS = new Set([
  'job_has_no_approval_id', 'no_approval_record', 'not_approved',
]);
const BASE_COMMIT_RE = /^[0-9a-f]{7,40}$/i;
// Per-status selection window. Oldest-first per status, so the globally oldest
// driveable goal is ALWAYS inside the merged window (no starvation).
const GOAL_WINDOW_PER_STATUS = 50;
// Edge read bound; a FULL read is unprovably complete and refuses to drive.
const DEP_READ_LIMIT = 10000;

function orchestrateSeams(input: DispatcherInput) {
  return {
    clock: input.orchestrate?.clock ?? (() => Date.now()),
    lockTokenSeed: input.orchestrate?.lockTokenSeed ?? (() => randomUUID()),
    newRunId: input.orchestrate?.newRunId, // undefined => driver's crypto default
  };
}

// One bounded Phase-7 goal-driving pass. Selects AT MOST ONE eligible
// non-terminal simulation goal and advances it via the existing durable driver
// (driveGoal). Everything is fail-closed: missing/invalid lock configuration,
// unreadable controls, an unsafe control posture, an unreadable goal/dependency
// read, or a simulation-pin violation refuses the run. The driver itself
// enforces owner_stop/pause, authoritative approvals, execution leases,
// worktree-lock fencing, retry budgets, and wall/iteration timeouts; execution
// stays simulation-only (executed:false) end to end - this command performs no
// external business write and cannot enable one.
async function orchestrateOnce(input: DispatcherInput): Promise<DispatcherResult> {
  const { client, env, correlationId, log } = input;
  const command = 'orchestrate-once';
  const seams = orchestrateSeams(input);

  // Lock-context configuration (fail-closed): edit-kind jobs must never run
  // without a worktree lock, and the lock needs a pinned base + path allowlist.
  const baseCommit = String(env['ORCH_BASE_COMMIT'] ?? '').trim();
  if (!BASE_COMMIT_RE.test(baseCommit)) {
    log({ level: 'error', command, correlationId, event: 'config_error', error: 'ORCH_BASE_COMMIT missing or not 7-40 hex (fail-closed)' });
    return { exitCode: EXIT.config, summary: { error: 'ORCH_BASE_COMMIT invalid' } };
  }
  const allowedPaths = String(env['ORCH_ALLOWED_PATHS'] ?? '')
    .split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  // Same safety rules the worktree lock enforces (decideAcquire): no absolute
  // paths, no traversal. Rejecting them HERE surfaces a misconfiguration as
  // exit 78 instead of burning iterations on doomed lock acquisitions
  // (Codex initial-review MAJOR #6).
  const unsafePath = allowedPaths.some((p) => p.includes('..') || p.startsWith('/'));
  if (allowedPaths.length === 0 || unsafePath) {
    log({ level: 'error', command, correlationId, event: 'config_error', error: 'ORCH_ALLOWED_PATHS missing/empty or unsafe entry (fail-closed)' });
    return { exitCode: EXIT.config, summary: { error: 'ORCH_ALLOWED_PATHS invalid' } };
  }

  // Safety posture. Unreadable controls: refuse (cannot verify safety).
  // owner_stop/paused: halted. A posture with execution or the remote runner
  // enabled is NOT the simulation drill this command implements - refuse.
  const ctl = await readSystemControlsChecked(client);
  if (!ctl.readOk) {
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'controls unreadable (fail-closed)' });
    return { exitCode: EXIT.error, summary: { error: 'controls unreadable' } };
  }
  if (ctl.controls.owner_stop || ctl.controls.paused) {
    log({ level: 'info', command, correlationId, event: 'orchestrate_once', stoppedReason: 'halted' });
    return { exitCode: EXIT.halted, summary: { stoppedReason: 'halted' } };
  }
  // Phase 8 capability resolution. EXACTLY TWO legal postures:
  //   SIMULATION - execution + remote runner both false (the Phase 7 pin).
  //   BOUNDED_CODE_EXECUTION - both true AND the full env chain agrees
  //     (ORCH_EXECUTION_LEVEL=bounded_code_execution, staging,
  //      DISABLE_REMOTE_RUNNER=false). Real bounded work is then INJECTED
  //     into the driver; external writes stay impossible (code ceiling).
  // Any other combination is a mixed/unknown posture - refuse exit 78,
  // preserving the Phase 7 fail-closed behavior for every state that is
  // not an owner-installed bounded-execution posture.
  const capability = resolveExecutionLevel({
    env, controls: ctl.controls, controlsReadOk: ctl.readOk,
  });
  const enabledFlags = ctl.controls.execution_enabled ||
    ctl.controls.remote_runner_enabled;
  if (enabledFlags && !capability.realExecutionAllowed) {
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'unsafe posture: execution/remote runner enabled without a resolved bounded-execution capability (refused)', reasons: capability.reasons });
    return { exitCode: EXIT.config, summary: { error: 'unsafe controls posture', reasons: capability.reasons } };
  }

  // Phase 8: consume REMOTE INTAKE requests (bounded, oldest-first) through
  // the owner-equivalent composer pipeline BEFORE goal selection, so a
  // phone/ChatGPT request submitted between ticks becomes a driveable goal
  // on this same tick. Fail-open-to-skip: an unreadable/absent 0011 table
  // or a per-row failure never blocks orchestration (each row is contained;
  // rejected rows carry their reason for the remote status surface).
  try {
    // The runtime client is a real supabase-js client at runtime and thus
    // carries .rpc(); the ComposerClient view exposes it to the composer's
    // atomic submit_goal_decomposition path.
    const intake = await consumeRemoteIntakeOnce(
      client as unknown as ComposerClient, env,
      new Date(seams.clock()).toISOString(),
    );
    if (intake.configured && (intake.selected || intake.consumed.length || intake.rejected.length || intake.errors.length)) {
      log({ level: 'info', command, correlationId, event: 'remote_intake', selected: intake.selected, consumed: intake.consumed, rejected: intake.rejected, ...(intake.errors.length ? { errors: intake.errors } : {}) });
    }
  } catch (e) {
    log({ level: 'error', command, correlationId, event: 'remote_intake', error: e instanceof Error ? e.message.slice(0, 200) : 'intake failed' });
  }

  // Fast-track C1 idle fast path: the cheapest reliable "is there driveable
  // work?" test - one indexed limit-1 read per driveable status, short-
  // circuiting on the first hit. No pin probe, no goal-window hydration, no
  // per-candidate job reads, no executor composition happen on an idle tick;
  // the tick logs its measured duration and exits 0 cleanly. The pin probe
  // still guards every tick that DRIVES (it protects driving, and nothing is
  // driven on an idle tick).
  const tickStartMs = seams.clock();
  let anyDriveable = false;
  for (const status of DRIVEABLE_GOAL_STATUSES) {
    const probe = await listGoalsByStatus(client, status, 1);
    if (!probe.ok) {
      if (isMigrationAbsentError(probe.error ?? '')) {
        log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'migration 0010 not applied (fail-closed)' });
        return { exitCode: EXIT.config, summary: { error: 'migration 0010 not applied' } };
      }
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'goals unreadable: ' + probe.error });
      return { exitCode: EXIT.error, summary: { error: 'goals unreadable' } };
    }
    if (probe.rows.length > 0) { anyDriveable = true; break; }
  }
  if (!anyDriveable) {
    const idleMs = seams.clock() - tickStartMs;
    log({ level: 'info', command, correlationId, event: 'orchestrate_once', stoppedReason: 'no_eligible_goal', idle: true, duration_ms: idleMs });
    return { exitCode: EXIT.ok, summary: { selected: null, stoppedReason: 'no_eligible_goal', idle: true, duration_ms: idleMs } };
  }

  // GLOBAL simulation-pin probe (Codex final-review MAJOR #2): if ANY goal
  // row anywhere carries simulation_only=false, the schema pins have drifted
  // (0010 CHECK forbids it) - refuse the whole run, not just windowed rows.
  // Runs on every DRIVING tick (idle ticks exit above without driving).
  const pinProbe = await probeSimulationPinViolations(client);
  if (!pinProbe.ok) {
    if (isMigrationAbsentError(pinProbe.error ?? '')) {
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'migration 0010 not applied (fail-closed)' });
      return { exitCode: EXIT.config, summary: { error: 'migration 0010 not applied' } };
    }
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'pin probe unreadable: ' + pinProbe.error });
    return { exitCode: EXIT.error, summary: { error: 'pin probe unreadable' } };
  }
  if (pinProbe.rows.length > 0) {
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'simulation pin violated somewhere in master_goals (fail-closed)' });
    return { exitCode: EXIT.error, summary: { error: 'simulation pin violated' } };
  }

  // Deterministic goal selection (fail-closed on every ambiguity).
  // One OLDEST-FIRST read per driveable status, merged: the globally oldest
  // driveable goal is always inside the window, so no goal can starve behind
  // newer ones (Codex initial-review MAJOR #4).
  const driveable: Record<string, unknown>[] = [];
  for (const status of DRIVEABLE_GOAL_STATUSES) {
    const res = await listGoalsByStatus(client, status, GOAL_WINDOW_PER_STATUS);
    if (!res.ok) {
      if (isMigrationAbsentError(res.error ?? '')) {
        log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'migration 0010 not applied (fail-closed)' });
        return { exitCode: EXIT.config, summary: { error: 'migration 0010 not applied' } };
      }
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'goals unreadable: ' + res.error });
      return { exitCode: EXIT.error, summary: { error: 'goals unreadable' } };
    }
    driveable.push(...res.rows);
  }
  // A driveable row that violates the DB simulation pins is corrupted or
  // drifted state - refuse the whole run rather than skip it silently.
  const pinViolations = driveable.filter(
    (r) => r.simulation_only !== true ||
      String(r.environment) !== deploymentEnvironment(),
  );
  if (pinViolations.length > 0) {
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'simulation pin violated on a non-terminal goal (fail-closed)', goals: pinViolations.map((r) => String(r.id)) });
    return { exitCode: EXIT.error, summary: { error: 'simulation pin violated' } };
  }
  if (driveable.length === 0) {
    log({ level: 'info', command, correlationId, event: 'orchestrate_once', stoppedReason: 'no_eligible_goal' });
    return { exitCode: EXIT.ok, summary: { selected: null, stoppedReason: 'no_eligible_goal' } };
  }
  const selKey = (r: Record<string, unknown>) => `${String(r.created_at ?? '')}|${String(r.id)}`;
  const ordered = [...driveable].sort((a, b) => (selKey(a) < selKey(b) ? -1 : 1));

  // Parked goals must not starve the queue (Gate D A7 live finding,
  // 2026-08-05): the oldest driveable goal can be PERMANENTLY parked - every
  // non-terminal job awaiting an owner approval that is still pending or has
  // expired undecided. Selecting it and ENDING the run there monopolized
  // every oneshot; a younger, fully-approved goal was never reached on the
  // deployed host. Scan the merged (already bounded) window oldest-first
  // instead: skip each provably-parked goal, drive the FIRST goal that can
  // make progress. A goal is skipped only on POSITIVE evidence (jobs read
  // OK, all non-terminal jobs awaiting_approval, no linked record even
  // claiming 'approved'); every read failure still fails the whole run
  // (fail-closed), and approval enforcement itself is untouched - the
  // driver's authoritative verification remains the only unlock authority.
  const skippedParked: string[] = [];
  const unverifiableApprovals: Array<{ goal: string; job_id: string; reason: string }> = [];

  // Fast-track D1/D2 bounded-throughput knobs (env-tunable, clamped, with the
  // master-goal starting posture as defaults): parallel jobs inside a goal,
  // driveable goals per tick, and a soft wall budget that stops SELECTING new
  // goals once the tick has already run long (the current goal still finishes
  // its bounded pass; systemd's TimeoutStartSec stays the hard ceiling).
  const intEnv = (name: string, dflt: number, lo: number, hi: number): number => {
    const v = Number(env[name]);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : dflt;
  };
  const maxParallel = intEnv('ORCH_MAX_PARALLEL_JOBS', 2, 1, 4);
  const maxGoalsPerTick = intEnv('ORCH_MAX_GOALS_PER_TICK', 2, 1, 5);
  const softBudgetMs = intEnv('ORCH_TICK_SOFT_BUDGET_MS', 240_000, 30_000, 3_300_000);

  // Scan the ordered window for the next goal that can make progress,
  // skipping goals this tick already drove and provably-parked goals
  // (identical semantics to the former single-goal scan; every read failure
  // still fails the whole run fail-closed).
  const parkedSet = new Set<string>();
  const selectNext = async (
    exclude: ReadonlySet<string>,
  ): Promise<
    | { ok: true; selected: Record<string, unknown> | null }
    | { ok: false; result: DispatcherResult }
  > => {
  for (const cand of ordered) {
    const candId = String(cand.id);
    if (exclude.has(candId) || parkedSet.has(candId)) continue;
    const jobsRes = await listJobsForGoal(client, candId, JOB_READ_LIMIT);
    if (!jobsRes.ok) {
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', goal: candId, error: 'jobs unreadable: ' + jobsRes.error });
      return { ok: false, result: { exitCode: EXIT.error, summary: { error: 'jobs unreadable', goal: candId } } };
    }
    if (jobsRes.rows.length > MAX_GOAL_JOBS) {
      // More rows than the model/DB bound allows: completeness is unprovable
      // (Codex CRITICAL #1). Refuse rather than risk finalizing a partial graph.
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', goal: candId, error: 'job read exceeded the model bound; completeness unprovable (fail-closed)' });
      return { ok: false, result: { exitCode: EXIT.error, summary: { error: 'job graph overflow', goal: candId } } };
    }
    const nonTerminal = jobsRes.rows.filter((j) => !TERMINAL_JOB_STATUSES.has(String(j.status)));
    const allParked = nonTerminal.length > 0 &&
      nonTerminal.every((j) => String(j.status) === 'awaiting_approval');
    if (allParked) {
      // A record that merely CLAIMS 'approved' is not sufficient to spend
      // the run on this goal: a decided-but-unverifiable approval (e.g.
      // action_hash_mismatch or expired_at_execution residue) can never
      // unlock, so selecting the goal would re-drive it on EVERY tick and
      // starve younger goals behind it (live staging finding, 2026-08-06).
      // Pre-check each claimed approval with the driver's own verification
      // composition (checkClaimedApprovalUnlockable) and drive ONLY when
      // some claimed approval authoritatively verifies. The driver remains
      // the sole unlock authority: it re-verifies and CAS-clears the gate
      // itself, so a scan-time pass that fails at drive time still parks
      // fail-closed, and nothing here ever treats a refusal as approved.
      let unlockable = false;
      for (const j of nonTerminal) {
        const check = await checkClaimedApprovalUnlockable(
          client, cand, j, seams.clock(),
        );
        if (check.ok) { unlockable = true; break; }
        if (!QUIET_PARK_REASONS.has(check.reason)) {
          unverifiableApprovals.push({
            goal: candId, job_id: String(j.id), reason: check.reason,
          });
        }
      }
      if (!unlockable) {
        log({ level: 'info', command, correlationId, event: 'orchestrate_once', goal: candId, stoppedReason: 'awaiting_owner_approval', skipped: true });
        skippedParked.push(candId);
        parkedSet.add(candId);
        continue;
      }
    }
    return { ok: true, selected: cand };
  }
  return { ok: true, selected: null };
  };

  // Shared per-tick drive context: the per-invocation lock-token seed makes
  // every worktree ownership token unique to THIS invocation; run ids are
  // minted by the driver (crypto-random) unless a test injects a seam.
  const seed = seams.lockTokenSeed();
  const lockCtx: DriverLockContext = {
    base_commit: baseCommit,
    allowed_paths: allowedPaths,
    token: (jobId: string) => `orch-${seed}-${jobId}`,
  };
  // Phase 8: compose the bounded real executor ONLY under a fully-resolved
  // BOUNDED_CODE_EXECUTION posture. buildRealExecutor itself re-checks the
  // capability and returns null on any gap, and the executor re-resolves
  // per job - so a mid-run owner downgrade (owner_stop, pause, flag flip)
  // takes effect on the very next job without a restart. Composed ONCE per
  // tick and shared by every goal this tick drives.
  const executeReal = capability.realExecutionAllowed
    ? await buildRealExecutor({
      client, env,
      // Stage 11R-02: surface every decline-to-simulation with its static
      // reason code in the orchestrator log (no env values, no secrets).
      log: (fields) => log({ level: 'info', command, correlationId, ...fields }),
    })
    : null;
  if (capability.realExecutionAllowed) {
    log({ level: 'info', command, correlationId, event: 'capability', level_resolved: 'BOUNDED_CODE_EXECUTION', executor: executeReal ? 'composed' : 'declined_missing_host_config' });
  }

  // Fast-track D2: drive up to maxGoalsPerTick goals this tick (bounded,
  // oldest-first, budget-aware). Each goal gets the same bounded driveGoal
  // pass as before; a halt exits with the halt's mapping immediately.
  const driven: Array<Record<string, unknown>> = [];
  const drivenIds = new Set<string>();
  for (let gi = 0; gi < maxGoalsPerTick; gi++) {
    if (gi > 0 && seams.clock() - tickStartMs > softBudgetMs) {
      log({ level: 'info', command, correlationId, event: 'orchestrate_once', stoppedReason: 'tick_soft_budget_reached', goalsDriven: driven.length });
      break;
    }
    const sel = await selectNext(drivenIds);
    if (!sel.ok) return sel.result;
    if (sel.selected === null) break;
    const goalId = String(sel.selected.id);
    drivenIds.add(goalId);

    // Dependency edges: driving without them could run jobs out of order. A
    // FULL read (limit hit) is unprovably complete - missing edges would look
    // "satisfied" - so it refuses exactly like a read error (Codex #2).
    const depsRes = await listDependenciesForGoal(client, goalId, DEP_READ_LIMIT);
    if (!depsRes.ok) {
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', goal: goalId, error: 'dependencies unreadable: ' + depsRes.error });
      return { exitCode: EXIT.error, summary: { error: 'dependencies unreadable', goal: goalId } };
    }
    if (depsRes.rows.length >= DEP_READ_LIMIT) {
      log({ level: 'error', command, correlationId, event: 'orchestrate_once', goal: goalId, error: 'dependency graph read hit its bound; completeness unprovable (fail-closed)' });
      return { exitCode: EXIT.error, summary: { error: 'dependency graph overflow', goal: goalId } };
    }
    const depMap = new Map<string, string[]>();
    for (const r of depsRes.rows) {
      const jobId = String(r.job_id ?? '');
      const dep = String(r.depends_on_job_id ?? '');
      if (!jobId || !dep) continue;
      depMap.set(jobId, [...(depMap.get(jobId) ?? []), dep]);
    }
    const depends = (jobId: string) => depMap.get(jobId) ?? [];

    // An undefined newRunId falls through to driveGoal's own default: the
    // driver mints crypto-random run ids (node:crypto randomUUID).
    const r = await driveGoal(
      client, goalId, seams.clock, input.maxIterations ?? 5, depends, lockCtx,
      seams.newRunId, executeReal ?? undefined, maxParallel,
    );
    log({ level: 'info', command, correlationId, event: 'orchestrate_once', goal: goalId, cycles: r.cycles, halted: r.halted, reason: r.reason, duration_ms: seams.clock() - tickStartMs, ...(capability.realExecutionAllowed ? { execution_level: 'BOUNDED_CODE_EXECUTION' } : {}), ...(skippedParked.length ? { skippedParked } : {}), ...(unverifiableApprovals.length ? { unverifiableApprovals } : {}), ...(r.unlockRefusals?.length ? { unlockRefusals: r.unlockRefusals } : {}) });

    if (r.halted) {
      if (r.reason.includes('owner_stop')) {
        // Owner halt (stop/pause) - the intended operational halt state.
        return { exitCode: EXIT.halted, summary: { goal: goalId, cycles: r.cycles, stoppedReason: r.reason, goalsDriven: driven.length } };
      }
      if (r.reason.includes('controls_unreadable')) {
        // Control-plane outage, NOT an owner decision (Codex MINOR #7).
        return { exitCode: EXIT.error, summary: { goal: goalId, error: r.reason, goalsDriven: driven.length } };
      }
      if (r.reason === 'iteration_reserved_by_other') {
        // A concurrent worker holds this cycle - clean skip, not a failure.
        return { exitCode: EXIT.ok, summary: { goal: goalId, cycles: r.cycles, stoppedReason: 'lease_conflict_skip', goalsDriven: driven.length } };
      }
      if (r.reason === 'lock_context_required') {
        return { exitCode: EXIT.config, summary: { goal: goalId, error: r.reason } };
      }
      if (['goal_not_found', 'iteration_reserve_error', 'execution_clock_invalid'].includes(r.reason)) {
        return { exitCode: EXIT.error, summary: { goal: goalId, error: r.reason, goalsDriven: driven.length } };
      }
      // Cycle budget exhausted mid-goal: progress is persisted; the next bounded
      // invocation resumes from the durable state (restart-safe by design).
      return { exitCode: EXIT.ok, summary: { goal: goalId, cycles: r.cycles, stoppedReason: 'cycle_budget_exhausted', lastReason: r.reason, goalsDriven: driven.length } };
    }
    driven.push({ goal: goalId, cycles: r.cycles, reason: r.reason, ...(r.unlockRefusals?.length ? { unlockRefusals: r.unlockRefusals } : {}) });
  }

  if (driven.length === 0) {
    // Every candidate in the window is parked: undecided owner approvals
    // and/or decided-but-unverifiable residue (reasons surfaced below).
    log({ level: 'info', command, correlationId, event: 'orchestrate_once', stoppedReason: 'awaiting_owner_approval', skipped: true, skippedParked, ...(unverifiableApprovals.length ? { unverifiableApprovals } : {}) });
    return { exitCode: EXIT.ok, summary: { goal: skippedParked[0], skippedParked, stoppedReason: 'awaiting_owner_approval', skipped: true, ...(unverifiableApprovals.length ? { unverifiableApprovals } : {}) } };
  }
  const first = driven[0] as { goal: string; cycles: number; reason: string; unlockRefusals?: unknown[] };
  return {
    exitCode: EXIT.ok,
    summary: {
      // Single-goal fields keep their legacy shape (existing log/consumer
      // contract); goalsDriven/goals extend it additively for multi-goal ticks.
      goal: first.goal, cycles: first.cycles, stoppedReason: first.reason,
      goalsDriven: driven.length,
      ...(driven.length > 1 ? { goals: driven } : {}),
      duration_ms: seams.clock() - tickStartMs,
      ...(skippedParked.length ? { skippedParked } : {}),
      ...(unverifiableApprovals.length ? { unverifiableApprovals } : {}),
      ...(first.unlockRefusals?.length ? { unlockRefusals: first.unlockRefusals } : {}),
    },
  };
}

// --- capability-dryrun (power-station master goal sections 15/18) ----------
// An EXPLICIT bounded owner drill command - deliberately NOT part of any
// timer tick, so the capability spine adds zero cost to normal orchestration.
// Requires ORCH_CAPABILITY_DRYRUN_ENABLED=true (fail-closed exit 78). Runs
// the trusted executor against the REAL ledger with the in-process dry-run
// provider; no external system is touched by construction.
//
// Scenarios (--scenario): success (default) | terminal | retryable |
// uncertain | duplicate (two executions, one ledger row) | gated (the
// approval-gated write_test WITHOUT an approval -> expected refusal) |
// reconcile (settle a prior uncertain row for --key as succeeded).
async function capabilityDryrun(input: DispatcherInput): Promise<DispatcherResult> {
  const { client, env, correlationId, log } = input;
  const command = 'capability-dryrun';
  if (String(env['ORCH_CAPABILITY_DRYRUN_ENABLED'] ?? '').trim() !== 'true') {
    log({ level: 'error', command, correlationId, event: 'config_error', error: 'ORCH_CAPABILITY_DRYRUN_ENABLED not true (fail-closed)' });
    return { exitCode: EXIT.config, summary: { error: 'dryrun not enabled' } };
  }
  const scenario = String(input.dryrun?.scenario ?? 'success');
  const key = input.dryrun?.key ?? `dryrun-${correlationId}`;
  const [
    { executeCapability },
    { makeDryrunAdapter, DRYRUN_PROVIDER },
    { DRYRUN_READ_TEST, DRYRUN_WRITE_TEST },
    { deriveSideEffectId },
    { reconcileSideEffect },
    { readApprovalRecord },
  ] = await Promise.all([
    import('../lib/ai-os/capabilities/executor'),
    import('../lib/ai-os/capabilities/dryrun-adapter'),
    import('../lib/ai-os/capabilities/registry'),
    import('../lib/ai-os/capabilities/contract'),
    import('../lib/ai-os/capabilities/ledger-store'),
    import('../lib/ai-os/orchestration/store'),
  ]);
  if (scenario === 'reconcile') {
    const sideEffectId = deriveSideEffectId(key);
    const rec = await reconcileSideEffect(
      client, sideEffectId, 'succeeded', `dryrun-reconciled-${correlationId}`,
      `reconcile:dryrun:${correlationId}`, input.now);
    log({ level: rec.ok ? 'info' : 'error', command, correlationId, event: 'capability_dryrun', scenario, side_effect_id: sideEffectId, reconciled: rec.ok, ...(rec.ok ? {} : { error: rec.error }) });
    return { exitCode: rec.ok ? EXIT.ok : EXIT.error, summary: { scenario, side_effect_id: sideEffectId, reconciled: rec.ok } };
  }
  const gated = scenario === 'gated';
  const outcomes: Record<string, string> = {
    terminal: 'terminal', retryable: 'retryable', uncertain: 'uncertain',
  };
  const deps = {
    client,
    adapters: { [DRYRUN_PROVIDER]: makeDryrunAdapter() },
    actorId: env['WORKER_AGENT_ID'] ?? 'preston-worker',
    ownerIdentity: String(env['ORCH_OWNER_IDENTITY'] ?? ''),
    now: () => Date.now(),
    readApproval: readApprovalRecord,
    log: (fields: Record<string, unknown>) => log({ level: 'info', command, correlationId, ...fields }),
  };
  const request = {
    capability: gated ? DRYRUN_WRITE_TEST : DRYRUN_READ_TEST,
    version: 1,
    target: 'dryrun:echo',
    params: { outcome: outcomes[scenario] ?? 'success' },
    goal_id: 'dryrun-goal', job_id: 'dryrun-job', run_id: correlationId,
    request_id: `req-${key}`, idempotency_key: key,
  };
  const first = await executeCapability(deps, request);
  let second = null;
  if (scenario === 'duplicate') second = await executeCapability(deps, request);
  const summary = {
    scenario,
    side_effect_id: first.side_effect_id,
    first: { ok: first.ok, error: first.error, summary: first.summary },
    ...(second ? {
      second: { ok: second.ok, error: second.error, summary: second.summary },
      same_row: second.side_effect_id === first.side_effect_id,
    } : {}),
  };
  log({ level: 'info', command, correlationId, event: 'capability_dryrun', ...summary });
  return { exitCode: EXIT.ok, summary };
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

    if (command === 'orchestrate-once') {
      return await orchestrateOnce(input);
    }

    if (command === 'capability-dryrun') {
      return await capabilityDryrun(input);
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
    // Phase 8: one bounded, idempotent orchestration STATUS observation per
    // run (goals/approvals/failures aggregates -> orchestration_decisions).
    // Read-only; approval_attention surfaces when an owner decision waits.
    let orch: { status: string; approval_attention: boolean; recorded: boolean } | null = null;
    try {
      const o = await hermesObserveOrchestration(client, now);
      orch = { status: o.status, approval_attention: o.approval_attention, recorded: o.recorded };
    } catch { orch = null; }
    // Fast-track Phase H: observe -> evaluate -> needs_attention -> notifier
    // -> owner. Hermes keeps ZERO execution authority; the notifier is fully
    // inert until the owner activates the Telegram env on this host, dedups
    // durably (one send per event, ever), and a notification failure never
    // affects orchestration.
    let notify: { configured: boolean; candidates: number; sent: number; deduped: number; errors: string[] } | null = null;
    try {
      notify = await notifyAttentionOnce(
        client, env, now,
        (text) => runtimeNotifyOwner(text, env),
      );
    } catch { notify = null; }
    // P0.1 (2026-08-26): orchestration_recorded surfaces a SILENT status-row
    // insert failure (RLS/CHECK) that previously left no trace - the bucket
    // simply stopped advancing with every tick "clean".
    log({
      level: 'info', command, correlationId, event: 'hermes_loop',
      rounds: res.rounds, stoppedReason: res.stoppedReason, recorded: res.totalRecorded,
      ...(orch ? {
        orchestration_status: orch.status,
        orchestration_recorded: orch.recorded,
        ...(orch.approval_attention ? { approval_attention: true } : {}),
      } : {}),
      ...(notify?.configured ? {
        notify_sent: notify.sent, notify_deduped: notify.deduped,
        notify_candidates: notify.candidates,
        ...(notify.errors.length ? { notify_errors: notify.errors.slice(0, 5) } : {}),
      } : {}),
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
