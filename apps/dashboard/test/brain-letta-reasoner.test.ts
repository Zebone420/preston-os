import { describe, expect, it } from 'vitest';
import { LettaBrainReasoner, type LettaTurnClient } from '../src/lib/brain/letta-reasoner';

const context = Array.from({ length: 60 }, (_, index) => ({
  memory_type: 'project' as const,
  memory_class: 'business' as const,
  key: `project-${index}`,
  value: { index },
  source: 'preston-agent-memory',
  actor: 'owner',
  version: 1,
  correlation_id: 'ctx',
  audit_ref: null,
  created_at: '2026-09-15T00:00:00.000Z',
}));

describe('LettaBrainReasoner', () => {
  it('passes only bounded context through the narrow Letta port', async () => {
    let observedContext = -1;
    let observedCandidates = -1;
    const client: LettaTurnClient = {
      async runTurn(input) {
        observedContext = input.context.length;
        observedCandidates = input.max_memory_candidates;
        expect(input).not.toHaveProperty('supabase');
        expect(input).not.toHaveProperty('approval');
        expect(input).not.toHaveProperty('shell');
        return { response: 'reasoned answer' };
      },
    };
    const reasoner = new LettaBrainReasoner(client);
    const result = await reasoner.reason({
      prompt: 'Review this project context',
      actor: 'owner',
      correlation_id: 'corr-1',
      context,
      max_memory_candidates: 100,
    });
    expect(observedContext).toBe(50);
    expect(observedCandidates).toBe(20);
    expect(result.response).toBe('reasoned answer');
    expect(result.memory_candidates).toEqual([]);
  });

  it('bounds memory suggestions returned by Letta', async () => {
    const client: LettaTurnClient = {
      async runTurn() {
        return {
          response: 'done',
          memory_candidates: Array.from({ length: 30 }, (_, index) => ({
            memory_type: 'decision' as const,
            memory_class: 'institutional' as const,
            key: `lesson-${index}`,
            value: { index },
            actor: 'letta',
            source: 'letta-reasoner',
            version: 1,
            correlation_id: 'corr-2',
            audit_ref: null,
          })),
        };
      },
    };
    const reasoner = new LettaBrainReasoner(client);
    const result = await reasoner.reason({
      prompt: 'Analyze',
      actor: 'owner',
      correlation_id: 'corr-2',
      max_memory_candidates: 3,
    });
    expect(result.memory_candidates).toHaveLength(3);
  });
});
