// Preston Super Brain v1 - Isolated Letta REST Turn Client
// Uses the official zero-dependency @letta-ai/letta-client package.
// Remote isolated server ONLY. Fail-closed on all config errors.
// The bridge has no Preston repo, DB, approval, shell, deploy, payment,
// customer-send, or production-control authority.

import Letta from '@letta-ai/letta-client';
import type { LettaTurnClient, LettaTurnInput, LettaTurnOutput } from './types.ts';
import type { LettaBrainConfig } from './config.ts';
import { validateLettaBrainConfig } from './config.ts';

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

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!isRecord(part)) return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    return '';
  }).filter(Boolean).join('');
}

function extractAssistantText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.messages)) return '';
  const chunks: string[] = [];
  for (const message of response.messages) {
    if (!isRecord(message)) continue;
    const kind = String(message.message_type ?? message.type ?? '').toLowerCase();
    if (!kind.includes('assistant')) continue;
    const text = textFromContent(message.content);
    if (text) chunks.push(text);
  }
  return chunks.join('\n').trim();
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

    try {
      const apiKey = process.env.LETTA_API_KEY;
      const client = new Letta({
        baseURL: this.config.url,
        ...(apiKey ? { apiKey } : {}),
        maxRetries: 0,
        timeout: 25_000,
        logLevel: 'off',
      });
      const response = await client.agents.messages.create(this.config.agentId, {
        input: buildUserMessage(input),
      });
      const responseText = extractAssistantText(response as unknown);
      if (!responseText) throw new Error('Letta returned no assistant response');
      return { response: responseText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SdkLettaTurnClient: turn failed (fail-closed): ${message}`);
    }
  }
}
