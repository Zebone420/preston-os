import { describe, expect, it, vi } from 'vitest';
import {
  validateLettaBrainConfig,
  type LettaBrainConfig,
  SdkLettaTurnClient,
  handleBridgeProtocolRequest,
  type LettaTurnClient,
} from '../src/index.js';

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

const input = {
  prompt: 'Analyze synthetic staging data only.',
  mode: 'analysis' as const,
  actor: 'staging-test',
  correlation_id: 'corr-001',
  context: [],
  max_memory_candidates: 2,
};

const token = 'b'.repeat(48);

describe('Brain Bridge config', () => {
  it('accepts valid staging', () => {
    expect(validateLettaBrainConfig(validConfig()).valid).toBe(true);
  });

  it('refuses local, cloud, cloud-oauth, production, disabled, and missing isolation', () => {
    expect(validateLettaBrainConfig(validConfig({ backend: 'local' })).valid).toBe(false);
    expect(validateLettaBrainConfig(validConfig({ backend: 'cloud' })).valid).toBe(false);
    expect(validateLettaBrainConfig(validConfig({ backend: 'cloud-oauth' })).valid).toBe(false);
    expect(validateLettaBrainConfig(validConfig({ runtimeEnv: 'production' })).valid).toBe(false);
    expect(validateLettaBrainConfig(validConfig({ enabled: false })).valid).toBe(false);
    expect(validateLettaBrainConfig(validConfig({ isolationAttested: false })).valid).toBe(false);
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

describe('Brain Bridge protocol', () => {
  it('accepts one authenticated, agent-bound, bounded synthetic turn', async () => {
    const runTurn = vi.fn(async () => ({ response: 'synthetic-ok' }));
    const client: LettaTurnClient = { runTurn };
    const result = await handleBridgeProtocolRequest({
      method: 'POST',
      path: '/v1/turn',
      authorization: `Bearer ${token}`,
      body: JSON.stringify({ agent_id: 'agent-test-001', input }),
    }, client, { token, agentId: 'agent-test-001' });

    expect(result).toEqual({ status: 200, body: { response: 'synthetic-ok', memory_candidates: [] } });
    expect(runTurn).toHaveBeenCalledWith(input);
  });

  it('fails closed on missing auth and wrong agent without invoking Letta', async () => {
    const runTurn = vi.fn(async () => ({ response: 'should-not-run' }));
    const client: LettaTurnClient = { runTurn };
    const noAuth = await handleBridgeProtocolRequest({
      method: 'POST', path: '/v1/turn', body: JSON.stringify({ agent_id: 'agent-test-001', input }),
    }, client, { token, agentId: 'agent-test-001' });
    const wrongAgent = await handleBridgeProtocolRequest({
      method: 'POST', path: '/v1/turn', authorization: `Bearer ${token}`,
      body: JSON.stringify({ agent_id: 'other-agent', input }),
    }, client, { token, agentId: 'agent-test-001' });

    expect(noAuth.status).toBe(401);
    expect(wrongAgent.status).toBe(400);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('does not leak provider errors through the protocol', async () => {
    const client: LettaTurnClient = { runTurn: async () => { throw new Error('secret provider detail'); } };
    const result = await handleBridgeProtocolRequest({
      method: 'POST', path: '/v1/turn', authorization: `Bearer ${token}`,
      body: JSON.stringify({ agent_id: 'agent-test-001', input }),
    }, client, { token, agentId: 'agent-test-001' });
    expect(result).toEqual({ status: 502, body: { error: 'brain_turn_failed' } });
    expect(JSON.stringify(result)).not.toContain('secret provider detail');
  });
});
