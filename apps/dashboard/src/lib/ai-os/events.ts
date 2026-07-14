import type { EventType, OsEvent } from './types';

// Preston AI OS - event bus factory (Phase 2 foundation). PURE. Typed
// constructor for domain events. Events are append-only facts (persisted to
// os_events, migration 0003); publishing/subscription transport is a later
// gate. This module only shapes and validates the event record.

export interface MakeEventInput {
  id: string;
  type: EventType;
  actor: string;
  correlation_id: string;
  now: string; // ISO timestamp (injected)
  payload?: Record<string, unknown>;
}

export function makeEvent(input: MakeEventInput): OsEvent {
  return {
    id: input.id,
    type: input.type,
    actor: input.actor,
    correlation_id: input.correlation_id,
    payload: input.payload ?? {},
    created_at: input.now,
  };
}
