// Fact state machine pins: AI cannot verify/authorize; critical purposes
// need AUTHORIZED_FOR_USE + citation; no citation => invalid everywhere.

import { describe, expect, it } from 'vitest';
import {
  applyTransition,
  canTransition,
  FACT_STATES,
  TRANSITIONS,
  usableForPurpose,
  validateFact,
  type Actor,
  type FactPurpose,
  type FactState,
  type KnowledgeFact,
} from '../src/lib/business/knowledge/facts';

const human: Actor = { id: 'owner', kind: 'human' };
const ai: Actor = { id: 'extractor-worker', kind: 'ai' };
const system: Actor = { id: 'runtime', kind: 'system' };
const NOW = '2026-09-08T00:00:00.000Z';

function fact(over: Partial<KnowledgeFact> = {}): KnowledgeFact {
  return {
    domain: 'PRESTON_SOP',
    subject: 'sill pan',
    predicate: 'required_for',
    object: 'every window installation',
    criticality: 'informational',
    state: 'EXTRACTED_CANDIDATE',
    citations: [{ source_id: 's1', chunk_id: 'c1', quote: 'a sill pan is required' }],
    extracted_by: 'extractor-worker',
    ...over,
  };
}

describe('fact validation', () => {
  it('requires at least one complete citation in every state', () => {
    for (const state of FACT_STATES) {
      const base = fact({
        state,
        verified_by: 'owner',
        authorized_by: 'owner',
        citations: [],
      });
      expect(validateFact(base).ok, state).toBe(false);
      expect(validateFact(base).errors).toContain('citations_empty');
    }
    const partial = fact({ citations: [{ source_id: 's1', chunk_id: '', quote: 'q' }] });
    expect(validateFact(partial).errors).toContain('citation_0_missing_chunk_id');
    expect(validateFact(fact({ citations: 'none' as unknown as [] })).ok).toBe(false);
  });

  it('VERIFIED / AUTHORIZED rows need the human columns filled', () => {
    expect(validateFact(fact({ state: 'VERIFIED' })).errors)
      .toContain('verified_by_required');
    expect(validateFact(fact({ state: 'AUTHORIZED_FOR_USE', verified_by: 'o' })).errors)
      .toContain('authorized_by_required');
    expect(validateFact(fact({
      state: 'AUTHORIZED_FOR_USE', verified_by: 'o', authorized_by: 'o',
    })).ok).toBe(true);
  });

  it('rejects unknown domain, criticality and state', () => {
    expect(validateFact(fact({ domain: 'GLOBAL' })).errors).toContain('unknown_domain');
    expect(validateFact(fact({ criticality: 'urgent' as never })).errors)
      .toContain('invalid_criticality');
    expect(validateFact(fact({ state: 'PUBLISHED' as never })).errors)
      .toContain('invalid_state');
  });
});

describe('transitions', () => {
  it('pins the state graph', () => {
    expect(TRANSITIONS.EXTRACTED_CANDIDATE).toEqual(['VERIFIED', 'REJECTED', 'SUPERSEDED']);
    expect(TRANSITIONS.VERIFIED).toEqual(['AUTHORIZED_FOR_USE', 'REJECTED', 'SUPERSEDED']);
    expect(TRANSITIONS.AUTHORIZED_FOR_USE).toEqual(['REJECTED', 'SUPERSEDED']);
    expect(TRANSITIONS.REJECTED).toEqual([]);
    expect(TRANSITIONS.SUPERSEDED).toEqual([]);
  });

  it('a candidate cannot skip verification', () => {
    expect(canTransition('EXTRACTED_CANDIDATE', 'AUTHORIZED_FOR_USE', human))
      .toEqual({ ok: false, reason: 'transition_not_allowed' });
  });

  it('only a human can verify, authorize or reject', () => {
    for (const actor of [ai, system]) {
      expect(canTransition('EXTRACTED_CANDIDATE', 'VERIFIED', actor).reason)
        .toBe('human_actor_required');
      expect(canTransition('VERIFIED', 'AUTHORIZED_FOR_USE', actor).reason)
        .toBe('human_actor_required');
      expect(canTransition('EXTRACTED_CANDIDATE', 'REJECTED', actor).reason)
        .toBe('human_actor_required');
    }
    expect(canTransition('EXTRACTED_CANDIDATE', 'VERIFIED', human).ok).toBe(true);
    expect(canTransition('VERIFIED', 'AUTHORIZED_FOR_USE', human).ok).toBe(true);
    // Supersession is a system-applicable bookkeeping move.
    expect(canTransition('AUTHORIZED_FOR_USE', 'SUPERSEDED', system).ok).toBe(true);
  });

  it('terminal states never move; bad actors are refused', () => {
    expect(canTransition('REJECTED', 'VERIFIED', human).ok).toBe(false);
    expect(canTransition('SUPERSEDED', 'AUTHORIZED_FOR_USE', human).ok).toBe(false);
    expect(canTransition('EXTRACTED_CANDIDATE', 'VERIFIED',
      { id: '', kind: 'human' }).reason).toBe('invalid_actor');
    expect(canTransition('EXTRACTED_CANDIDATE', 'VERIFIED',
      { id: 'x', kind: 'root' as never }).reason).toBe('invalid_actor');
    expect(canTransition('NEW' as FactState, 'VERIFIED', human).reason)
      .toBe('invalid_state');
  });

  it('applyTransition stamps the human columns and keeps citations', () => {
    const v = applyTransition(fact(), 'VERIFIED', human, NOW);
    expect(v.ok).toBe(true);
    expect(v.fact).toMatchObject({ state: 'VERIFIED', verified_by: 'owner', verified_at: NOW });
    const a = applyTransition(v.fact as KnowledgeFact, 'AUTHORIZED_FOR_USE', human, NOW);
    expect(a.fact).toMatchObject({
      state: 'AUTHORIZED_FOR_USE', authorized_by: 'owner', authorized_at: NOW,
    });
    expect(a.fact?.citations.length).toBe(1);
    expect(applyTransition(fact(), 'VERIFIED', ai, NOW))
      .toEqual({ ok: false, error: 'human_actor_required' });
    expect(applyTransition(fact({ citations: [] }), 'VERIFIED', human, NOW).error)
      .toMatch(/invalid_fact/);
  });
});

describe('usableForPurpose', () => {
  const critical: FactPurpose[] = ['quote', 'order', 'compliance'];

  it('candidates are usable only as draft hints', () => {
    const c = fact({ criticality: 'quote_critical' });
    expect(usableForPurpose(c, 'draft_hint').usable).toBe(true);
    expect(usableForPurpose(c, 'internal_reference'))
      .toEqual({ usable: false, reason: 'verification_required' });
    for (const p of critical) {
      expect(usableForPurpose(c, p)).toEqual({
        usable: false, reason: 'authorization_required',
      });
    }
  });

  it('VERIFIED is still not enough for quote/order/compliance', () => {
    const v = fact({ state: 'VERIFIED', verified_by: 'owner' });
    expect(usableForPurpose(v, 'internal_reference').usable).toBe(true);
    for (const p of critical) expect(usableForPurpose(v, p).usable).toBe(false);
  });

  it('AUTHORIZED_FOR_USE with a citation serves critical purposes', () => {
    const a = fact({ state: 'AUTHORIZED_FOR_USE', verified_by: 'o', authorized_by: 'o' });
    for (const p of critical) expect(usableForPurpose(a, p).usable).toBe(true);
    const noCite = { ...a, citations: [] };
    for (const p of critical) {
      expect(usableForPurpose(noCite, p)).toEqual({ usable: false, reason: 'no_citations' });
    }
    expect(usableForPurpose(noCite, 'draft_hint').usable).toBe(false);
  });

  it('retired facts and unknown purposes are never usable', () => {
    const r = fact({ state: 'REJECTED' });
    const s = fact({ state: 'SUPERSEDED' });
    for (const f of [r, s]) {
      expect(usableForPurpose(f, 'draft_hint')).toEqual({ usable: false, reason: 'fact_retired' });
    }
    expect(usableForPurpose(fact(), 'marketing' as FactPurpose).reason).toBe('unknown_purpose');
  });
});
