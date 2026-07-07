import { describe, expect, it } from 'vitest';
import {
  authorizeRemoteRun,
  canRollback,
  controlSurfaceProof,
  heartbeatStale,
  ownerStopRequested,
  remoteRunnerEnabled,
  runtimeExceeded,
  simulateDryRun,
  MAX_RUNTIME_CAP_SECONDS,
  type DryRunTick,
} from '../src/lib/remote-control';

// Env with the runner fully enabled (still dry-run only in Phase 4).
const ENABLED = {
  DISABLE_ALL_AI_WRITES: 'false',
  DISABLE_REMOTE_RUNNER: 'false',
  REMOTE_RUNNER_ENABLED: 'true',
};

const START = '2026-07-06T12:00:00.000Z';
const at = (secondsFromStart: number) =>
  new Date(new Date(START).getTime() + secondsFromStart * 1000).toISOString();

describe('remote control - enable gating (disabled by default)', () => {
  it('is disabled with no env (fail-closed)', () => {
    expect(remoteRunnerEnabled({})).toBe(false);
  });
  it('is disabled when shutoff not explicitly cleared', () => {
    expect(remoteRunnerEnabled({ REMOTE_RUNNER_ENABLED: 'true' })).toBe(false);
  });
  it('is disabled when enable flag absent', () => {
    expect(remoteRunnerEnabled({ DISABLE_REMOTE_RUNNER: 'false' })).toBe(false);
  });
  it('is enabled only when shutoff false AND explicit enable true', () => {
    expect(remoteRunnerEnabled(ENABLED)).toBe(true);
  });
});

describe('remote control - authorization (fail-closed, dry-run only)', () => {
  const req = { task_id: 'run-1', max_runtime_seconds: 60, requested_mode: 'dry_run' as const };

  it('blocks by default (no env)', () => {
    const a = authorizeRemoteRun(req, { env: {}, now: START });
    expect(a.authorized).toBe(false);
    expect(a.audit.event).toBe('run_blocked');
  });
  it('blocks under master kill', () => {
    const a = authorizeRemoteRun(req, { env: { ...ENABLED, DISABLE_ALL_AI_WRITES: 'true' }, now: START });
    expect(a.authorized).toBe(false);
    expect(a.reason).toContain('DISABLE_ALL_AI_WRITES');
  });
  it('blocks when owner stop is active', () => {
    const a = authorizeRemoteRun(req, { env: { ...ENABLED, OWNER_STOP: 'true' }, now: START });
    expect(a.authorized).toBe(false);
    expect(a.reason).toContain('owner stop');
  });
  it('blocks a zero or negative max runtime', () => {
    const a = authorizeRemoteRun({ ...req, max_runtime_seconds: 0 }, { env: ENABLED, now: START });
    expect(a.authorized).toBe(false);
  });
  it('blocks a max runtime over the Phase 4 cap', () => {
    const a = authorizeRemoteRun(
      { ...req, max_runtime_seconds: MAX_RUNTIME_CAP_SECONDS + 1 },
      { env: ENABLED, now: START },
    );
    expect(a.authorized).toBe(false);
  });
  it('authorizes a bounded dry-run when fully enabled', () => {
    const a = authorizeRemoteRun(req, { env: ENABLED, now: START });
    expect(a.authorized).toBe(true);
    expect(a.mode).toBe('dry_run');
    expect(a.audit.production_touched).toBe(false);
  });
  it('downgrades a LIVE request to dry-run (never live in Phase 4)', () => {
    const a = authorizeRemoteRun(
      { ...req, requested_mode: 'live' },
      { env: ENABLED, now: START },
    );
    expect(a.mode).toBe('dry_run');
    expect(a.reason).toContain('blocked in Phase 4');
  });
});

describe('remote control - envelope primitives', () => {
  it('heartbeatStale: fresh within threshold, stale beyond', () => {
    expect(heartbeatStale(START, at(30), 30, 2)).toBe(false); // 30s <= 60s
    expect(heartbeatStale(START, at(90), 30, 2)).toBe(true); // 90s > 60s
  });
  it('runtimeExceeded: within and beyond', () => {
    expect(runtimeExceeded(START, at(30), 60)).toBe(false);
    expect(runtimeExceeded(START, at(61), 60)).toBe(true);
  });
  it('ownerStopRequested reads OWNER_STOP', () => {
    expect(ownerStopRequested({ OWNER_STOP: 'true' })).toBe(true);
    expect(ownerStopRequested({})).toBe(false);
  });
  it('canRollback requires reversible + a note', () => {
    expect(canRollback({ change_id: 'c1', rollback_note: 'git revert c1', reversible: true })).toBe(true);
    expect(canRollback({ change_id: 'c1', rollback_note: '', reversible: true })).toBe(false);
    expect(canRollback({ change_id: 'c1', rollback_note: 'x', reversible: false })).toBe(false);
  });
});

describe('remote control - dry-run simulator (never runs a real process)', () => {
  const healthy: DryRunTick[] = [
    { now: at(10), beatAt: at(10) },
    { now: at(20), beatAt: at(20) },
    { now: at(30), beatAt: at(30) },
  ];

  it('completes a healthy bounded run in dry-run mode', () => {
    const r = simulateDryRun({
      task_id: 't', startedAt: START, maxRuntimeSeconds: 60,
      heartbeatIntervalSeconds: 30, ticks: healthy,
    });
    expect(r.mode).toBe('dry_run');
    expect(r.halted).toBe(false);
    expect(r.ticksProcessed).toBe(3);
    expect(r.audit.every((e) => e.production_touched === false)).toBe(true);
  });

  it('halts on owner stop', () => {
    const r = simulateDryRun({
      task_id: 't', startedAt: START, maxRuntimeSeconds: 600,
      heartbeatIntervalSeconds: 30,
      ticks: [{ now: at(10), beatAt: at(10) }, { now: at(20), ownerStop: true }],
    });
    expect(r.halted).toBe(true);
    expect(r.haltReason).toBe('owner stop');
  });

  it('halts when max runtime is exceeded', () => {
    const r = simulateDryRun({
      task_id: 't', startedAt: START, maxRuntimeSeconds: 25,
      heartbeatIntervalSeconds: 30,
      ticks: [{ now: at(10), beatAt: at(10) }, { now: at(30), beatAt: at(30) }],
    });
    expect(r.halted).toBe(true);
    expect(r.haltReason).toBe('max runtime exceeded');
  });

  it('halts when the heartbeat goes stale', () => {
    const r = simulateDryRun({
      task_id: 't', startedAt: START, maxRuntimeSeconds: 600,
      heartbeatIntervalSeconds: 30,
      ticks: [{ now: at(10), beatAt: at(10) }, { now: at(120) }], // no beat, 110s gap
    });
    expect(r.halted).toBe(true);
    expect(r.haltReason).toBe('heartbeat stale');
  });
});

describe('remote control - proof surface (honest status)', () => {
  it('reports every control implemented locally but not yet proven remotely', () => {
    const proof = controlSurfaceProof();
    expect(proof.length).toBeGreaterThanOrEqual(8);
    expect(proof.every((p) => p.implemented)).toBe(true);
    expect(proof.every((p) => p.proven_remotely === false)).toBe(true);
  });
});
