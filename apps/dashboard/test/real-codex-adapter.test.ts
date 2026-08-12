import { describe, expect, it } from 'vitest';
import type { SystemControls } from '../src/lib/ai-os/controls';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';
import type { WorktreeLock } from '../src/lib/ai-os/orchestration/worktree-lock';
import type {
  ProcessOutcome, ProcessRunner, ProcessSpec,
} from '../src/lib/ai-os/real-claude-adapter';
import {
  buildCodexArgs,
  checkRealCodexJobContract,
  probeRealCodexCapability,
  runRealCodexJob,
  REAL_CODEX_EXECUTABLE_BASENAMES,
  REAL_CODEX_ELIGIBLE_KINDS,
  type RealCodexJobInput,
} from '../src/lib/ai-os/real-codex-adapter';

// Codex Level-1 real adapter suite. Every test runs against injected fake
// process/filesystem seams - the installed Codex CLI is never invoked and no
// network call occurs. Mirrors real-claude-adapter.test.ts fixtures so the
// two providers stay behaviorally symmetric.

const NOW = '2026-08-12T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const LATER = '2026-08-12T12:30:00.000Z';

const EXE = '/opt/codex/bin/codex';
const ROOT = '/srv/worktrees';
const WT = '/srv/worktrees/wt-job-00000001';

function goodEnv(): Record<string, string | undefined> {
  return {
    ORCH_REAL_CODEX_ENABLED: 'true',
    DISABLE_REMOTE_RUNNER: 'false',
    SUPABASE_RUNTIME_ENV: 'staging',
    ORCH_BASE_COMMIT: 'abc1234',
    ORCH_ALLOWED_PATHS: 'apps/dashboard/',
    ORCH_WORKTREES_ROOT: ROOT,
    ORCH_CODEX_EXECUTABLE: EXE,
  };
}

function liveControls(over?: Partial<SystemControls>): SystemControls {
  return {
    execution_enabled: true, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: true,
    updated_at: NOW, ...over,
  };
}

function makeJob(over?: Partial<GoalJob>): GoalJob {
  return {
    id: 'job-00000001', goal_id: 'goal-00000001', kind: 'documentation',
    title: 'draft note', objective: 'draft an internal note safely',
    risk_class: 'GREEN', assigned_role: 'codex', depends_on: [],
    status: 'in_progress', attempts: 0, requires_approval: false,
    approval_id: null, runtime_job_id: null, correlation_id: 'corr-0001',
    evidence_refs: [], failure_reason: null,
    run_id: 'job-00000001:run-1', run_lease_expires_at: LATER,
    created_at: NOW, updated_at: NOW, ...over,
  };
}

function makeLock(over?: Partial<WorktreeLock>): WorktreeLock {
  return {
    worktree_id: 'wt-job-00000001', repo: 'preston-os',
    job_id: 'job-00000001', owner: 'codex', token: 'tok-00000001',
    fence: 1, base_commit: 'abc1234', branch: 'wt/job-00000001',
    allowed_paths: ['apps/dashboard/'], acquired_at: NOW,
    expires_at: LATER, ...over,
  };
}

function fakeRunner(over?: Partial<ProcessOutcome>) {
  const calls: ProcessSpec[] = [];
  const runner: ProcessRunner = async (spec) => {
    calls.push(spec);
    return {
      spawned: true, exit_code: 0, timed_out: false, truncated: false,
      stdout: 'done', stderr: '', error: null, duration_ms: 5, ...over,
    };
  };
  return { calls, runner };
}

function baseInput(over?: Partial<RealCodexJobInput>): RealCodexJobInput {
  return {
    env: goodEnv(),
    controls: { controls: liveControls(), readOk: true },
    goal: {
      requested_by: 'owner@preston.nyc',
      environment: 'staging',
      simulation_only: true,
    },
    job: makeJob(), runId: 'job-00000001:run-1', nowMs: NOW_MS,
    lock: makeLock(), worktreePath: WT, treeDirty: false,
    fileExists: () => true, realpath: (p) => p,
    ...over,
  };
}

describe('probeRealCodexCapability - fail-closed gate', () => {
  const probe = (env: Record<string, string | undefined>, over?: {
    controls?: SystemControls; readOk?: boolean; fileExists?: (p: string) => boolean;
  }) => probeRealCodexCapability({
    env, controls: over?.controls ?? liveControls(),
    controlsReadOk: over?.readOk ?? true, fileExists: over?.fileExists ?? (() => true),
  });

  it('real when every control passes', () => {
    const r = probe(goodEnv());
    expect(r.capability).toBe('real');
    expect(r.config?.executable).toBe(EXE);
  });

  it('gate disabled (env absent) => unavailable, no config', () => {
    const env = goodEnv(); delete env.ORCH_REAL_CODEX_ENABLED;
    const r = probe(env);
    expect(r.capability).toBe('unavailable');
    expect(r.reasons).toContain('gate_disabled');
    expect(r.config).toBeNull();
  });

  it('emergency block must be an explicit false opt-out', () => {
    const env = goodEnv(); delete env.DISABLE_REMOTE_RUNNER;
    expect(probe(env).reasons).toContain('emergency_block_active');
  });

  it('refuses any runtime env outside the allowlist', () => {
    for (const v of [undefined, 'prod', '', 'Staging', 'test_dev']) {
      expect(probe({ ...goodEnv(), SUPABASE_RUNTIME_ENV: v }).reasons)
        .toContain('runtime_env_not_allowed');
    }
  });

  it("'production' clears the env gate without weakening other gates", () => {
    expect(probe({ ...goodEnv(), SUPABASE_RUNTIME_ENV: 'production' }).reasons)
      .not.toContain('runtime_env_not_allowed');
  });

  it('a non-codex basename is refused (fixed allowlist)', () => {
    for (const exe of ['/opt/claude/bin/claude', '/usr/bin/git',
      '/bin/sh', '/opt/codex/bin/codex.cmd', '/opt/codex/bin/codex.bat']) {
      expect(probe({ ...goodEnv(), ORCH_CODEX_EXECUTABLE: exe }).reasons)
        .toContain('executable_not_allowlisted');
    }
    expect(REAL_CODEX_EXECUTABLE_BASENAMES.has('codex')).toBe(true);
    expect(REAL_CODEX_EXECUTABLE_BASENAMES.has('claude')).toBe(false);
  });

  it('a relative or traversal executable path is rejected', () => {
    expect(probe({ ...goodEnv(), ORCH_CODEX_EXECUTABLE: 'codex' }).reasons)
      .toContain('executable_not_absolute');
    expect(probe({ ...goodEnv(), ORCH_CODEX_EXECUTABLE: '/opt/../codex' }).reasons)
      .toContain('executable_traversal');
  });

  it('missing executable file => executable_missing', () => {
    expect(probe(goodEnv(), { fileExists: () => false }).reasons)
      .toContain('executable_missing');
  });

  it('absolute or traversal allowed-paths are rejected', () => {
    expect(probe({ ...goodEnv(), ORCH_ALLOWED_PATHS: '/etc' }).reasons)
      .toContain('allowed_paths_invalid');
    expect(probe({ ...goodEnv(), ORCH_ALLOWED_PATHS: '../secrets' }).reasons)
      .toContain('allowed_paths_invalid');
  });

  it('owner DB posture gates: stop/paused/exec-off/runner-off', () => {
    expect(probe(goodEnv(), { controls: liveControls({ owner_stop: true }) })
      .reasons).toContain('owner_stop');
    expect(probe(goodEnv(), { controls: liveControls({ paused: true }) })
      .reasons).toContain('paused');
    expect(probe(goodEnv(), { controls: liveControls({ execution_enabled: false }) })
      .reasons).toContain('execution_disabled');
    expect(probe(goodEnv(), { controls: liveControls({ remote_runner_enabled: false }) })
      .reasons).toContain('remote_runner_disabled');
    expect(probe(goodEnv(), { readOk: false }).reasons)
      .toContain('controls_unreadable');
  });
});

describe('checkRealCodexJobContract - provider + bounds', () => {
  const chk = (over?: Partial<Parameters<typeof checkRealCodexJobContract>[0]>) =>
    checkRealCodexJobContract({
      job: makeJob(), ownerIdentity: 'owner@preston.nyc',
      goalEnvironment: 'staging', goalSimulationOnly: true,
      runId: 'job-00000001:run-1', nowMs: NOW_MS, ...over,
    });

  it('ok for a leased, eligible, codex job', () => {
    expect(chk()).toEqual({ ok: true });
  });

  it('a non-codex provider is refused (symmetric to the claude pin)', () => {
    expect(chk({ job: makeJob({ assigned_role: 'claude' }) }))
      .toEqual({ ok: false, reason: 'provider_not_codex' });
    expect(chk({ job: makeJob({ assigned_role: 'hermes' }) }))
      .toEqual({ ok: false, reason: 'provider_not_codex' });
    expect(chk({ job: makeJob({ assigned_role: null }) }))
      .toEqual({ ok: false, reason: 'provider_not_codex' });
  });

  it('environment must equal the deployment env (cross-env refusal)', () => {
    // Test process has no SUPABASE_RUNTIME_ENV => deploymentEnvironment()='staging'.
    expect(chk({ goalEnvironment: 'production' }))
      .toEqual({ ok: false, reason: 'environment_mismatch' });
  });

  it('unexpected simulation pin refuses (schema drift guard)', () => {
    expect(chk({ goalSimulationOnly: false }))
      .toEqual({ ok: false, reason: 'simulation_pin_unexpected' });
  });

  it('ineligible kind and over-risk are refused', () => {
    expect(chk({ job: makeJob({ kind: 'migration' }) }))
      .toEqual({ ok: false, reason: 'kind_not_eligible' });
    expect(chk({ job: makeJob({ kind: 'repair' }) }))
      .toEqual({ ok: false, reason: 'kind_not_eligible' });
    expect(chk({ job: makeJob({ risk_class: 'RED' }) }))
      .toEqual({ ok: false, reason: 'risk_exceeds_allowed' });
    expect(REAL_CODEX_ELIGIBLE_KINDS.has('documentation')).toBe(true);
    expect(REAL_CODEX_ELIGIBLE_KINDS.has('migration')).toBe(false);
  });

  it('lease + fence: not leased / not owned / expired all refuse', () => {
    expect(chk({ job: makeJob({ status: 'ready' }) }))
      .toEqual({ ok: false, reason: 'job_not_leased' });
    expect(chk({ job: makeJob({ run_id: 'someone-else' }) }))
      .toEqual({ ok: false, reason: 'lease_not_owned' });
    expect(chk({ job: makeJob({ run_lease_expires_at: '2026-08-12T11:00:00.000Z' }) }))
      .toEqual({ ok: false, reason: 'lease_expired' });
  });

  it('a gated job with no approval record refuses', () => {
    const r = chk({ job: makeJob({ requires_approval: true, approval_id: 'ap-1' }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.startsWith('approval_')).toBe(true);
  });
});

describe('buildCodexArgs - fixed contract, prompt is one positional', () => {
  it('exec --json <prompt>, prompt never a flag', () => {
    const args = buildCodexArgs('PRESTON OS LEVEL-1 ... task');
    expect(args).toEqual(['exec', '--json', 'PRESTON OS LEVEL-1 ... task']);
    expect(args[0].startsWith('-')).toBe(false);
    expect(args[args.length - 1].startsWith('-')).toBe(false);
  });
});

describe('runRealCodexJob - end to end (fake seams)', () => {
  it('completes, executed=true, real evidence ref (not sim)', async () => {
    // Deployment env in the test process resolves to 'staging'
    // (SUPABASE_RUNTIME_ENV unset), so the goal env matches staging here.
    const { runner, calls } = fakeRunner();
    const r = await runRealCodexJob(baseInput({ runner }));
    expect(r.role).toBe('codex');
    expect(r.outcome).toBe('completed');
    expect(r.executed).toBe(true);
    expect(r.simulated).toBe(false);
    expect(r.evidence_refs[0]).toContain('executed:true');
    expect(r.evidence_refs[0].startsWith('real:')).toBe(true);
    // The fixed argv contract reached the runner unchanged.
    expect(calls[0].args[0]).toBe('exec');
    expect(calls[0].executable).toBe(EXE);
  });

  it('gate disabled => refuses WITHOUT spawning (no runner call)', async () => {
    const { runner, calls } = fakeRunner();
    const env = goodEnv(); delete env.ORCH_REAL_CODEX_ENABLED;
    const r = await runRealCodexJob(baseInput({ env, runner }));
    expect(r.outcome).toBe('unavailable');
    expect(r.executed).toBe(false);
    expect(calls).toHaveLength(0); // never spawned
  });

  it('claude-assigned job => blocked provider_not_codex, no spawn', async () => {
    const { runner, calls } = fakeRunner();
    const r = await runRealCodexJob(baseInput({
      job: makeJob({ assigned_role: 'claude' }), runner,
    }));
    expect(r.outcome).toBe('blocked');
    expect(r.failure_reason).toBe('provider_not_codex');
    expect(calls).toHaveLength(0);
  });

  it('worktree outside the authorized root => blocked, no spawn', async () => {
    const { runner, calls } = fakeRunner();
    const r = await runRealCodexJob(baseInput({
      worktreePath: '/tmp/evil/wt-job-00000001', runner,
    }));
    expect(r.outcome).toBe('blocked');
    expect(r.failure_reason).toBe('worktree_outside_root');
    expect(calls).toHaveLength(0);
  });

  it('lock paths exceeding the env allowlist => blocked', async () => {
    const { runner } = fakeRunner();
    const r = await runRealCodexJob(baseInput({
      lock: makeLock({ allowed_paths: ['packages/secret/'] }), runner,
    }));
    expect(r.outcome).toBe('blocked');
    expect(r.failure_reason).toBe('lock_paths_exceed_env_allowlist');
  });

  it('non-zero exit => failed, executed=false', async () => {
    const { runner } = fakeRunner({ exit_code: 1, stdout: '', stderr: 'boom' });
    const r = await runRealCodexJob(baseInput({ runner }));
    expect(r.outcome).toBe('failed');
    expect(r.executed).toBe(false);
    expect(r.failure_reason).toBe('exit_1');
  });

  it('timeout => timed_out, executed=false', async () => {
    const { runner } = fakeRunner({ timed_out: true, exit_code: null });
    const r = await runRealCodexJob(baseInput({ runner }));
    expect(r.outcome).toBe('timed_out');
    expect(r.executed).toBe(false);
  });

  it('output truncation => failed output_limit_exceeded', async () => {
    const { runner } = fakeRunner({ truncated: true });
    const r = await runRealCodexJob(baseInput({ runner }));
    expect(r.outcome).toBe('failed');
    expect(r.failure_reason).toBe('output_limit_exceeded');
  });
});

describe('source-level invariant pins', () => {
  it('the codex adapter never edits the claude adapter provider pin', async () => {
    const { readFileSync } = await import('node:fs');
    const claude = readFileSync(
      'src/lib/ai-os/real-claude-adapter.ts', 'utf8');
    // The claude adapter must still refuse codex (unmodified proven path).
    expect(claude).toContain("job.assigned_role !== 'claude'");
    expect(claude).toContain("reason: 'provider_not_claude'");
  });

  it('the codex adapter holds no env token read and its own executable env', async () => {
    const { readFileSync } = await import('node:fs');
    const codex = readFileSync(
      'src/lib/ai-os/real-codex-adapter.ts', 'utf8');
    expect(codex).toContain("ORCH_REAL_CODEX_ENABLED");
    expect(codex).toContain("ORCH_CODEX_EXECUTABLE");
    expect(codex).not.toContain("SUPABASE_RUNTIME_TOKEN");
    expect(codex).not.toContain("ORCH_CLAUDE_EXECUTABLE");
  });
});
