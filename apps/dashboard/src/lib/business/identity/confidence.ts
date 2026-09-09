// Phase 1 Lane A - identity confidence ladder (plan section 4.3).
//
//   orphan -> candidate -> linked_auto -> confirmed
//
// Rules pinned here and mirrored by migration 0028 RLS:
//   * deterministic identifiers first; model matching may only PROPOSE;
//   * 'confirmed' is reachable only through a human actor (owner or
//     staff) - never an AI or system actor;
//   * consequential use (EXTERNAL / STEP_UP actions, quote math, live
//     messages) requires 'confirmed' - nothing less;
//   * AI confidence alone never merges two business entities.

export type IdentityConfidence =
  | 'orphan'
  | 'candidate'
  | 'linked_auto'
  | 'confirmed';

export const CONFIDENCE_LADDER: readonly IdentityConfidence[] = [
  'orphan',
  'candidate',
  'linked_auto',
  'confirmed',
] as const;

export type ActorKind = 'human' | 'ai' | 'system';

export type HumanRole = 'owner' | 'staff';

export interface IdentityActor {
  kind: ActorKind;
  id: string;
  role?: HumanRole;
}

export interface TransitionVerdict {
  ok: boolean;
  reason?: string;
}

export function isIdentityConfidence(v: unknown): v is IdentityConfidence {
  return (
    typeof v === 'string' &&
    (CONFIDENCE_LADDER as readonly string[]).includes(v)
  );
}

export function confidenceRank(c: IdentityConfidence): number {
  return CONFIDENCE_LADDER.indexOf(c);
}

export function isHumanActor(actor: IdentityActor): boolean {
  return (
    actor.kind === 'human' &&
    typeof actor.id === 'string' &&
    actor.id.length > 0 &&
    (actor.role === 'owner' || actor.role === 'staff')
  );
}

// Whether `actor` may move a link from `from` to `to`.
//   * no-op transitions are refused (nothing to record);
//   * INTO confirmed: human only;
//   * INTO linked_auto: system (deterministic matcher) or human - an AI
//     actor may never assert an automatic link;
//   * INTO candidate: any actor (this is the only thing AI may do);
//   * any downward move (unlink / demote): human only - reversing an
//     identity decision is itself a decision.
export function allowedTransition(
  from: IdentityConfidence,
  to: IdentityConfidence,
  actor: IdentityActor,
): TransitionVerdict {
  if (!isIdentityConfidence(from) || !isIdentityConfidence(to)) {
    return { ok: false, reason: 'unknown_confidence' };
  }
  if (from === to) return { ok: false, reason: 'no_change' };
  const human = isHumanActor(actor);
  if (confidenceRank(to) < confidenceRank(from)) {
    return human ? { ok: true } : { ok: false, reason: 'demotion_requires_human' };
  }
  if (to === 'confirmed') {
    return human
      ? { ok: true }
      : { ok: false, reason: 'confirmation_requires_human' };
  }
  if (to === 'linked_auto') {
    if (actor.kind === 'ai') {
      return { ok: false, reason: 'ai_cannot_link_auto' };
    }
    return { ok: true };
  }
  // to === 'candidate'
  return { ok: true };
}

// The single gate every consequential path must call. Anything below
// 'confirmed' - including a deterministic linked_auto - is display and
// review only.
export function consequentialUseAllowed(
  confidence: IdentityConfidence,
): boolean {
  return confidence === 'confirmed';
}

// What an AI matcher may propose: only orphan -> candidate. It can
// never propose INTO confirmed (or linked_auto), and it cannot
// re-propose over an existing candidate/link.
export function aiMayPropose(
  from: IdentityConfidence,
  to: IdentityConfidence,
): boolean {
  if (to === 'confirmed' || to === 'linked_auto') return false;
  return from === 'orphan' && to === 'candidate';
}
