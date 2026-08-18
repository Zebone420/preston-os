// P2 live defect regression (prod tick disp-93663, 2026-08-18): classifyJob
// passed the literal environment 'staging' into evaluatePolicy, so in a
// production deployment every composed job classified RED
// (non_staging_environment) and real execution silently declined to
// simulation. classifyJob must classify against the deployment's OWN
// environment in both deployments.
//
// Modules capture deploymentEnvironment at various times, so each case
// reimports the policy module fresh with the env var already set.

import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIG = process.env.SUPABASE_RUNTIME_ENV;

async function freshClassifyJob(env: string | undefined) {
  vi.resetModules();
  if (env === undefined) delete process.env.SUPABASE_RUNTIME_ENV;
  else process.env.SUPABASE_RUNTIME_ENV = env;
  const mod = await import('../src/lib/ai-os/orchestration/policy');
  return mod.classifyJob;
}

afterEach(() => {
  if (ORIG === undefined) delete process.env.SUPABASE_RUNTIME_ENV;
  else process.env.SUPABASE_RUNTIME_ENV = ORIG;
  vi.resetModules();
});

describe('classifyJob classifies against the deployment environment', () => {
  const NEUTRAL = 'document the P2 drill result.';

  it('production deployment: a neutral doc job is GREEN (was RED pre-fix)', async () => {
    const classifyJob = await freshClassifyJob('production');
    const p = classifyJob('documentation', NEUTRAL);
    expect(p.risk_class).toBe('GREEN');
    expect(p.requires_approval).toBe(false);
    expect(p.reason).toBe('bounded_worktree_simulation');
  });

  it('staging deployment: same job stays GREEN (unchanged behavior)', async () => {
    const classifyJob = await freshClassifyJob('staging');
    const p = classifyJob('documentation', NEUTRAL);
    expect(p.risk_class).toBe('GREEN');
    expect(p.requires_approval).toBe(false);
  });

  it('unset deployment env: falls back to staging semantics, still GREEN', async () => {
    const classifyJob = await freshClassifyJob(undefined);
    const p = classifyJob('documentation', NEUTRAL);
    expect(p.risk_class).toBe('GREEN');
  });

  it('production deployment: a gated-marker objective still classifies RED', async () => {
    const classifyJob = await freshClassifyJob('production');
    const p = classifyJob('documentation', 'rotate the credential store');
    expect(p.tier).toBe('RED');
    expect(p.requires_approval).toBe(true);
  });
});
