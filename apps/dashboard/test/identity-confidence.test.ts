// Phase 1 Lane A - identity confidence ladder pins.

import { describe, expect, it } from 'vitest';
import {
  aiMayPropose,
  allowedTransition,
  CONFIDENCE_LADDER,
  confidenceRank,
  consequentialUseAllowed,
  isHumanActor,
  isIdentityConfidence,
  type IdentityActor,
  type IdentityConfidence,
} from '../src/lib/business/identity/confidence';

const owner: IdentityActor = { kind: 'human', id: 'owner', role: 'owner' };
const staff: IdentityActor = { kind: 'human', id: 'staff-1', role: 'staff' };
const ai: IdentityActor = { kind: 'ai', id: 'matcher-llm' };
const system: IdentityActor = { kind: 'system', id: 'deterministic-matcher' };

describe('ladder shape', () => {
  it('is orphan -> candidate -> linked_auto -> confirmed', () => {
    expect(CONFIDENCE_LADDER).toEqual([
      'orphan', 'candidate', 'linked_auto', 'confirmed',
    ]);
    expect(confidenceRank('orphan')).toBe(0);
    expect(confidenceRank('confirmed')).toBe(3);
    expect(isIdentityConfidence('linked_auto')).toBe(true);
    expect(isIdentityConfidence('verified')).toBe(false);
  });

  it('recognizes only owner/staff humans with an id', () => {
    expect(isHumanActor(owner)).toBe(true);
    expect(isHumanActor(staff)).toBe(true);
    expect(isHumanActor({ kind: 'human', id: 'x' })).toBe(false);
    expect(isHumanActor({ kind: 'human', id: '', role: 'owner' })).toBe(false);
    expect(isHumanActor(ai)).toBe(false);
    expect(isHumanActor({ kind: 'ai', id: 'x', role: 'owner' })).toBe(false);
  });
});

describe('allowedTransition', () => {
  it('AI can only propose orphan -> candidate', () => {
    expect(allowedTransition('orphan', 'candidate', ai).ok).toBe(true);
    expect(allowedTransition('orphan', 'linked_auto', ai)).toEqual({
      ok: false, reason: 'ai_cannot_link_auto',
    });
    expect(allowedTransition('candidate', 'linked_auto', ai).ok).toBe(false);
  });

  it('AI can NEVER reach confirmed from any state', () => {
    for (const from of CONFIDENCE_LADDER) {
      if (from === 'confirmed') continue;
      const v = allowedTransition(from, 'confirmed', ai);
      expect(v.ok).toBe(false);
      expect(v.reason).toBe('confirmation_requires_human');
    }
  });

  it('the deterministic system may link_auto but never confirm', () => {
    expect(allowedTransition('orphan', 'linked_auto', system).ok).toBe(true);
    expect(allowedTransition('candidate', 'linked_auto', system).ok).toBe(true);
    expect(allowedTransition('linked_auto', 'confirmed', system).ok).toBe(false);
    expect(allowedTransition('candidate', 'confirmed', system).ok).toBe(false);
  });

  it('only a human (owner or staff) confirms', () => {
    expect(allowedTransition('linked_auto', 'confirmed', owner).ok).toBe(true);
    expect(allowedTransition('candidate', 'confirmed', staff).ok).toBe(true);
    expect(allowedTransition('orphan', 'confirmed', owner).ok).toBe(true);
    const noRole: IdentityActor = { kind: 'human', id: 'anon' };
    expect(allowedTransition('linked_auto', 'confirmed', noRole).ok).toBe(false);
  });

  it('demotion (unlink) is a human decision; no-ops are refused', () => {
    expect(allowedTransition('confirmed', 'orphan', system)).toEqual({
      ok: false, reason: 'demotion_requires_human',
    });
    expect(allowedTransition('linked_auto', 'candidate', ai).ok).toBe(false);
    expect(allowedTransition('confirmed', 'orphan', owner).ok).toBe(true);
    expect(allowedTransition('linked_auto', 'orphan', staff).ok).toBe(true);
    expect(allowedTransition('candidate', 'candidate', owner)).toEqual({
      ok: false, reason: 'no_change',
    });
  });

  it('refuses unknown states', () => {
    const bogus = 'verified' as IdentityConfidence;
    expect(allowedTransition(bogus, 'confirmed', owner).ok).toBe(false);
    expect(allowedTransition('orphan', bogus, owner).ok).toBe(false);
  });
});

describe('consequential use and AI proposals', () => {
  it('consequential use requires confirmed - nothing less', () => {
    expect(consequentialUseAllowed('confirmed')).toBe(true);
    expect(consequentialUseAllowed('linked_auto')).toBe(false);
    expect(consequentialUseAllowed('candidate')).toBe(false);
    expect(consequentialUseAllowed('orphan')).toBe(false);
  });

  it('aiMayPropose is true only for orphan -> candidate', () => {
    for (const from of CONFIDENCE_LADDER) {
      for (const to of CONFIDENCE_LADDER) {
        const expected = from === 'orphan' && to === 'candidate';
        expect(aiMayPropose(from, to)).toBe(expected);
      }
    }
  });

  it('aiMayPropose never returns true for a transition INTO confirmed', () => {
    for (const from of CONFIDENCE_LADDER) {
      expect(aiMayPropose(from, 'confirmed')).toBe(false);
      expect(aiMayPropose(from, 'linked_auto')).toBe(false);
    }
  });
});
