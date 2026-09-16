// Preston Super Brain v1 - Concrete Letta SDK Turn Client
// Implements LettaTurnClient using @letta-ai/letta-agent-sdk.
// Uses backend="remote" ONLY. Fail-closed on all config errors.
// The SDK client connects to an ISOLATED Letta App Server.
// That server must have NO Preston repo, DB, secrets, or control-plane access.

import { LettaAgentClient } from '@letta-ai/letta-agent-sdk';
import type { LettaTurnClient, LettaTurnInput, LettaTurnOutput } from './letta-reasoner';
import type { LettaBrainConfig } from './letta-config';
import { validateLettaBrainConfig } from './letta-config';

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
    `## Context (${input.context.length} items)`,
    contextSummary,
    '',
    `## Request (${input.mode})`,
    input.prompt,
    '',
    `You may propose up to ${input.max_memory_candidates} memory candidates.`,
  ].join('\n');
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
    // Re-validate on every turn - fail closed if config drifted.
    const recheck = validateLettaBrainConfig(this.config);
    if (!recheck.valid) {
      throw new Error(`SdkLettaTurnClient: config no longer valid: ${recheck.errors.join(', ')}`);
    }

    let client: LettaAgentClient | undefined;
    try {
      client = new LettaAgentClient({
        backend: 'remote' as const,
        url: this.config.url,
      });

      const session = client.resumeSession(this.config.agentId);
      const userMessage = buildUserMessage(input);

      await session.send(userMessage);

      let responseText = '';
      for await (const msg of session.stream()) {
        if (msg.type === 'assistant') {
          responseText += msg.content;
        }
        if (msg.type === 'result' && !msg.success) {
          throw new Error(`Letta turn failed: ${msg.error ?? 'unknown'}`);
        }
      }

      return { response: responseText || '(no response)' };
    } catch (err) {
      // Fail closed: SDK/network errors never silently return empty.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SdkLettaTurnClient: turn failed (fail-closed): ${message}`);
    } finally {
      if (client) {
        await client.close().catch(() => { /* best-effort cleanup */ });
      }
    }
  }
}
