// Phase 8 execution capability levels - fail-closed contract pins.
// The owner kill switch (system_controls) must dominate host env in every
// direction, and EXTERNAL_WRITE must be unreachable by configuration.

import { describe, expect, it } from 'vitest';
import {
  EXECUTION_LEVEL_ENV,
  levelAtLeast,
  resolveExecutionLevel,
} from '../src/lib/ai-os/execution-capability';
import type { SystemControls } from '../src/lib/ai-os/controls';

const safeControls: SystemControls = {
  execution_enabled: true,
  owner_stop: false,
  paused: false,
  hermes_mode: 'observe_only',
  remote_runner_enabled: true,
  updated_at: '2026-08-07T00:00:00.000Z',
};

// The full env an owner would install for bounded real execution.
const readyEnv = {
  [EXECUTION_LEVEL_ENV]: 'bounded_code_execution',
  SUPABASE_RUNTIME_ENV: 'staging',
  DISABLE_REMOTE_RUNNER: 'false',
};

const resolve = (
  env: Record<string, string | undefined>,
  controls: SystemControls = safeControls,
  controlsReadOk = true,
) => resolveExecutionLevel({ env, controls, controlsReadOk });

describe('execution capability - the only path to real bounded execution', () => {
  it('grants BOUNDED_CODE_EXECUTION when env and owner controls both agree', () => {
    const r = resolve(readyEnv);
    expect(r.level).toBe('BOUNDED_CODE_EXECUTION');
    expect(r.realExecutionAllowed).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('defaults to SIMULATION with empty env (fail-closed)', () => {
    const r = resolve({});
    expect(r.level).toBe('SIMULATION');
    expect(r.realExecutionAllowed).toBe(false);
    expect(r.reasons).toContain('level_env_not_set');
  });
});

describe('execution capability - owner DB posture dominates host env', () => {
  // Each of these is the proven Phase 7 kill switch applied to real execution.
  for (const [label, patch, reason] of [
    ['owner_stop', { owner_stop: true }, 'owner_stop'],
    ['paused', { paused: true }, 'paused'],
    ['execution_enabled=false', { execution_enabled: false }, 'execution_disabled'],
    ['remote_runner_enabled=false', { remote_runner_enabled: false }, 'remote_runner_disabled'],
  ] as const) {
    it(`downgrades to SIMULATION on ${label} even with a fully enabling env`, () => {
      const r = resolve(readyEnv, { ...safeControls, ...patch });
      expect(r.level).toBe('SIMULATION');
      expect(r.realExecutionAllowed).toBe(false);
      expect(r.reasons).toContain(reason);
    });
  }

  it('downgrades to SIMULATION when controls are unreadable (outage)', () => {
    const r = resolve(readyEnv, safeControls, false);
    expect(r.level).toBe('SIMULATION');
    expect(r.reasons).toContain('controls_unreadable');
  });
});

describe('execution capability - environment and emergency gates', () => {
  it('refuses outside the P2 env allowlist', () => {
    for (const v of ['test_dev', '', 'prod', 'Production']) {
      const r = resolve({ ...readyEnv, SUPABASE_RUNTIME_ENV: v });
      expect(r.level).toBe('SIMULATION');
      expect(r.reasons).toContain('runtime_env_not_staging');
    }
  });

  it("'production' clears the env gate (P2); every other gate still applies", () => {
    const r = resolve({ ...readyEnv, SUPABASE_RUNTIME_ENV: 'production' });
    expect(r.reasons).not.toContain('runtime_env_not_staging');
  });

  it('refuses when DISABLE_REMOTE_RUNNER is absent (explicit opt-out required)', () => {
    const env = { ...readyEnv };
    delete (env as Record<string, unknown>).DISABLE_REMOTE_RUNNER;
    const r = resolve(env);
    expect(r.reasons).toContain('emergency_block_active');
    expect(r.level).toBe('SIMULATION');
  });

  it('refuses when the emergency flag is set to true', () => {
    const r = resolve({ ...readyEnv, DISABLE_REMOTE_RUNNER: 'true' });
    expect(r.level).toBe('SIMULATION');
    expect(r.reasons).toContain('emergency_block_active');
  });

  it('treats an unknown level spelling as SIMULATION, never as a grant', () => {
    for (const v of ['BOUNDED', 'bounded code execution', 'yes', 'true', '1']) {
      const r = resolve({ ...readyEnv, [EXECUTION_LEVEL_ENV]: v });
      expect(r.level).toBe('SIMULATION');
      expect(r.reasons).toContain('level_env_not_set');
    }
  });
});

describe('execution capability - EXTERNAL_WRITE is unreachable in V1', () => {
  it('refuses external_write even with a perfect posture, and never returns it', () => {
    const r = resolve({ ...readyEnv, [EXECUTION_LEVEL_ENV]: 'external_write' });
    expect(r.level).toBe('SIMULATION');
    expect(r.realExecutionAllowed).toBe(false);
    expect(r.reasons).toContain('external_write_not_activatable');
  });

  it('no env/control combination can produce EXTERNAL_WRITE', () => {
    const spellings = ['external_write', 'EXTERNAL_WRITE', 'External_Write'];
    for (const s of spellings) {
      for (const controls of [safeControls, { ...safeControls, owner_stop: true }]) {
        expect(resolve({ ...readyEnv, [EXECUTION_LEVEL_ENV]: s }, controls).level)
          .toBe('SIMULATION');
      }
    }
  });
});

describe('level ordering helper', () => {
  it('orders SIMULATION < BOUNDED_CODE_EXECUTION < EXTERNAL_WRITE', () => {
    expect(levelAtLeast('BOUNDED_CODE_EXECUTION', 'SIMULATION')).toBe(true);
    expect(levelAtLeast('SIMULATION', 'BOUNDED_CODE_EXECUTION')).toBe(false);
    expect(levelAtLeast('EXTERNAL_WRITE', 'BOUNDED_CODE_EXECUTION')).toBe(true);
    expect(levelAtLeast('SIMULATION', 'SIMULATION')).toBe(true);
  });
});
