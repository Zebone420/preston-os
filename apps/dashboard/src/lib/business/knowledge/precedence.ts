// Source precedence: current over historical, owner rulings over
// document text (master build plan 5.5 / 5.7; metric "wrong-current-
// document use = 0").
//
// Implemented as a TIER override, not a soft multiplier: a hit from a
// lower tier can never outrank a hit from a higher tier however strong
// its lexical score. Within a tier the authority weight scales the score.

import type { AuthorityClass, KnowledgeSource } from './types';

// Tier 3: owner rulings (context/ verified facts) always win over any
// document text. Tier 2: current documents. Tier 1: historical. Tier 0:
// superseded (or flagged not current).
export const AUTHORITY_TIER: Record<AuthorityClass, number> = {
  OWNER_RULED_CURRENT: 3,
  OFFICIAL_CURRENT: 2,
  INTERNAL_APPROVED: 2,
  PROJECT_RECORD: 2,
  CLIENT_EXECUTED: 2,
  THIRD_PARTY_REFERENCE: 2,
  HISTORICAL: 1,
  SUPERSEDED: 0,
};

export const AUTHORITY_WEIGHT: Record<AuthorityClass, number> = {
  OWNER_RULED_CURRENT: 1.0,
  OFFICIAL_CURRENT: 1.0,
  INTERNAL_APPROVED: 0.9,
  PROJECT_RECORD: 0.85,
  CLIENT_EXECUTED: 0.85,
  THIRD_PARTY_REFERENCE: 0.6,
  HISTORICAL: 0.4,
  SUPERSEDED: 0.2,
};

export type PrecedenceSource = Pick<
  KnowledgeSource,
  'authority_class' | 'is_current' | 'superseded_by'
>;

export function isOwnerRuling(s: PrecedenceSource): boolean {
  return s.authority_class === 'OWNER_RULED_CURRENT' && s.is_current === true;
}

export function authorityTier(s: PrecedenceSource): number {
  const base = AUTHORITY_TIER[s.authority_class] ?? 0;
  // A source flagged superseded or not current drops to the bottom tier
  // whatever its declared class says.
  if (s.superseded_by || s.is_current === false) return Math.min(base, 0);
  return base;
}

export function authorityWeight(s: PrecedenceSource): number {
  const base = AUTHORITY_WEIGHT[s.authority_class] ?? 0;
  if (s.superseded_by || s.is_current === false) {
    return Math.min(base, AUTHORITY_WEIGHT.SUPERSEDED);
  }
  return base;
}

// Composite rank key: tier dominates, weighted score orders within tier.
// The tier gap (1000) exceeds any realistic weighted lexical score.
export const TIER_SPAN = 1000;

export function rankKey(s: PrecedenceSource, score: number): number {
  const safe = Number.isFinite(score) && score > 0 ? score : 0;
  return authorityTier(s) * TIER_SPAN + safe * authorityWeight(s);
}

// Stable ordering of sources by precedence (tier desc, then declared
// weight desc, then original order). A historical/superseded source is
// never placed above a current one.
export function currentOverHistorical<T extends PrecedenceSource>(
  sources: readonly T[],
): T[] {
  return sources
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const t = authorityTier(b.s) - authorityTier(a.s);
      if (t !== 0) return t;
      const w = authorityWeight(b.s) - authorityWeight(a.s);
      if (w !== 0) return w;
      return a.i - b.i;
    })
    .map((x) => x.s);
}
