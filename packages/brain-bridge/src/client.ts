// Preston Super Brain v1 - Isolated Letta App Server Turn Client
// Uses Node's native fetch against Letta App Server's OpenAI-compatible
// Responses API. Remote isolated server ONLY. Fail-closed on all config errors.
// The bridge has no Preston repo, DB, approval, shell, deploy, payment,
// customer-send, or production-control authority.

import type { LettaTurnClient, LettaTurnInput, LettaTurnOutput } from './types.ts';
import type { LettaBrainConfig } from './config.ts';
import { validateLettaBrainConfig } from './config.ts';

const MAX_PROVIDER_BYTES = 256 * 1024;
const PROVIDER_TIMEOUT_MS = 25_000;

export function buildSystemPrompt(mode: string): string {
  return [
    'You are a reasoning layer for a business automation system called Preston.',
    'Your role is ONLY to reason, analyze, synthesize, and propose memories.',
    'You must NEVER attempt to execute commands, approve actions, deploy,',
    'access databases, credentials, payments, or communicate with customers.',
    'You must NEVER claim or exercise any authority over Preston.',
    'Any durable memories you propose will be evaluated by Preston policy.',
    `Current reasoning mode: ${mode}.`,
  ].join(' ');
}

function buildUserMessage(input: LettaTurnInput): string {
  const contextSummary = input.context.length > 0
    ? input.context.map((item) => `${item.memory_type}/${item.key}: ${JSON.stringify(item.value)}`).join('\n')
    : '(no context provided)';
  return [
    buildSystemPrompt(input.mode),
    '',
    `## Context (${input.context.length} items)`,
    contextSummary,
    '',
    `## Request (${input.mode})`,
    input.prompt,
    '',
    `You may propose up to ${input.max_memory_candidates} memory candidates.`,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responsesUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('invalid Letta App Server URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Letta App Server URL must use HTTP(S)');
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/responses';
  return parsed.toString();
}

function extractResponseText(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text.trim();

  const chunks: string[] = [];
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!isRecord(item)) continue;
      if (typeof item.text === 'string') chunks.push(item.text);
      if (typeof item.content === 'string') chunks.push(item.content);
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (!isRecord(part)) continue;
          if (typeof part.text === 'string') chunks.push(part.text);
          else if (typeof part.content === 'string') chunks.push(part.content);
        }
      }
    }
  }

  if (chunks.length === 0 && Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isRecord(choice) || !isRecord(choice.message)) continue;
      if (typeof choice.message.content === 'string') chunks.push(choice.message.content);
    }
  }
  return chunks.filter(Boolean).join('\n').trim();
}

export class SdkLettaTurnClient implements LettaTurnClient {
  private readonly config: LettaBrainConfig;

  constructor(config: LettaBrainConfig) {
    const validation = validateLettaBrainConfig(config);
    if (!validation.valid) {
      throw new Error(
        `SdkLettaTurnClient: configuration invalid, fail-closed. Errors: ${validation.errors.join(', ')}`,
      );
    }
    this.config = config;
  }

  async runTurn(input: LettaTurnInput): Promise<LettaTurnOutput> {
    const recheck = validateLettaBrainConfig(this.config);
    if (!recheck.valid) {
      throw new Error(`SdkLettaTurnClient: config no longer valid: ${recheck.errors.join(', ')}`);
    }

    const token = process.env.LETTA_APP_SERVER_TOKEN ?? '';
    if (token.length < 32) {
      throw new Error('SdkLettaTurnClient: missing or weak LETTA_APP_SERVER_TOKEN');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(responsesUrl(this.config.url), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-letta-chat-key': input.correlation_id,
        },
        body: JSON.stringify({
          model: this.config.agentId,
          input: buildUserMessage(input),
        }),
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(`Letta App Server refused request (${response.status})`);
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_BYTES) {
        throw new Error('Letta App Server response exceeds provider limit');
      }
      const responseText = extractResponseText(JSON.parse(raw) as unknown);
      if (!responseText) throw new Error('Letta App Server returned no assistant response');
      return { response: responseText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SdkLettaTurnClient: turn failed (fail-closed): ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
