import { assertBrainCapability, evaluateMemoryCandidate } from './policy';
import type {
  BrainContextItem,
  BrainMemoryCandidate,
  BrainMemorySink,
  BrainProvider,
  BrainQuery,
} from './types';

export class PrestonBrain {
  constructor(
    private readonly provider: BrainProvider,
    private readonly memorySink?: BrainMemorySink,
  ) {}

  get providerId(): string {
    return this.provider.id;
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
