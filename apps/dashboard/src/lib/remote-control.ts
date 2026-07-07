import { isDisabled } from './guards';

// Remote-live control surface - Phase 4 GREEN local build. Implements the
// SAFETY ENVELOPE that must exist BEFORE any remote autonomy: disabled-by-
// default runner, emergency shutoff, heartbeat, max-runtime, owner stop,
// rollback, audit shaping, and a dry-run simulator. Hard rule: NOTHING here
// runs a real remote process. Live remote runs are blocked in Phase 4; the
// surface only ever decides and simulates. See
// docs/PRESTON_AI_REMOTE_LIVE_READINESS_PLAN_v1.md.

type Env = Record<string, string | undefined>;

export type RunMode = 'dry_run' | 'live';

// Phase 4 hard cap on any single run, even a dry-run simulation.
export const MAX_RUNTIME_CAP_SECONDS = 900;
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;

export interface RemoteRunRequest {
  task_id: string;
  max_runtime_seconds: number;
  requested_mode: RunMode;
}

export interface RunAuditEvent {
  at: string;
  task_id: string;
  event:
    | 'run_blocked'
    | 'run_authorized_dry_run'
    | 'tick_ok'
    | 'halt_owner_stop'
    | 'halt_max_runtime'
    | 'halt_heartbeat_stale';
  reason: string;
  mode: RunMode;
  production_touched: boolean;
  write_actions_performed: boolean;
}

export interface RunAuthorization {
  authorized: boolean;
  mode: RunMode; // always 'dry_run' in Phase 4
  reason: string;
  audit: RunAuditEvent;
}

export interface RollbackPlan {
  change_id: string;
  rollback_note: string;
  reversible: boolean;
}

export interface ProofItem {
  key: string;
  label: string;
  implemented: boolean;
  proven_remotely: boolean;
  note: string;
}

// ---- Enable gating (fail-closed, disabled by default) ----

// The remote runner is enabled ONLY when the shutoff flag is explicitly
// 'false' AND an explicit enable flag is 'true'. Missing/any-other = disabled.
export function remoteRunnerEnabled(env: Env): boolean {
  const shutoffClear = !isDisabled('DISABLE_REMOTE_RUNNER', env);
  const explicitEnable = env['REMOTE_RUNNER_ENABLED'] === 'true';
  return shutoffClear && explicitEnable;
}

export function ownerStopRequested(env: Env): boolean {
  return env['OWNER_STOP'] === 'true';
}

// ---- Envelope primitives ----

function elapsedSeconds(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000;
}

// Stale if more than `missedThreshold` intervals have passed with no beat.
export function heartbeatStale(
  lastBeatAt: string,
  now: string,
  intervalSeconds: number = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  missedThreshold: number = 2,
): boolean {
  return elapsedSeconds(lastBeatAt, now) > intervalSeconds * missedThreshold;
}

export function runtimeExceeded(
  startedAt: string,
  now: string,
  maxRuntimeSeconds: number,
): boolean {
  return elapsedSeconds(startedAt, now) > maxRuntimeSeconds;
}

export function canRollback(plan: RollbackPlan): boolean {
  return plan.reversible && plan.rollback_note.trim() !== '';
}

// ---- Authorization (fail-closed; Phase 4 forces dry-run) ----

export function authorizeRemoteRun(
  req: RemoteRunRequest,
  opts?: { env?: Env; now?: string },
): RunAuthorization {
  const env = opts?.env ?? {};
  const now = opts?.now ?? '';
  const mk = (
    event: RunAuditEvent['event'],
    reason: string,
    mode: RunMode,
  ): RunAuditEvent => ({
    at: now,
    task_id: req.task_id,
    event,
    reason,
    mode,
    production_touched: false,
    write_actions_performed: false,
  });
  const block = (reason: string): RunAuthorization => ({
    authorized: false,
    mode: 'dry_run',
    reason,
    audit: mk('run_blocked', reason, 'dry_run'),
  });

  if (isDisabled('DISABLE_ALL_AI_WRITES', env)) {
    return block('emergency shutoff: DISABLE_ALL_AI_WRITES blocks the runner');
  }
  if (isDisabled('DISABLE_REMOTE_RUNNER', env)) {
    return block('remote runner disabled (DISABLE_REMOTE_RUNNER not false)');
  }
  if (env['REMOTE_RUNNER_ENABLED'] !== 'true') {
    return block('remote runner not explicitly enabled');
  }
  if (ownerStopRequested(env)) {
    return block('owner stop is active');
  }
  if (!(req.max_runtime_seconds > 0)) {
    return block('max_runtime_seconds must be greater than 0');
  }
  if (req.max_runtime_seconds > MAX_RUNTIME_CAP_SECONDS) {
    return block('max_runtime_seconds exceeds Phase 4 cap of ' + MAX_RUNTIME_CAP_SECONDS);
  }
  // Phase 4: live remote execution is NEVER authorized. A live request is
  // downgraded to dry-run; only a bounded simulation may proceed.
  const reason =
    req.requested_mode === 'live'
      ? 'live remote runs are blocked in Phase 4; authorized as dry-run only'
      : 'authorized (dry-run only)';
  return {
    authorized: true,
    mode: 'dry_run',
    reason,
    audit: mk('run_authorized_dry_run', reason, 'dry_run'),
  };
}

// ---- Dry-run simulator (local only; never runs a real process) ----

export interface DryRunTick {
  now: string;
  ownerStop?: boolean;
  beatAt?: string; // a heartbeat observed at this tick
}

export interface DryRunInput {
  task_id: string;
  startedAt: string;
  maxRuntimeSeconds: number;
  heartbeatIntervalSeconds?: number;
  ticks: DryRunTick[];
}

export interface DryRunResult {
  mode: 'dry_run';
  halted: boolean;
  haltReason?: string;
  ticksProcessed: number;
  audit: RunAuditEvent[];
}

export function simulateDryRun(input: DryRunInput): DryRunResult {
  const interval = input.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
  const audit: RunAuditEvent[] = [];
  const ev = (
    now: string,
    event: RunAuditEvent['event'],
    reason: string,
  ): RunAuditEvent => ({
    at: now,
    task_id: input.task_id,
    event,
    reason,
    mode: 'dry_run',
    production_touched: false,
    write_actions_performed: false,
  });

  let lastBeat = input.startedAt;
  let i = 0;
  for (const t of input.ticks) {
    i++;
    if (t.beatAt) lastBeat = t.beatAt;

    if (t.ownerStop) {
      audit.push(ev(t.now, 'halt_owner_stop', 'owner stop signal'));
      return { mode: 'dry_run', halted: true, haltReason: 'owner stop', ticksProcessed: i, audit };
    }
    if (runtimeExceeded(input.startedAt, t.now, input.maxRuntimeSeconds)) {
      audit.push(ev(t.now, 'halt_max_runtime', 'max runtime exceeded'));
      return {
        mode: 'dry_run',
        halted: true,
        haltReason: 'max runtime exceeded',
        ticksProcessed: i,
        audit,
      };
    }
    if (heartbeatStale(lastBeat, t.now, interval)) {
      audit.push(ev(t.now, 'halt_heartbeat_stale', 'heartbeat stale'));
      return {
        mode: 'dry_run',
        halted: true,
        haltReason: 'heartbeat stale',
        ticksProcessed: i,
        audit,
      };
    }
    audit.push(ev(t.now, 'tick_ok', 'healthy tick'));
  }
  return { mode: 'dry_run', halted: false, ticksProcessed: i, audit };
}

// ---- Proof surface (honest: implemented locally, not yet proven remotely) ----

export function controlSurfaceProof(): ProofItem[] {
  const item = (
    key: string,
    label: string,
    note: string,
  ): ProofItem => ({ key, label, implemented: true, proven_remotely: false, note });
  return [
    item('remote_disabled_default', 'Remote runner disabled by default', 'double-gated: shutoff false AND explicit enable'),
    item('emergency_shutoff', 'Emergency shutoff', 'DISABLE_ALL_AI_WRITES + DISABLE_REMOTE_RUNNER fail-closed'),
    item('heartbeat', 'Heartbeat', 'stale heartbeat halts the run'),
    item('max_runtime', 'Max runtime', 'bounded by request + Phase 4 cap ' + MAX_RUNTIME_CAP_SECONDS + 's'),
    item('owner_stop', 'Owner stop', 'OWNER_STOP halts immediately'),
    item('rollback', 'Rollback', 'reversible change + rollback note required'),
    item('audit_log', 'Audit log', 'every decision/tick/halt emits an audit event'),
    item('dry_run_only', 'Dry-run only', 'live remote execution blocked in Phase 4'),
  ];
}
