// Phase 6 - punch list operations + closure predicate (pure).
//
// Mirrors public.punch_items (migration 0035). Every operation returns a
// NEW item or a refusal; nothing is mutated in place. Closure rule (owner
// supplied): punch_closed requires no open item of severity functional or
// safety; a COSMETIC item may be waived, and only by the OWNER. A waiver
// on a functional/safety item is refused here and, defensively, blocks
// closure even if such a row somehow exists.

import {
  isLifecycleActor,
  isOwnerActor,
  isIsoTimestamp,
  isPunchSeverity,
  type LifecycleActor,
  type PunchSeverity,
  type PunchState,
} from './types';

export interface PunchItem {
  id: string;
  project_id: string;
  description: string;
  opening_code?: string | null;
  severity: PunchSeverity;
  photo_document_ids: string[];
  state: PunchState;
  resolved_at?: string | null;
  resolved_by?: string | null;
}

export type PunchResult =
  | { ok: true; item: PunchItem }
  | { ok: false; reason: string };

export interface OpenPunchItemInput {
  id: string;
  project_id: string;
  description: string;
  opening_code?: string | null;
  severity: PunchSeverity;
  photo_document_ids?: string[];
}

export function openPunchItem(input: OpenPunchItemInput): PunchResult {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    return { ok: false, reason: 'id required' };
  }
  if (typeof input.project_id !== 'string' || input.project_id.length === 0) {
    return { ok: false, reason: 'project_id required' };
  }
  if (
    typeof input.description !== 'string' ||
    input.description.trim().length === 0
  ) {
    return { ok: false, reason: 'description required' };
  }
  if (!isPunchSeverity(input.severity)) {
    return { ok: false, reason: 'invalid severity' };
  }
  return {
    ok: true,
    item: {
      id: input.id,
      project_id: input.project_id,
      description: input.description.trim(),
      opening_code: input.opening_code ?? null,
      severity: input.severity,
      photo_document_ids: [...(input.photo_document_ids ?? [])],
      state: 'open',
      resolved_at: null,
      resolved_by: null,
    },
  };
}

export function isOpenPunchItem(item: PunchItem): boolean {
  return item.state === 'open' || item.state === 'in_progress';
}

export function startPunchItem(item: PunchItem): PunchResult {
  if (item.state !== 'open') {
    return { ok: false, reason: `cannot start from ${item.state}` };
  }
  return { ok: true, item: { ...item, state: 'in_progress' } };
}

export function resolvePunchItem(
  item: PunchItem,
  actor: LifecycleActor,
  at: string,
): PunchResult {
  if (!isLifecycleActor(actor)) return { ok: false, reason: 'actor required' };
  if (!isIsoTimestamp(at)) return { ok: false, reason: 'timestamp required' };
  if (!isOpenPunchItem(item)) {
    return { ok: false, reason: `cannot resolve from ${item.state}` };
  }
  return {
    ok: true,
    item: {
      ...item,
      state: 'resolved',
      resolved_at: at,
      resolved_by: `${actor.kind}:${actor.id}`,
    },
  };
}

// Owner-only, cosmetic-only. Any other actor kind or severity is refused
// without a state change.
export function waivePunchItem(
  item: PunchItem,
  actor: unknown,
  at: string,
): PunchResult {
  if (!isOwnerActor(actor)) {
    return { ok: false, reason: 'only the owner may waive a punch item' };
  }
  if (item.severity !== 'cosmetic') {
    return { ok: false, reason: 'only cosmetic items may be waived' };
  }
  if (!isIsoTimestamp(at)) return { ok: false, reason: 'timestamp required' };
  if (!isOpenPunchItem(item)) {
    return { ok: false, reason: `cannot waive from ${item.state}` };
  }
  return {
    ok: true,
    item: {
      ...item,
      state: 'waived_by_owner',
      resolved_at: at,
      resolved_by: `owner:${actor.id}`,
    },
  };
}

export interface PunchClosure {
  ok: boolean;
  open_functional_or_safety: string[];
  open_cosmetic: string[];
  invalid_waivers: string[];
  blocked_by: string[];
}

export function punchClosurePredicate(items: PunchItem[]): PunchClosure {
  const openSevere: string[] = [];
  const openCosmetic: string[] = [];
  const invalidWaivers: string[] = [];
  for (const it of items) {
    if (isOpenPunchItem(it)) {
      if (it.severity === 'cosmetic') openCosmetic.push(it.id);
      else openSevere.push(it.id);
    } else if (it.state === 'waived_by_owner' && it.severity !== 'cosmetic') {
      invalidWaivers.push(it.id);
    }
  }
  const blocked = [...openSevere, ...openCosmetic, ...invalidWaivers];
  return {
    ok: blocked.length === 0,
    open_functional_or_safety: openSevere,
    open_cosmetic: openCosmetic,
    invalid_waivers: invalidWaivers,
    blocked_by: blocked,
  };
}
