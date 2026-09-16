import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkLettaTurnClient } from '../src/lib/brain/sdk-letta-turn-client';
import type { LettaBrainConfig } from '../src/lib/brain/letta-config';

const originalFetch = globalThis.fetch;
const originalToken = process.env.PRESTON_BRAIN_BRIDGE_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.PRESTON_BRAIN_BRIDGE_TOKEN;
  else process.env.PRESTON_BRAIN_BRIDGE_TOKEN = originalToken;
  vi.restoreAllMocks();
});

function config(overrides: Partial<LettaBrainConfig> = {}): LettaBrainConfig {
  return {
    enabled: true,
    backend: 'remote',
    url: 'https://brain-bridge.test',
    agentId: 'agent-staging-001',
    isolationAttested: true,
    runtimeEnv: 'staging',
    ...overrides,
  };
}

const input = {
  prompt: 'Summarize the synthetic staging context.',
  mode: 'analysis' as const,
  actor: 'staging-test',
  correlation_id: 'corr-test-001',
  context: [],
  max_memory_candidates: 3,
};

describe('Super Brain protocol client', () => {
  it('sends only the bounded protocol envelope to the isolated bridge', async () => {
    process.env.PRESTON_BRAIN_BRIDGE_TOKEN = 't'.repeat(48);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: 'synthetic-ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await new SdkLettaTurnClient(config()).runTurn(input);
    expect(result.response).toBe('synthetic-ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://brain-bridge.test/v1/turn');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${'t'.repeat(48)}`);
    const envelope = JSON.parse(String(init.body));
    expect(envelope.agent_id).toBe('agent-staging-001');
    expect(envelope.input).toEqual(input);
    expect(JSON.stringify(envelope)).not.toMatch(/supabase|approval|deploy|payment/i);
  });

  it('fails closed without a bridge token', async () => {
    delete process.env.PRESTON_BRAIN_BRIDGE_TOKEN;
    await expect(new SdkLettaTurnClient(config()).runTurn(input)).rejects.toThrow(/missing or weak/i);
  });

  it('refuses non-HTTP bridge protocols before making a request', async () => {
    process.env.PRESTON_BRAIN_BRIDGE_TOKEN = 't'.repeat(48);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(new SdkLettaTurnClient(config({ url: 'ws://brain-bridge.test' })).runTurn(input))
      .rejects.toThrow(/HTTP\(S\)/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
