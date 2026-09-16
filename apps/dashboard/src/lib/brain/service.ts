import { assertBrainCapability, evaluateMemoryCandidate } from './policy';
import type {
  BrainContextItem,
  BrainMemoryCandidate,
  BrainMemorySink,
  BrainProvider,
  BrainQuery,
  BrainReasoner,
  BrainReasoningRequest,
  BrainReasoningResult,
} from './types';

export class PrestonBrain {
  constructor(
    private readonly provider: BrainProvider,
    private readonly memorySink?: BrainMemorySink,
    private readonly reasoner?: BrainReasoner,
  ) {}

  get providerId(): string {
    return this.provider.id;
  }

  get reasonerId(): string | null {
    return this.reasoner?.id ?? null;
  }

  async recall(query: BrainQuery): Promise<BrainContextItem[]> {
    const capability = assertBrainCapability('recall');
    if (!capability.allowed || !this.provider.capabilities.includes('recall')) return [];

    const bounded: BrainQuery = {
      ...query,
      limit: Math.max(1, Math.min(query.limit ?? 12, 50)),
    };
    return this.provider.recall(bounded);
  }

  async think(request: BrainReasoningRequest): Promise<BrainReasoningResult> {
    const capability = assertBrainCapability('reason');
    if (!capability.allowed || !this.reasoner || !this.reasoner.capabilities.includes('reason')) {
      return { provider_id: 'none', response: '', memory_candidates: [] };
    }

    const bounded: BrainReasoningRequest = {
      ...request,
      context: (request.context ?? []).slice(0, 50),
      max_memory_candidates: Math.max(0, Math.min(request.max_memory_candidates ?? 5, 20)),
    };
    const result = await this.reasoner.reason(bounded);

    // Provider-proposed durable memory is untrusted output. Invalid, secret,
    // or authority-bearing candidates never leave the Brain service as eligible.
    const maxCandidates = bounded.max_memory_candidates ?? 5;
    const memoryCandidates = result.memory_candidates
      .slice(0, maxCandidates)
      .filter((candidate) => evaluateMemoryCandidate(candidate).allowed);

    return {
      provider_id: result.provider_id,
      response: result.response,
      memory_candidates: memoryCandidates,
    };
  }

  async remember(
    candidate: BrainMemoryCandidate,
  ): Promise<{ ok: boolean; blocked?: boolean; reasons?: string[]; id?: string; error?: string }> {
    const capability = assertBrainCapability('propose_memory');
    if (!capability.allowed) {
      return { ok: false, blocked: true, reasons: capability.reasons };
    }
    if (!this.memorySink) return { ok: false, error: 'brain memory sink not configured' };

    const decision = evaluateMemoryCandidate(candidate);
    if (!decision.allowed) {
      return { ok: false, blocked: true, reasons: decision.reasons };
    }

    return this.memorySink.append({ ...candidate, value: decision.sanitized_value });
  }
}
