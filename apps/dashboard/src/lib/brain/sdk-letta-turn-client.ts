// Preston Super Brain v1 - Protocol Letta Turn Client
//
// Dashboard-side client for the Brain Bridge protocol boundary.
// The dashboard NEVER imports @letta-ai/letta-agent-sdk or
// @preston/brain-bridge at runtime. The concrete Letta SDK
// implementation lives exclusively in packages/brain-bridge.

import type { LettaTurnClient, LettaTurnInput, LettaTurnOutput } from './letta-reasoner';
import type { LettaBrainConfig } from './letta-config';
import { validateLettaBrainConfig } from './letta-config';

const MAX_PROTOCOL_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function buildSystemPrompt(mode: string): string {
  return [
    'You are a reasoning layer for a business automation system called Preston.',
    'Your role is ONLY to reason, analyze, synthesize, and propose memories.',
    'You must NEVER attempt to execute commands, approve actions, deploy,',
    'access databases, credentials, payments, or communicate with customers.',
    'You must NEVER claim or exercise any authority over Preston.',
    'Any durable memories you propose will be evaluated by Preston policy.',
    'Current reasoning mode: ' + mode + '.',
  ].join(' ');
}

function bridgeTurnUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('SdkLettaTurnClient: invalid Brain Bridge URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('SdkLettaTurnClient: Brain Bridge URL must use HTTP(S)');
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/v1/turn';
  return parsed.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTurnOutput(value: unknown, maxCandidates: number): LettaTurnOutput {
  if (!isRecord(value) || typeof value.response !== 'string' || value.response.length > 128 * 1024) {
    throw new Error('SdkLettaTurnClient: malformed Brain Bridge response');
  }
  const candidates = value.memory_candidates;
  if (candidates !== undefined && !Array.isArray(candidates)) {
    throw new Error('SdkLettaTurnClient: malformed memory candidates');
  }
  return {
    response: value.response,
    memory_candidates: (candidates ?? []).slice(0, maxCandidates) as LettaTurnOutput['memory_candidates'],
  };
}

export class SdkLettaTurnClient implements LettaTurnClient {
  private readonly config: LettaBrainConfig;

  constructor(config: LettaBrainConfig) {
    const validation = validateLettaBrainConfig(config);
    if (!validation.valid) {
      throw new Error(
        'SdkLettaTurnClient: configuration invalid, fail-closed. Errors: ' + validation.errors.join(', '),
      );
    }
    this.config = config;
  }

  async runTurn(input: LettaTurnInput): Promise<LettaTurnOutput> {
    const recheck = validateLettaBrainConfig(this.config);
    if (!recheck.valid) {
      throw new Error('SdkLettaTurnClient: config no longer valid: ' + recheck.errors.join(', '));
    }
    if (typeof window !== 'undefined') {
      throw new Error('SdkLettaTurnClient: browser execution refused');
    }

    const token = process.env.PRESTON_BRAIN_BRIDGE_TOKEN ?? '';
    if (token.length < 32) {
      throw new Error('SdkLettaTurnClient: missing or weak Brain Bridge token');
    }

    const body = JSON.stringify({ agent_id: this.config.agentId, input });
    if (Buffer.byteLength(body, 'utf8') > MAX_PROTOCOL_BYTES) {
      throw new Error('SdkLettaTurnClient: request exceeds protocol limit');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(bridgeTurnUrl(this.config.url), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(`Brain Bridge refused request (${response.status})`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_PROTOCOL_BYTES) {
        throw new Error('Brain Bridge response exceeds protocol limit');
      }
      return parseTurnOutput(JSON.parse(text) as unknown, input.max_memory_candidates);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`SdkLettaTurnClient: bridge request failed (fail-closed): ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
