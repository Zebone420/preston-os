// Phase 1 Lane A - identity review queue (pure builders + transitions).
//
// Ambiguous or AI-proposed matches never merge on their own: they
// become an open review item that a human decides. This module builds
// the rows and enforces the decision rules; persistence is in store.ts.
//
//   open -> confirmed   (human only)
//   open -> rejected    (human only)
//   open -> expired     (system or human, after the TTL)
//   anything else       refused

import { isHumanActor, type IdentityActor } from './confidence';

export type ReviewStatus = 'open' | 'confirmed' | 'rejected' | 'expired';

export type ReviewEntityType =
  | 'client'
  | 'contact'
  | 'property'
  | 'project'
  | 'lead'
  | 'communication';

export const REVIEW_ENTITY_TYPES: readonly ReviewEntityType[] = [
  'client',
  'contact',
  'property',
  'project',
  'lead',
  'communication',
] as const;

// Open items expire after 14 days without a decision; expiry is a
// housekeeping transition and never implies a merge.
export const REVIEW_TTL_HOURS = 24 * 14;

export interface ReviewItemInput {
  subject_type: string;
  subject_id?: string | null;
  candidate_entity_type: ReviewEntityType;
  candidate_entity_id?: string | null;
  reason: string;
  signals?: unknown[];
}

export interface ReviewItem {
  id?: string;
  subject_type: string;
  subject_id: string | null;
  candidate_entity_type: ReviewEntityType;
  candidate_entity_id: string | null;
  reason: string;
  signals: unknown[];
  status: ReviewStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export type ReviewDecision = 'confirmed' | 'rejected';

export type ReviewResult =
  | { ok: true; item: ReviewItem }
  | { ok: false; reason: string };

export function isReviewEntityType(v: unknown): v is ReviewEntityType {
  return (
    typeof v === 'string' &&
    (REVIEW_ENTITY_TYPES as readonly string[]).includes(v)
  );
}

export function buildReviewItem(
  input: ReviewItemInput,
  nowIso: string,
): ReviewResult {
  if (
    typeof input.subject_type !== 'string' ||
    input.subject_type.length === 0
  ) {
    return { ok: false, reason: 'subject_type required' };
  }
  if (!isReviewEntityType(input.candidate_entity_type)) {
    return { ok: false, reason: 'invalid candidate_entity_type' };
  }
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    return { ok: false, reason: 'reason required' };
  }
  return {
    ok: true,
    item: {
      subject_type: input.subject_type,
      subject_id: input.subject_id ?? null,
      candidate_entity_type: input.candidate_entity_type,
      candidate_entity_id: input.candidate_entity_id ?? null,
      reason: input.reason,
      signals: Array.isArray(input.signals) ? [...input.signals] : [],
      status: 'open',
      decided_by: null,
      decided_at: null,
      created_at: nowIso,
    },
  };
}

// Returns a NEW item; the input is never mutated.
export function decideReviewItem(
  item: ReviewItem,
  decision: ReviewDecision,
  actor: IdentityActor,
  nowIso: string,
): ReviewResult {
  if (decision !== 'confirmed' && decision !== 'rejected') {
    return { ok: false, reason: 'invalid decision' };
  }
  if (item.status !== 'open') {
    return { ok: false, reason: `item is ${item.status}, not open` };
  }
  if (!isHumanActor(actor)) {
    return { ok: false, reason: 'decision_requires_human' };
  }
  return {
    ok: true,
    item: {
      ...item,
      status: decision,
      decided_by: actor.id,
      decided_at: nowIso,
    },
  };
}

export function isReviewExpired(
  item: ReviewItem,
  nowIso: string,
  ttlHours: number = REVIEW_TTL_HOURS,
): boolean {
  if (item.status !== 'open') return false;
  const created = Date.parse(item.created_at);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(created) || !Number.isFinite(now)) return false;
  return now - created >= ttlHours * 3_600_000;
}

// Expiry is the only non-human transition. It records who ran the
// sweep (system actor id) in decided_by for the audit trail.
export function expireReviewItem(
  item: ReviewItem,
  actor: IdentityActor,
  nowIso: string,
  ttlHours: number = REVIEW_TTL_HOURS,
): ReviewResult {
  if (item.status !== 'open') {
    return { ok: false, reason: `item is ${item.status}, not open` };
  }
  if (!isReviewExpired(item, nowIso, ttlHours)) {
    return { ok: false, reason: 'not_expired_yet' };
  }
  return {
    ok: true,
    item: {
      ...item,
      status: 'expired',
      decided_by: actor.id,
      decided_at: nowIso,
    },
  };
}
