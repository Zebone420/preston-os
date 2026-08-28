// Owner-approved timeout work unit (2026-08-28): ORCH_REAL_TIMEOUT_MS - the
// bounded, fail-closed, owner-set real-worker timeout shared by BOTH real
// adapters, with the run lease DERIVED from the same value (timeout + fixed
// margin) so a configured timeout can never outlive the lease protecting its
// run. These pins prove: env absent = prior behavior, valid override works,
// out-of-range and malformed values fail closed, the compiled ceiling holds,
// the test seam keeps precedence, both providers follow one policy, and the
// retryable timeout lifecycle is untouched.

import { describe, expect, it } from 'vitest';
import {
  REAL_TIMEOUT_ABS_MAX_MS,
  REAL_TIMEOUT_DEFAULT_MS,
  REAL_TIMEOUT_ENV,
  REAL_TIMEOUT_MIN_MS,
  RUN_LEASE_MARGIN_MS,
  resolveRealTimeoutMs,
  resolveRunLeaseMs,
} from '../src/lib/ai-os/real-timeout';
import {
  clampTimeoutMs,
  runRealClaudeJob,
  REAL_CLAUDE_DEFAULT_TIMEOUT_MS,
  REAL_CLAUDE_MAX_TIMEOUT_MS,
  type ProcessOutcome,
  type ProcessRunner,
  type ProcessSpec,
  type RealClaudeJobInput,
} from '../src/lib/ai-os/real-claude-adapter';
import {
  runRealCodexJob,
  type RealCodexJobInput,
} from '../src/lib/ai-os/real-codex-adapter';
import { classifyFailure } from '../src/lib/ai-os/orchestration/outcomes';
import type { SystemControls } from '../src/lib/ai-os/controls';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';
import type { WorktreeLock } from '../src/lib/ai-os/orchestration/worktree-lock';

const MIN = 60_000; // 1 minute floor
const DEFAULT = 600_000; // 10 minutes (prior behavior)
const ABS_MAX = 3_600_000; // 60 minutes compiled ceiling

describe('resolveRealTimeoutMs - fail-closed owner knob', () => {
  it('compiled bounds are exactly the documented values', () => {
    expect(REAL_TIMEOUT_MIN_MS).toBe(MIN);
    expect(REAL_TIMEOUT_DEFAULT_MS).toBe(DEFAULT);
    expect(REAL_TIMEOUT_ABS_MAX_MS).toBe(ABS_MAX);
    expect(REAL_TIMEOUT_ENV).toBe('ORCH_REAL_TIMEOUT_MS');
  });

  it('env absent or blank -> the prior default (10 min)', () => {
    expect(resolveRealTimeoutMs({})).toBe(DEFAULT);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: undefined })).toBe(DEFAULT);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: '' })).toBe(DEFAULT);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: '   ' })).toBe(DEFAULT);
  });

  it('valid bounded override is honored (milliseconds)', () => {
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: '900000' })).toBe(900_000);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: String(MIN) })).toBe(MIN);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: String(ABS_MAX) })).toBe(ABS_MAX);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: ' 1800000 ' })).toBe(1_800_000);
  });

  it('below the minimum fails closed to the default (never a crippling timeout)', () => {
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: String(MIN - 1) })).toBe(DEFAULT);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: '1' })).toBe(DEFAULT);
  });

  it('above the compiled ceiling clamps to the ceiling (never unbounded)', () => {
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: String(ABS_MAX + 1) })).toBe(ABS_MAX);
    expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: '999999999999' })).toBe(ABS_MAX);
  });

  it('malformed, negative, zero, NaN, float, exponent, hex all fail closed to default', () => {
    for (const bad of ['abc', '-5', '0', 'NaN', 'Infinity', '12.5', '1e5',
      '0x1000', '600000ms', '10m', '+600000', '6_00_000', 'null']) {
      expect(resolveRealTimeoutMs({ [REAL_TIMEOUT_ENV]: bad })).toBe(DEFAULT);
    }
  });
});

describe('resolveRunLeaseMs - the lease always outlives the timeout', () => {
  it('lease = resolved timeout + fixed positive margin, for EVERY config shape', () => {
    expect(RUN_LEASE_MARGIN_MS).toBeGreaterThan(0);
    for (const v of [undefined, '', 'abc', '0', '-1', '1', String(MIN),
      '900000', String(DEFAULT), String(ABS_MAX), String(ABS_MAX * 10)]) {
      const env = v === undefined ? {} : { [REAL_TIMEOUT_ENV]: v };
      const timeout = resolveRealTimeoutMs(env);
      const lease = resolveRunLeaseMs(env);
      expect(lease - timeout).toBe(RUN_LEASE_MARGIN_MS);
      expect(lease).toBeGreaterThan(timeout); // never expires under the child
    }
  });

  it('worst-case lease is bounded too (ceiling + margin)', () => {
    expect(resolveRunLeaseMs({ [REAL_TIMEOUT_ENV]: '999999999999' }))
      .toBe(ABS_MAX + RUN_LEASE_MARGIN_MS);
  });
});

describe('clampTimeoutMs - the compiled clamp (test-seam path)', () => {
  it('default and ceiling now reference the shared compiled bounds', () => {
    expect(REAL_CLAUDE_DEFAULT_TIMEOUT_MS).toBe(DEFAULT);
    expect(REAL_CLAUDE_MAX_TIMEOUT_MS).toBe(ABS_MAX);
    expect(clampTimeoutMs(undefined)).toBe(DEFAULT);
    expect(clampTimeoutMs(ABS_MAX + 1)).toBe(ABS_MAX);
    expect(clampTimeoutMs(20 * 60 * 1000)).toBe(20 * 60 * 1000);
  });
});

// --- adapter plumb: both providers follow the ONE shared policy -------------

const NOW = '2026-08-28T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const LATER = '2026-08-28T12:30:00.000Z';
const ROOT = '/srv/worktrees';
const WT = '/srv/worktrees/wt-job-00000001';

function controls(): { controls: SystemControls; readOk: boolean } {
  return {
    controls: {
      execution_enabled: true, owner_stop: false, paused: false,
      hermes_mode: 'observe_only', remote_runner_enabled: true, updated_at: NOW,
    },
    readOk: true,
  };
}

function job(role: 'claude' | 'codex'): GoalJob {
  return {
    id: 'job-00000001', goal_id: 'goal-00000001', kind: 'documentation',
    title: 'draft note', objective: 'draft an internal note safely',
    risk_class: 'GREEN', assigned_role: role, depends_on: [],
    status: 'in_progress', attempts: 0, requires_approval: false,
    approval_id: null, runtime_job_id: null, correlation_id: 'corr-0001',
    evidence_refs: [], failure_reason: null,
    run_id: 'job-00000001:run-1', run_lease_expires_at: LATER,
    created_at: NOW, updated_at: NOW,
  };
}

function lock(owner: 'claude' | 'codex'): WorktreeLock {
  return {
    worktree_id: 'wt-job-00000001', repo: 'preston-os',
    job_id: 'job-00000001', owner, token: 'tok-00000001', fence: 1,
    base_commit: 'abc1234', branch: 'wt/job-00000001',
    allowed_paths: ['apps/dashboard/'], acquired_at: NOW, expires_at: LATER,
  };
}

function fakeRunner() {
  const calls: ProcessSpec[] = [];
  const runner: ProcessRunner = async (spec) => {
    calls.push(spec);
    const out: ProcessOutcome = {
      spawned: true, exit_code: 0, timed_out: false, truncated: false,
      stdout: 'done', stderr: '', error: null, duration_ms: 5,
      child_env_keys: [], child_home: null,
    } as ProcessOutcome;
    return out;
  };
  return { calls, runner };
}

function claudeInput(
  env: Record<string, string | undefined>,
  runner: ProcessRunner,
  timeoutMs?: number,
): RealClaudeJobInput {
  return {
    env: {
      ORCH_REAL_CLAUDE_ENABLED: 'true', DISABLE_REMOTE_RUNNER: 'false',
      SUPABASE_RUNTIME_ENV: 'staging', ORCH_BASE_COMMIT: 'abc1234',
      ORCH_ALLOWED_PATHS: 'apps/dashboard/', ORCH_WORKTREES_ROOT: ROOT,
      ORCH_CLAUDE_EXECUTABLE: '/opt/claude/bin/claude', ...env,
    },
    controls: controls(),
    goal: { requested_by: 'owner@preston.nyc', environment: 'staging', simulation_only: true },
    job: job('claude'), runId: 'job-00000001:run-1', nowMs: NOW_MS,
    lock: lock('claude'), worktreePath: WT, treeDirty: false,
    fileExists: () => true, realpath: (p) => p, runner,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function codexInput(
  env: Record<string, string | undefined>,
  runner: ProcessRunner,
  timeoutMs?: number,
): RealCodexJobInput {
  return {
    env: {
      ORCH_REAL_CODEX_ENABLED: 'true', DISABLE_REMOTE_RUNNER: 'false',
      SUPABASE_RUNTIME_ENV: 'staging', ORCH_BASE_COMMIT: 'abc1234',
      ORCH_ALLOWED_PATHS: 'apps/dashboard/', ORCH_WORKTREES_ROOT: ROOT,
      ORCH_CODEX_EXECUTABLE: '/opt/codex/bin/codex', ...env,
    },
    controls: controls(),
    goal: { requested_by: 'owner@preston.nyc', environment: 'staging', simulation_only: true },
    job: job('codex'), runId: 'job-00000001:run-1', nowMs: NOW_MS,
    lock: lock('codex'), worktreePath: WT, treeDirty: false,
    fileExists: () => true, realpath: (p) => p, runner,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

describe('adapter plumb - env knob reaches the process spec, seam wins, both providers', () => {
  it('claude: env absent -> spec.timeout_ms is the prior 10-min default', async () => {
    const f = fakeRunner();
    await runRealClaudeJob(claudeInput({}, f.runner));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].timeout_ms).toBe(DEFAULT);
  });

  it('claude: valid env override -> spec.timeout_ms is the configured value', async () => {
    const f = fakeRunner();
    await runRealClaudeJob(claudeInput({ [REAL_TIMEOUT_ENV]: '2700000' }, f.runner));
    expect(f.calls[0].timeout_ms).toBe(2_700_000); // 45 min
  });

  it('claude: malformed env NEVER widens execution (falls to default)', async () => {
    for (const bad of ['unbounded', '-1', '999999999999x']) {
      const f = fakeRunner();
      await runRealClaudeJob(claudeInput({ [REAL_TIMEOUT_ENV]: bad }, f.runner));
      expect(f.calls[0].timeout_ms).toBe(DEFAULT);
    }
  });

  it('claude: an over-ceiling env value is clamped to the compiled maximum', async () => {
    const f = fakeRunner();
    await runRealClaudeJob(claudeInput({ [REAL_TIMEOUT_ENV]: '86400000' }, f.runner));
    expect(f.calls[0].timeout_ms).toBe(ABS_MAX); // 24h requested -> 60 min
  });

  it('claude: the test seam keeps precedence over the env knob', async () => {
    const f = fakeRunner();
    await runRealClaudeJob(
      claudeInput({ [REAL_TIMEOUT_ENV]: '2700000' }, f.runner, 30_000));
    expect(f.calls[0].timeout_ms).toBe(30_000);
  });

  it('codex: identical policy - default, override, malformed, clamp, seam', async () => {
    const cases: Array<[Record<string, string>, number | undefined, number]> = [
      [{}, undefined, DEFAULT],
      [{ [REAL_TIMEOUT_ENV]: '2700000' }, undefined, 2_700_000],
      [{ [REAL_TIMEOUT_ENV]: 'bogus' }, undefined, DEFAULT],
      [{ [REAL_TIMEOUT_ENV]: '86400000' }, undefined, ABS_MAX],
      [{ [REAL_TIMEOUT_ENV]: '2700000' }, 30_000, 30_000],
    ];
    for (const [env, seam, want] of cases) {
      const f = fakeRunner();
      await runRealCodexJob(codexInput(env, f.runner, seam));
      expect(f.calls[0].timeout_ms).toBe(want);
    }
  });
});

describe('timeout lifecycle semantics are UNCHANGED', () => {
  it('a timed-out run still classifies RETRYABLE (bounded retry, then dead-letter)', () => {
    expect(classifyFailure('timeout')).toEqual(
      { outcome_class: 'RETRYABLE', reason: 'retryable:timeout' });
    expect(classifyFailure('real_required:timeout')).toEqual(
      { outcome_class: 'RETRYABLE', reason: 'retryable:real_required:timeout' });
  });

  it('a timed-out claude run still maps outcome timed_out / executed false', async () => {
    const calls: ProcessSpec[] = [];
    const runner: ProcessRunner = async (spec) => {
      calls.push(spec);
      return {
        spawned: true, exit_code: null, timed_out: true, truncated: false,
        stdout: '', stderr: '', error: null, duration_ms: 600_000,
        child_env_keys: [], child_home: null,
      } as ProcessOutcome;
    };
    const r = await runRealClaudeJob(claudeInput({}, runner));
    expect(r.outcome).toBe('timed_out');
    expect(r.executed).toBe(false);
    expect(r.failure_reason).toBe('timeout');
  });
});
