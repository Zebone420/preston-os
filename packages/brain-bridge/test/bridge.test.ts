import { describe, expect, it } from 'vitest';
import {
  validateLettaBrainConfig,
  type LettaBrainConfig,
  SdkLettaTurnClient,
} from '../src/index';

function validConfig(overrides: Partial<LettaBrainConfig> = {}): LettaBrainConfig {
  return {
    enabled: true,
    backend: 'remote',
    url: 'ws://test.internal:8080',
    agentId: 'agent-test-001',
    isolationAttested: true,
    runtimeEnv: 'staging',
    ...overrides,
  };
}

describe('Brain Bridge config', () => {
  it('accepts valid staging', () => {
    expect(validateLettaBrainConfig(validConfig()).valid).toBe(true);
  });

  it('refuses local', () => {
    const r = validateLettaBrainConfig(validConfig({ backend: 'local' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('backend_local_refused');
  });

  it('refuses cloud', () => {
    const r = validateLettaBrainConfig(validConfig({ backend: 'cloud' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('backend_cloud_refused');
  });

  it('refuses cloud-oauth', () => {
    const r = validateLettaBrainConfig(validConfig({ backend: 'cloud-oauth' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('backend_cloud_oauth_refused');
  });

  it('refuses unknown backend', () => {
    const r = validateLettaBrainConfig(validConfig({ backend: 'auto' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('backend_not_remote');
  });

  it('refuses production', () => {
    const r = validateLettaBrainConfig(validConfig({ runtimeEnv: 'production' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('production_refused');
  });

  it('refuses disabled brain', () => {
    const r = validateLettaBrainConfig(validConfig({ enabled: false }));
    expect(r.valid).toBe(false);
  });

  it('refuses missing isolation', () => {
    const r = validateLettaBrainConfig(validConfig({ isolationAttested: false }));
    expect(r.valid).toBe(false);
  });

  it('SdkLettaTurnClient fails closed on invalid config', () => {
    expect(() => new SdkLettaTurnClient(validConfig({ backend: 'local' }))).toThrow(/fail-closed/i);
  });

  it('SdkLettaTurnClient has no authority properties', () => {
    const client = new SdkLettaTurnClient(validConfig());
    const keys = Object.keys(client as unknown as Record<string, unknown>);
    const bad = keys.filter(k => /supabase|approval|shell|deploy|payment/i.test(k));
    expect(bad).toEqual([]);
  });
});

