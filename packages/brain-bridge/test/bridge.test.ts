import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLettaBrainConfig,
  type LettaBrainConfig,
  SdkLettaTurnClient,
  handleBridgeProtocolRequest,
  type LettaTurnClient,
} from '../src/index.ts';

function validConfig(overrides: Partial<LettaBrainConfig> = {}): LettaBrainConfig {
  return {
    enabled: true,
    backend: 'remote',
    url: 'https://letta-staging.example.test',
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

test('Brain Bridge config accepts staging and refuses unsafe backends/environments', () => {
  assert.equal(validateLettaBrainConfig(validConfig()).valid, true);
  assert.equal(validateLettaBrainConfig(validConfig({ backend: 'local' })).valid, false);
  assert.equal(validateLettaBrainConfig(validConfig({ backend: 'cloud' })).valid, false);
  assert.equal(validateLettaBrainConfig(validConfig({ backend: 'cloud-oauth' })).valid, false);
  assert.equal(validateLettaBrainConfig(validConfig({ runtimeEnv: 'production' })).valid, false);
  assert.equal(validateLettaBrainConfig(validConfig({ enabled: false })).valid, false);
  assert.equal(validateLettaBrainConfig(validConfig({ isolationAttested: false })).valid, false);
});

test('provider wrapper fails closed and exposes no Preston authority properties', () => {
  assert.throws(() => new SdkLettaTurnClient(validConfig({ backend: 'local' })), /fail-closed/i);
  const client = new SdkLettaTurnClient(validConfig());
  const keys = Object.keys(client as unknown as Record<string, unknown>);
  assert.deepEqual(keys.filter((key) => /supabase|approval|shell|deploy|payment/i.test(key)), []);
});

test('provider wrapper uses the App Server OpenAI-compatible Responses API', async () => {
  const savedFetch = globalThis.fetch;
  const savedToken = process.env.LETTA_APP_SERVER_TOKEN;
  process.env.LETTA_APP_SERVER_TOKEN = token;
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'synthetic-provider-ok' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await new SdkLettaTurnClient(validConfig()).runTurn(input);
    assert.equal(result.response, 'synthetic-provider-ok');
    assert.equal(seenUrl, 'https://letta-staging.example.test/v1/responses');
    assert.equal((seenInit?.headers as Record<string, string>).authorization, `Bearer ${token}`);
    assert.equal((seenInit?.headers as Record<string, string>)['x-letta-chat-key'], input.correlation_id);
    const body = JSON.parse(String(seenInit?.body));
    assert.equal(body.model, 'agent-test-001');
    assert.match(body.input, /synthetic staging data only/i);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedToken === undefined) delete process.env.LETTA_APP_SERVER_TOKEN;
    else process.env.LETTA_APP_SERVER_TOKEN = savedToken;
  }
});

test('protocol accepts one authenticated agent-bound synthetic turn', async () => {
  let called = false;
  const client: LettaTurnClient = { runTurn: async (received) => {
    called = true;
    assert.deepEqual(received, input);
    return { response: 'synthetic-ok' };
  } };
  const result = await handleBridgeProtocolRequest({
    method: 'POST', path: '/v1/turn', authorization: `Bearer ${token}`,
    body: JSON.stringify({ agent_id: 'agent-test-001', input }),
  }, client, { token, agentId: 'agent-test-001' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { response: 'synthetic-ok', memory_candidates: [] });
  assert.equal(called, true);
});

test('protocol fails closed on missing auth and wrong agent', async () => {
  let calls = 0;
  const client: LettaTurnClient = { runTurn: async () => { calls += 1; return { response: 'bad' }; } };
  const noAuth = await handleBridgeProtocolRequest({
    method: 'POST', path: '/v1/turn', body: JSON.stringify({ agent_id: 'agent-test-001', input }),
  }, client, { token, agentId: 'agent-test-001' });
  const wrongAgent = await handleBridgeProtocolRequest({
    method: 'POST', path: '/v1/turn', authorization: `Bearer ${token}`,
    body: JSON.stringify({ agent_id: 'other-agent', input }),
  }, client, { token, agentId: 'agent-test-001' });
  assert.equal(noAuth.status, 401);
  assert.equal(wrongAgent.status, 400);
  assert.equal(calls, 0);
});

test('protocol does not leak provider errors', async () => {
  const client: LettaTurnClient = { runTurn: async () => { throw new Error('secret provider detail'); } };
  const result = await handleBridgeProtocolRequest({
    method: 'POST', path: '/v1/turn', authorization: `Bearer ${token}`,
    body: JSON.stringify({ agent_id: 'agent-test-001', input }),
  }, client, { token, agentId: 'agent-test-001' });
  assert.deepEqual(result, { status: 502, body: { error: 'brain_turn_failed' } });
  assert.equal(JSON.stringify(result).includes('secret provider detail'), false);
});
