// Phase 1 Lane A - review queue builders and decision transitions.

import { describe, expect, it } from 'vitest';
import type { IdentityActor } from '../src/lib/business/identity/confidence';
import {
  buildReviewItem,
  decideReviewItem,
  expireReviewItem,
  isReviewExpired,
  REVIEW_TTL_HOURS,
  type ReviewItem,
} from '../src/lib/business/identity/review-queue';

const owner: IdentityActor = { kind: 'human', id: 'owner', role: 'owner' };
const ai: IdentityActor = { kind: 'ai', id: 'llm' };
const system: IdentityActor = { kind: 'system', id: 'sweeper' };
const T0 = '2026-09-08T12:00:00.000Z';
const T1 = '2026-09-09T12:00:00.000Z';

function openItem(): ReviewItem {
  const r = buildReviewItem({
    subject_type: 'gmail_message',
    subject_id: 'msg-1',
    candidate_entity_type: 'project',
    candidate_entity_id: null,
    reason: 'two projects matched the same order number',
    signals: [{ signal: 'order_number', project_ids: ['a', 'b'] }],
  }, T0);
  if (!r.ok) throw new Error(r.reason);
  return r.item;
}

describe('buildReviewItem', () => {
  it('builds an open, undecided item', () => {
    const item = openItem();
    expect(item.status).toBe('open');
    expect(item.decided_by).toBeNull();
    expect(item.decided_at).toBeNull();
    expect(item.created_at).toBe(T0);
    expect(item.signals).toHaveLength(1);
  });

  it('refuses incomplete input', () => {
    expect(buildReviewItem({
      subject_type: '', candidate_entity_type: 'project', reason: 'x',
    }, T0).ok).toBe(false);
    expect(buildReviewItem({
      subject_type: 's', candidate_entity_type: 'project', reason: '',
    }, T0).ok).toBe(false);
    expect(buildReviewItem({
      subject_type: 's',
      candidate_entity_type: 'invoice' as unknown as 'project',
      reason: 'x',
    }, T0).ok).toBe(false);
  });
});

describe('decideReviewItem', () => {
  it('a human confirms or rejects an open item without mutating it', () => {
    const item = openItem();
    const ok = decideReviewItem(item, 'confirmed', owner, T1);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.item.status).toBe('confirmed');
    expect(ok.item.decided_by).toBe('owner');
    expect(ok.item.decided_at).toBe(T1);
    expect(item.status).toBe('open');
    const rej = decideReviewItem(item, 'rejected', owner, T1);
    expect(rej.ok && rej.item.status === 'rejected').toBe(true);
  });

  it('AI and system actors cannot decide', () => {
    const item = openItem();
    expect(decideReviewItem(item, 'confirmed', ai, T1)).toEqual({
      ok: false, reason: 'decision_requires_human',
    });
    expect(decideReviewItem(item, 'confirmed', system, T1).ok).toBe(false);
    expect(decideReviewItem(item, 'rejected', ai, T1).ok).toBe(false);
  });

  it('only open items can be decided, and only once', () => {
    const item = openItem();
    const first = decideReviewItem(item, 'confirmed', owner, T1);
    if (!first.ok) throw new Error('unexpected');
    const second = decideReviewItem(first.item, 'rejected', owner, T1);
    expect(second.ok).toBe(false);
    expect(decideReviewItem(item, 'maybe' as 'confirmed', owner, T1).ok)
      .toBe(false);
  });
});

describe('expiry', () => {
  it('expires only after the TTL and only from open', () => {
    const item = openItem();
    expect(isReviewExpired(item, T1)).toBe(false);
    expect(expireReviewItem(item, system, T1)).toEqual({
      ok: false, reason: 'not_expired_yet',
    });
    const later = new Date(
      Date.parse(T0) + REVIEW_TTL_HOURS * 3_600_000,
    ).toISOString();
    expect(isReviewExpired(item, later)).toBe(true);
    const exp = expireReviewItem(item, system, later);
    expect(exp.ok && exp.item.status === 'expired').toBe(true);
    expect(exp.ok && exp.item.decided_by === 'sweeper').toBe(true);
    const decided = decideReviewItem(item, 'confirmed', owner, T1);
    if (!decided.ok) throw new Error('unexpected');
    expect(isReviewExpired(decided.item, later)).toBe(false);
    expect(expireReviewItem(decided.item, system, later).ok).toBe(false);
  });
});
