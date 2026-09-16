import type {
  BrainMemoryCandidate,
  BrainReasoner,
  BrainReasoningRequest,
  BrainReasoningResult,
} from './types';

// Narrow port around Letta. The concrete SDK/App Server client is injected so
// Preston never hands Letta a Supabase client, approval client, shell, or other
// control-plane authority. This port carries context in and text/candidates out.
export interface LettaTurnInput {
  prompt: string;
  mode: 'analysis' | 'planning' | 'synthesis' | 'review';
  actor: string;
  correlation_id: string;
  context: Array<{
    memory_type: string;
    memory_class: string;
    key: string;
    value: unknown;
    source: string;
    version: number;
    created_at: string;
  }>;
  max_memory_candidates: number;
}

export interface LettaTurnOutput {
  response: string;
  memory_candidates?: BrainMemoryCandidate[];
}

export interface LettaTurnClient {
  runTurn(input: LettaTurnInput): Promise<LettaTurnOutput>;
}

export class LettaBrainReasoner implements BrainReasoner {
  readonly id = 'letta';
  readonly capabilities = ['reason'] as const;

  constructor(private readonly client: LettaTurnClient) {}

  async reason(request: BrainReasoningRequest): Promise<BrainReasoningResult> {
    const maxMemoryCandidates = Math.max(0, Math.min(request.max_memory_candidates ?? 5, 20));
    const output = await this.client.runTurn({
      prompt: request.prompt,
      mode: request.mode ?? 'analysis',
      actor: request.actor,
      correlation_id: request.correlation_id,
      context: (request.context ?? []).slice(0, 50).map((item) => ({
        memory_type: item.memory_type,
        memory_class: item.memory_class,
        key: item.key,
        value: item.value,
        source: item.source,
        version: item.version,
        created_at: item.created_at,
      })),
      max_memory_candidates: maxMemoryCandidates,
    });

    return {
      provider_id: this.id,
      response: output.response,
      memory_candidates: (output.memory_candidates ?? []).slice(0, maxMemoryCandidates),
    };
  }
}
