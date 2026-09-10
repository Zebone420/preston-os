// Candidate facts + human-gated state machine (master build plan 6.5).
//
// EXTRACTED_CANDIDATE -> VERIFIED -> AUTHORIZED_FOR_USE, human only for
// both promotions. Any state may be REJECTED (human) or SUPERSEDED. A
// fact with no citation is invalid in every state - the fabric stores
// nothing it cannot point back to a registered chunk for.

import type { Citation } from './types';
import { isKnowledgeDomain } from './domains';

export const FACT_STATES = [
  'EXTRACTED_CANDIDATE',
  'VERIFIED',
  'AUTHORIZED_FOR_USE',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type FactState = (typeof FACT_STATES)[number];

export const CRITICALITY = [
  'informational',
  'quote_critical',
  'order_critical',
  'compliance_critical',
] as const;
export type Criticality = (typeof CRITICALITY)[number];

export const FACT_PURPOSES = [
  'draft_hint',
  'internal_reference',
  'quote',
  'order',
  'compliance',
] as const;
export type FactPurpose = (typeof FACT_PURPOSES)[number];

export interface Actor {
  id: string;
  kind: 'human' | 'ai' | 'system';
}

export interface KnowledgeFact {
  id?: string;
  domain: string;
  project_id?: string | null;
  subject: string;
  predicate: string;
  object: string;
  value_json?: Record<string, unknown>;
  criticality: Criticality;
  state: FactState;
  citations: Citation[];
  extracted_by: string;
  verified_by?: string | null;
  verified_at?: string | null;
  authorized_by?: string | null;
  authorized_at?: string | null;
  supersedes_fact_id?: string | null;
}

export const TRANSITIONS: Record<FactState, readonly FactState[]> = {
  EXTRACTED_CANDIDATE: ['VERIFIED', 'REJECTED', 'SUPERSEDED'],
  VERIFIED: ['AUTHORIZED_FOR_USE', 'REJECTED', 'SUPERSEDED'],
  AUTHORIZED_FOR_USE: ['REJECTED', 'SUPERSEDED'],
  REJECTED: [],
  SUPERSEDED: [],
};

// Human-only decisions. SUPERSEDED may be applied by the system when a
// newer authorized fact replaces an older one.
export const HUMAN_ONLY_STATES: readonly FactState[] = [
  'VERIFIED',
  'AUTHORIZED_FOR_USE',
  'REJECTED',
];

export function isFactState(v: unknown): v is FactState {
  return typeof v === 'string' && (FACT_STATES as readonly string[]).includes(v);
}

export function isCriticality(v: unknown): v is Criticality {
  return typeof v === 'string' && (CRITICALITY as readonly string[]).includes(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

export interface Validation {
  ok: boolean;
  errors: string[];
}

export function validateCitations(citations: unknown): Validation {
  const errors: string[] = [];
  if (!Array.isArray(citations)) return { ok: false, errors: ['citations_not_array'] };
  if (citations.length === 0) errors.push('citations_empty');
  citations.forEach((c, i) => {
    if (!c || typeof c !== 'object') {
      errors.push(`citation_${i}_not_object`);
      return;
    }
    const o = c as Record<string, unknown>;
    if (!nonEmpty(o.source_id)) errors.push(`citation_${i}_missing_source_id`);
    if (!nonEmpty(o.chunk_id)) errors.push(`citation_${i}_missing_chunk_id`);
    if (!nonEmpty(o.quote)) errors.push(`citation_${i}_missing_quote`);
  });
  return { ok: errors.length === 0, errors };
}

export function validateFact(fact: KnowledgeFact): Validation {
  const errors: string[] = [];
  if (!fact || typeof fact !== 'object') return { ok: false, errors: ['fact_missing'] };
  if (!isKnowledgeDomain(fact.domain)) errors.push('unknown_domain');
  if (!nonEmpty(fact.subject)) errors.push('subject_required');
  if (!nonEmpty(fact.predicate)) errors.push('predicate_required');
  if (typeof fact.object !== 'string') errors.push('object_required');
  if (!isCriticality(fact.criticality)) errors.push('invalid_criticality');
  if (!isFactState(fact.state)) errors.push('invalid_state');
  if (!nonEmpty(fact.extracted_by)) errors.push('extracted_by_required');
  errors.push(...validateCitations(fact.citations).errors);
  if (
    (fact.state === 'VERIFIED' || fact.state === 'AUTHORIZED_FOR_USE') &&
    !nonEmpty(fact.verified_by)
  ) {
    errors.push('verified_by_required');
  }
  if (fact.state === 'AUTHORIZED_FOR_USE' && !nonEmpty(fact.authorized_by)) {
    errors.push('authorized_by_required');
  }
  return { ok: errors.length === 0, errors };
}

export interface TransitionCheck {
  ok: boolean;
  reason:
    | 'ok'
    | 'invalid_state'
    | 'transition_not_allowed'
    | 'human_actor_required'
    | 'invalid_actor';
}

function validActor(actor: unknown): actor is Actor {
  if (!actor || typeof actor !== 'object') return false;
  const a = actor as Record<string, unknown>;
  return nonEmpty(a.id) && ['human', 'ai', 'system'].includes(String(a.kind));
}

export function canTransition(
  from: FactState,
  to: FactState,
  actor: Actor,
): TransitionCheck {
  if (!isFactState(from) || !isFactState(to)) {
    return { ok: false, reason: 'invalid_state' };
  }
  if (!validActor(actor)) return { ok: false, reason: 'invalid_actor' };
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: 'transition_not_allowed' };
  }
  if (HUMAN_ONLY_STATES.includes(to) && actor.kind !== 'human') {
    return { ok: false, reason: 'human_actor_required' };
  }
  return { ok: true, reason: 'ok' };
}

export interface TransitionResult {
  ok: boolean;
  fact?: KnowledgeFact;
  error?: string;
}

// Pure transition: returns the fact as it would be after the change.
export function applyTransition(
  fact: KnowledgeFact,
  to: FactState,
  actor: Actor,
  nowIso: string,
): TransitionResult {
  const v = validateFact(fact);
  if (!v.ok) return { ok: false, error: 'invalid_fact: ' + v.errors.join(',') };
  const check = canTransition(fact.state, to, actor);
  if (!check.ok) return { ok: false, error: check.reason };
  const next: KnowledgeFact = { ...fact, state: to };
  if (to === 'VERIFIED') {
    next.verified_by = actor.id;
    next.verified_at = nowIso;
  }
  if (to === 'AUTHORIZED_FOR_USE') {
    next.authorized_by = actor.id;
    next.authorized_at = nowIso;
  }
  const after = validateFact(next);
  if (!after.ok) return { ok: false, error: 'invalid_fact: ' + after.errors.join(',') };
  return { ok: true, fact: next };
}

export interface UsableDecision {
  usable: boolean;
  reason:
    | 'ok'
    | 'invalid_fact'
    | 'no_citations'
    | 'unknown_purpose'
    | 'fact_retired'
    | 'authorization_required'
    | 'verification_required';
}

export const CRITICAL_PURPOSES: readonly FactPurpose[] = [
  'quote',
  'order',
  'compliance',
];

// Purpose gate. Critical purposes need AUTHORIZED_FOR_USE with at least
// one citation; candidates are usable only as draft hints.
export function usableForPurpose(
  fact: KnowledgeFact,
  purpose: FactPurpose,
): UsableDecision {
  if (!(FACT_PURPOSES as readonly string[]).includes(purpose)) {
    return { usable: false, reason: 'unknown_purpose' };
  }
  if (!fact || !isFactState(fact.state)) {
    return { usable: false, reason: 'invalid_fact' };
  }
  if (!validateCitations(fact.citations).ok) {
    return { usable: false, reason: 'no_citations' };
  }
  if (fact.state === 'REJECTED' || fact.state === 'SUPERSEDED') {
    return { usable: false, reason: 'fact_retired' };
  }
  if (CRITICAL_PURPOSES.includes(purpose)) {
    if (fact.state !== 'AUTHORIZED_FOR_USE') {
      return { usable: false, reason: 'authorization_required' };
    }
    return { usable: true, reason: 'ok' };
  }
  if (purpose === 'internal_reference') {
    if (fact.state === 'EXTRACTED_CANDIDATE') {
      return { usable: false, reason: 'verification_required' };
    }
    return { usable: true, reason: 'ok' };
  }
  // draft_hint: any live, cited fact (including candidates).
  return { usable: true, reason: 'ok' };
}
