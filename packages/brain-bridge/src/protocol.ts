import { timingSafeEqual } from 'node:crypto';
import type { LettaTurnClient, LettaTurnInput, LettaTurnOutput } from './types.ts';

export const MAX_PROTOCOL_BYTES = 256 * 1024;

export interface BridgeProtocolRequest {
  method: string;
  path: string;
  authorization?: string;
  body?: string;
}

export interface BridgeProtocolResponse {
  status: number;
  body: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authorized(header: string | undefined, token: string): boolean {
  if (token.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function validInput(value: unknown): value is LettaTurnInput {
  if (!isRecord(value)) return false;
  if (typeof value.prompt !== 'string' || value.prompt.length === 0 || value.prompt.length > 32_768) return false;
  if (!['analysis', 'planning', 'synthesis', 'review'].includes(String(value.mode))) return false;
  if (typeof value.actor !== 'string' || value.actor.length === 0 || value.actor.length > 256) return false;
  if (typeof value.correlation_id !== 'string' || value.correlation_id.length === 0 || value.correlation_id.length > 256) return false;
  if (!Array.isArray(value.context) || value.context.length > 50) return false;
  if (!Number.isInteger(value.max_memory_candidates)) return false;
  const max = Number(value.max_memory_candidates);
  if (max < 0 || max > 20) return false;
  return true;
}

function safeOutput(value: LettaTurnOutput, maxCandidates: number): LettaTurnOutput | null {
  if (typeof value.response !== 'string' || value.response.length > 128 * 1024) return null;
  if (value.memory_candidates !== undefined && !Array.isArray(value.memory_candidates)) return null;
  return {
    response: value.response,
    memory_candidates: (value.memory_candidates ?? []).slice(0, maxCandidates),
  };
}

export async function handleBridgeProtocolRequest(
  request: BridgeProtocolRequest,
  client: LettaTurnClient,
  options: { token: string; agentId: string },
): Promise<BridgeProtocolResponse> {
  if (request.method === 'GET' && request.path === '/healthz') {
    return { status: 200, body: { ok: true, service: 'preston-brain-bridge' } };
  }
  if (request.method !== 'POST' || request.path !== '/v1/turn') {
    return { status: 404, body: { error: 'not_found' } };
  }
  if (!authorized(request.authorization, options.token)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const body = request.body ?? '';
  if (Buffer.byteLength(body, 'utf8') > MAX_PROTOCOL_BYTES) {
    return { status: 413, body: { error: 'payload_too_large' } };
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  if (!isRecord(envelope) || envelope.agent_id !== options.agentId || !validInput(envelope.input)) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  try {
    const output = safeOutput(await client.runTurn(envelope.input), envelope.input.max_memory_candidates);
    if (!output) return { status: 502, body: { error: 'invalid_provider_response' } };
    return { status: 200, body: output as unknown as Record<string, unknown> };
  } catch {
    return { status: 502, body: { error: 'brain_turn_failed' } };
  }
}
