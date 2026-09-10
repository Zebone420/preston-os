// Phase 6 - receiving / delivery state machine (pure, deterministic).
//
// Mirrors public.receiving_events (migration 0035): the table is the
// append-only event log; this module folds events into a ReceivingState.
// Damage/remake is an EXCEPTION BRANCH: damage_reported opens an
// exception, remake_requested advances it, remake_received resolves it.
// A generic 'exception' event is resolved only by a later passed
// inspection ('inspected'). Any open exception blocks install readiness
// (see install-readiness.ts). Replaying an event id is a no-op.

import {
  isIsoTimestamp,
  isReceivingEventKind,
  type ReceivingEventKind,
} from './types';

export type ReceivingPhase =
  | 'not_shipped'
  | 'shipped'
  | 'backordered'
  | 'delivered'
  | 'received'
  | 'inspected';

export interface ReceivingLineItem {
  line_ref: string;
  quantity: number;
  description?: string;
}

export interface ReceivingEvent {
  id: string;
  project_id: string;
  vendor_order_id?: string | null;
  po_package_id?: string | null;
  event: ReceivingEventKind;
  occurred_at: string;
  recorded_by: string;
  line_items?: ReceivingLineItem[];
  photos_document_ids?: string[];
  notes?: string | null;
}

export type ExceptionKind = 'damage' | 'exception';
export type ExceptionStage = 'reported' | 'remake_requested';

export interface OpenException {
  kind: ExceptionKind;
  opened_by_event_id: string;
  opened_at: string;
  stage: ExceptionStage;
}

export interface ResolvedException extends OpenException {
  resolved_by_event_id: string;
  resolved_at: string;
}

export interface ReceivingState {
  project_id: string;
  phase: ReceivingPhase;
  open_exceptions: OpenException[];
  resolved_exceptions: ResolvedException[];
  applied_event_ids: string[];
  last_event_at: string | null;
}

export type ApplyReceivingResult =
  | { ok: true; state: ReceivingState; ignored: boolean }
  | { ok: false; state: ReceivingState; reason: string };

export function initialReceivingState(projectId: string): ReceivingState {
  return {
    project_id: projectId,
    phase: 'not_shipped',
    open_exceptions: [],
    resolved_exceptions: [],
    applied_event_ids: [],
    last_event_at: null,
  };
}

const PHASE_TRANSITIONS: Record<
  Exclude<
    ReceivingEventKind,
    'damage_reported' | 'remake_requested' | 'remake_received' | 'exception'
  >,
  { from: ReceivingPhase[]; to: ReceivingPhase }
> = {
  shipped: { from: ['not_shipped', 'backordered'], to: 'shipped' },
  backordered: { from: ['not_shipped', 'shipped'], to: 'backordered' },
  delivered: { from: ['shipped', 'backordered'], to: 'delivered' },
  received: { from: ['delivered'], to: 'received' },
  inspected: { from: ['received', 'inspected'], to: 'inspected' },
};

function validateEvent(ev: ReceivingEvent, state: ReceivingState): string | null {
  if (typeof ev.id !== 'string' || ev.id.length === 0) return 'event id required';
  if (ev.project_id !== state.project_id) return 'project mismatch';
  if (!isReceivingEventKind(ev.event)) return 'unknown event kind';
  if (!isIsoTimestamp(ev.occurred_at)) return 'occurred_at must be ISO';
  if (typeof ev.recorded_by !== 'string' || ev.recorded_by.length === 0) {
    return 'recorded_by required';
  }
  return null;
}

function fail(state: ReceivingState, reason: string): ApplyReceivingResult {
  return { ok: false, state, reason };
}

export function hasOpenExceptions(state: ReceivingState): boolean {
  return state.open_exceptions.length > 0;
}

// True only when everything is physically in hand and no exception is
// open. Inspection is not required for this fact (it is for damage
// discovery), but an open exception of any kind defeats it.
export function allUnitsReceived(state: ReceivingState): boolean {
  return (
    (state.phase === 'received' || state.phase === 'inspected') &&
    !hasOpenExceptions(state)
  );
}

export function applyReceivingEvent(
  state: ReceivingState,
  ev: ReceivingEvent,
): ApplyReceivingResult {
  const invalid = validateEvent(ev, state);
  if (invalid) return fail(state, invalid);
  if (state.applied_event_ids.includes(ev.id)) {
    return { ok: true, state, ignored: true };
  }

  const base = {
    ...state,
    applied_event_ids: [...state.applied_event_ids, ev.id],
    last_event_at: ev.occurred_at,
  };

  switch (ev.event) {
    case 'damage_reported': {
      if (!['delivered', 'received', 'inspected'].includes(state.phase)) {
        return fail(state, 'damage can only be reported after delivery');
      }
      const opened: OpenException = {
        kind: 'damage',
        opened_by_event_id: ev.id,
        opened_at: ev.occurred_at,
        stage: 'reported',
      };
      return {
        ok: true,
        ignored: false,
        state: { ...base, open_exceptions: [...state.open_exceptions, opened] },
      };
    }
    case 'exception': {
      const opened: OpenException = {
        kind: 'exception',
        opened_by_event_id: ev.id,
        opened_at: ev.occurred_at,
        stage: 'reported',
      };
      return {
        ok: true,
        ignored: false,
        state: { ...base, open_exceptions: [...state.open_exceptions, opened] },
      };
    }
    case 'remake_requested': {
      const idx = state.open_exceptions.findIndex(
        (x) => x.kind === 'damage' && x.stage === 'reported',
      );
      if (idx < 0) return fail(state, 'no reported damage to remake');
      const next = state.open_exceptions.map((x, i) =>
        i === idx ? { ...x, stage: 'remake_requested' as const } : x,
      );
      return { ok: true, ignored: false, state: { ...base, open_exceptions: next } };
    }
    case 'remake_received': {
      const idx = state.open_exceptions.findIndex(
        (x) => x.kind === 'damage' && x.stage === 'remake_requested',
      );
      if (idx < 0) return fail(state, 'no remake outstanding');
      const resolved: ResolvedException = {
        ...state.open_exceptions[idx],
        resolved_by_event_id: ev.id,
        resolved_at: ev.occurred_at,
      };
      return {
        ok: true,
        ignored: false,
        state: {
          ...base,
          open_exceptions: state.open_exceptions.filter((_, i) => i !== idx),
          resolved_exceptions: [...state.resolved_exceptions, resolved],
        },
      };
    }
    default: {
      const rule = PHASE_TRANSITIONS[ev.event];
      if (!rule.from.includes(state.phase)) {
        return fail(state, `${ev.event} not allowed from ${state.phase}`);
      }
      // A passed inspection closes generic exceptions; damage exceptions
      // are closed only by the remake branch.
      let open = state.open_exceptions;
      let resolvedNow: ResolvedException[] = [];
      if (ev.event === 'inspected') {
        resolvedNow = open
          .filter((x) => x.kind === 'exception')
          .map((x) => ({
            ...x,
            resolved_by_event_id: ev.id,
            resolved_at: ev.occurred_at,
          }));
        open = open.filter((x) => x.kind !== 'exception');
      }
      return {
        ok: true,
        ignored: false,
        state: {
          ...base,
          phase: rule.to,
          open_exceptions: open,
          resolved_exceptions: [...state.resolved_exceptions, ...resolvedNow],
        },
      };
    }
  }
}

// Fold a full log deterministically (sorted by occurred_at, then id).
// Rejected events are reported, never silently dropped.
export function foldReceivingEvents(
  projectId: string,
  events: ReceivingEvent[],
): { state: ReceivingState; rejected: { id: string; reason: string }[] } {
  const ordered = [...events].sort((a, b) =>
    a.occurred_at === b.occurred_at
      ? a.id.localeCompare(b.id)
      : a.occurred_at.localeCompare(b.occurred_at),
  );
  let state = initialReceivingState(projectId);
  const rejected: { id: string; reason: string }[] = [];
  for (const ev of ordered) {
    const r = applyReceivingEvent(state, ev);
    if (r.ok) state = r.state;
    else rejected.push({ id: ev.id, reason: r.reason });
  }
  return { state, rejected };
}
