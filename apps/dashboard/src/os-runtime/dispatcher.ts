import { randomUUID } from 'node:crypto';
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
import {
  probeControls,
  readSystemControls,
  readSystemControlsChecked,
  type RuntimeClient,
} from '../lib/ai-os/store';
import {
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
  readApprovalRecord,
} from '../lib/ai-os/orchestration/store';
import { isMigrationAbsentError } from '../lib/ai-os/orchestration/read-model';
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
  | 'orchestrate-once';

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
} {
  const cmd = argv[2];
  const command: DispatcherCommand =
    cmd === 'worker-loop' ? 'worker-loop'
      : cmd === 'hermes-loop' ? 'hermes-loop'
        : cmd === 'db-health' ? 'db-health'
          : cmd === 'orchestrate-once' ? 'orchestrate-once'
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

// --- orchestrate-once (Phase 7 goal driving; SIMULATION ONLY) ---------------

// Statuses the durable driver can make progress on. 'proposed' is non-terminal
// but NOT driveable: decomposition is an owner/dashboard action, and driving a
// job-less goal would only burn its bounded iteration budget.
const DRIVEABLE_GOAL_STATUSES = ['decomposed', 'running', 'blocked'] as const;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'cancelled', 'dead_lettered']);
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
  if (ctl.controls.execution_enabled || ctl.controls.remote_runner_enabled) {
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', error: 'unsafe posture: execution/remote runner enabled (simulation-only command refused)' });
    return { exitCode: EXIT.config, summary: { error: 'unsafe controls posture' } };
  }

  // GLOBAL simulation-pin probe (Codex final-review MAJOR #2): if ANY goal
  // row anywhere carries simulation_only=false, the schema pins have drifted
  // (0010 CHECK forbids it) - refuse the whole run, not just windowed rows.
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

  // Deterministic single-goal selection (fail-closed on every ambiguity).
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
    (r) => r.simulation_only !== true || String(r.environment) !== 'staging',
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
  const selected = [...driveable].sort((a, b) => (selKey(a) < selKey(b) ? -1 : 1))[0];
  const goalId = String(selected.id);

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

  // Parked fast path: when EVERY non-terminal job is awaiting an owner
  // approval and no linked approval record even CLAIMS to be approved, driving
  // would only burn one goal iteration per timer tick while the owner decides.
  // Skip cleanly. If any record claims 'approved' (or a job has no linked
  // record at all worth checking), drive - the driver's authoritative
  // verification (hash/owner/scope/nonce/expiry) is the only unlock authority.
  const jobsRes = await listJobsForGoal(client, goalId, JOB_READ_LIMIT);
  if (!jobsRes.ok) {
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', goal: goalId, error: 'jobs unreadable: ' + jobsRes.error });
    return { exitCode: EXIT.error, summary: { error: 'jobs unreadable', goal: goalId } };
  }
  if (jobsRes.rows.length > MAX_GOAL_JOBS) {
    // More rows than the model/DB bound allows: completeness is unprovable
    // (Codex CRITICAL #1). Refuse rather than risk finalizing a partial graph.
    log({ level: 'error', command, correlationId, event: 'orchestrate_once', goal: goalId, error: 'job read exceeded the model bound; completeness unprovable (fail-closed)' });
    return { exitCode: EXIT.error, summary: { error: 'job graph overflow', goal: goalId } };
  }
  const nonTerminal = jobsRes.rows.filter((j) => !TERMINAL_JOB_STATUSES.has(String(j.status)));
  const allParked = nonTerminal.length > 0 &&
    nonTerminal.every((j) => String(j.status) === 'awaiting_approval');
  if (allParked) {
    let anyClaimsApproved = false;
    for (const j of nonTerminal) {
      const approvalId = j.approval_id ? String(j.approval_id) : '';
      if (!approvalId) continue; // parked with nothing decidable yet
      const record = await readApprovalRecord(client, approvalId);
      if (record && String(record.status) === 'approved') { anyClaimsApproved = true; break; }
    }
    if (!anyClaimsApproved) {
      log({ level: 'info', command, correlationId, event: 'orchestrate_once', goal: goalId, stoppedReason: 'awaiting_owner_approval', skipped: true });
      return { exitCode: EXIT.ok, summary: { goal: goalId, stoppedReason: 'awaiting_owner_approval', skipped: true } };
    }
  }

  // Drive one bounded pass. The per-invocation lock-token seed makes every
  // worktree ownership token unique to THIS invocation; run ids are minted by
  // the driver (crypto-random) unless a test injects a deterministic seam.
  const seed = seams.lockTokenSeed();
  const lockCtx: DriverLockContext = {
    base_commit: baseCommit,
    allowed_paths: allowedPaths,
    token: (jobId: string) => `orch-${seed}-${jobId}`,
  };
  // An undefined newRunId falls through to driveGoal's own default: the
  // driver mints crypto-random run ids (node:crypto randomUUID).
  const r = await driveGoal(
    client, goalId, seams.clock, input.maxIterations ?? 5, depends, lockCtx,
    seams.newRunId,
  );
  log({ level: 'info', command, correlationId, event: 'orchestrate_once', goal: goalId, cycles: r.cycles, halted: r.halted, reason: r.reason });

  if (r.halted) {
    if (r.reason.includes('owner_stop')) {
      // Owner halt (stop/pause) - the intended operational halt state.
      return { exitCode: EXIT.halted, summary: { goal: goalId, cycles: r.cycles, stoppedReason: r.reason } };
    }
    if (r.reason.includes('controls_unreadable')) {
      // Control-plane outage, NOT an owner decision (Codex MINOR #7).
      return { exitCode: EXIT.error, summary: { goal: goalId, error: r.reason } };
    }
    if (r.reason === 'iteration_reserved_by_other') {
      // A concurrent worker holds this cycle - clean skip, not a failure.
      return { exitCode: EXIT.ok, summary: { goal: goalId, cycles: r.cycles, stoppedReason: 'lease_conflict_skip' } };
    }
    if (r.reason === 'lock_context_required') {
      return { exitCode: EXIT.config, summary: { goal: goalId, error: r.reason } };
    }
    if (['goal_not_found', 'iteration_reserve_error', 'execution_clock_invalid'].includes(r.reason)) {
      return { exitCode: EXIT.error, summary: { goal: goalId, error: r.reason } };
    }
    // Cycle budget exhausted mid-goal: progress is persisted; the next bounded
    // invocation resumes from the durable state (restart-safe by design).
    return { exitCode: EXIT.ok, summary: { goal: goalId, cycles: r.cycles, stoppedReason: 'cycle_budget_exhausted', lastReason: r.reason } };
  }
  return { exitCode: EXIT.ok, summary: { goal: goalId, cycles: r.cycles, stoppedReason: r.reason } };
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
