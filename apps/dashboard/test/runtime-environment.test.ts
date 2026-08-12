// P2 environment generalization - the deployment-equality invariant in both
// directions: staging deployments behave byte-identically to pre-P2, and a
// production deployment accepts ONLY production rows (and vice versa). The
// allowlist refuses everything else fail-closed.

import { afterEach, describe, expect, it } from 'vitest';
import {
  RUNTIME_ENVIRONMENTS,
  deploymentEnvironment,
  strictRuntimeEnvironment,
} from '../src/lib/ai-os/runtime-environment';
import { validateMasterGoal, type MasterGoal } from '../src/lib/ai-os/orchestration/model';
import { checkRealJobContract } from '../src/lib/ai-os/real-claude-adapter';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

const savedEnv = process.env['SUPABASE_RUNTIME_ENV'];
afterEach(() => {
  if (savedEnv === undefined) delete process.env['SUPABASE_RUNTIME_ENV'];
  else process.env['SUPABASE_RUNTIME_ENV'] = savedEnv;
});

describe('runtime-environment allowlist', () => {
  it('strict: exactly staging|production; everything else null', () => {
    expect(strictRuntimeEnvironment({ SUPABASE_RUNTIME_ENV: 'staging' })).toBe('staging');
    expect(strictRuntimeEnvironment({ SUPABASE_RUNTIME_ENV: 'production' })).toBe('production');
    for (const v of [undefined, '', 'prod', 'Staging', 'PRODUCTION', 'test_dev']) {
      expect(strictRuntimeEnvironment({ SUPABASE_RUNTIME_ENV: v })).toBeNull();
    }
  });

  it('deployment: falls back to staging (conservative label) when unset/invalid', () => {
    expect(deploymentEnvironment({})).toBe('staging');
    expect(deploymentEnvironment({ SUPABASE_RUNTIME_ENV: 'nonsense' })).toBe('staging');
    expect(deploymentEnvironment({ SUPABASE_RUNTIME_ENV: 'production' })).toBe('production');
    expect(RUNTIME_ENVIRONMENTS).toEqual(['staging', 'production']);
  });
});

function goal(env: 'staging' | 'production'): MasterGoal {
  return {
    id: 'g-11111111', title: 't', objective: 'o', source: 'dashboard',
    requested_by: 'info@preston.nyc', status: 'proposed', environment: env,
    budget: { max_iterations: 10, max_job_retries: 1, max_wall_ms: 1000, max_jobs: 5 },
    correlation_id: 'c-11111111', simulation_only: true,
    created_at: 'now', updated_at: 'now',
  };
}

describe('deployment-equality invariant (both directions)', () => {
  it('staging deployment accepts staging rows, refuses production rows', () => {
    expect(validateMasterGoal(goal('staging'), 'staging')).toEqual([]);
    expect(validateMasterGoal(goal('production'), 'staging'))
      .toContain('environment_must_be_staging');
  });

  it('production deployment accepts production rows, refuses staging rows', () => {
    expect(validateMasterGoal(goal('production'), 'production')).toEqual([]);
    expect(validateMasterGoal(goal('staging'), 'production'))
      .toContain('environment_must_be_staging');
  });

  it('default expected environment tracks the process env', () => {
    delete process.env['SUPABASE_RUNTIME_ENV'];
    expect(validateMasterGoal(goal('staging'))).toEqual([]); // pre-P2 behavior
    process.env['SUPABASE_RUNTIME_ENV'] = 'production';
    expect(validateMasterGoal(goal('production'))).toEqual([]);
    expect(validateMasterGoal(goal('staging')))
      .toContain('environment_must_be_staging');
  });
});

describe('real job contract cross-environment refusal', () => {
  const base = {
    job: { id: 'j-1' } as unknown as GoalJob,
    ownerIdentity: 'info@preston.nyc',
    goalSimulationOnly: true,
    runId: 'run-1',
    nowMs: 1_000_000,
  };

  it('production deployment refuses a staging-labeled goal', () => {
    process.env['SUPABASE_RUNTIME_ENV'] = 'production';
    const r = checkRealJobContract({ ...base, goalEnvironment: 'staging' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('environment_not_staging');
  });

  it('staging deployment refuses a production-labeled goal', () => {
    process.env['SUPABASE_RUNTIME_ENV'] = 'staging';
    const r = checkRealJobContract({ ...base, goalEnvironment: 'production' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('environment_not_staging');
  });

  it('matching environment proceeds past the environment check', () => {
    process.env['SUPABASE_RUNTIME_ENV'] = 'production';
    const r = checkRealJobContract({ ...base, goalEnvironment: 'production' });
    if (!r.ok) expect(r.reason).not.toBe('environment_not_staging');
  });
});
