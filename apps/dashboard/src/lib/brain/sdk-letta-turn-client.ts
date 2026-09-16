// Preston Super Brain v1 - Protocol Letta Turn Client
//
// Dashboard-side client for the Brain Bridge protocol boundary.
// The dashboard NEVER imports @letta-ai/letta-agent-sdk or
// @preston/brain-bridge at runtime. The concrete Letta SDK
// implementation lives exclusively in packages/brain-bridge.

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
    'Current reasoning mode: ' + mode + '.',
  ].join(' ');
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

  async runTurn(_input: LettaTurnInput): Promise<LettaTurnOutput> {
    const recheck = validateLettaBrainConfig(this.config);
    if (!recheck.valid) {
      throw new Error('SdkLettaTurnClient: config no longer valid: ' + recheck.errors.join(', '));
    }
    throw new Error(
      'SdkLettaTurnClient: Brain Bridge service endpoint not yet deployed. ' +
      'The dashboard communicates with Brain Bridge over a protocol boundary, ' +
      'not via direct SDK import.',
    );
  }
}
