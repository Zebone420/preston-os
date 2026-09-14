// Phase 6 (Installation -> Closeout) - shared vocabulary.
//
// Every list here is the contract pinned by migration 0035 CHECK
// constraints. Keep the two in sync; the migration lint test reads the
// SQL text, the module tests read these arrays. Everything in this
// directory is a STATE MODEL, a PREDICATE, or a document-registration
// DESCRIPTOR. Nothing here reaches a network, a vendor, a client, or a
// money rail. Other registries (documents, order-chain, identity) are
// referenced by uuid / document_type strings only - never imported.

export const RECEIVING_EVENT_KINDS = [
  'shipped',
  'delivered',
  'received',
  'inspected',
  'damage_reported',
  'remake_requested',
  'remake_received',
  'backordered',
  'exception',
] as const;
export type ReceivingEventKind = (typeof RECEIVING_EVENT_KINDS)[number];

export const CREW_ASSIGNMENT_STATES = [
  'proposed',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type CrewAssignmentState = (typeof CREW_ASSIGNMENT_STATES)[number];

export const INSTALL_STATES = [
  'not_ready',
  'ready',
  'scheduled',
  'in_progress',
  'installed',
  'punch_open',
  'punch_closed',
  'closed_out',
  'warranty_registered',
  'archived',
] as const;
export type InstallState = (typeof INSTALL_STATES)[number];

export const PUNCH_SEVERITIES = ['cosmetic', 'functional', 'safety'] as const;
export type PunchSeverity = (typeof PUNCH_SEVERITIES)[number];

export const PUNCH_STATES = [
  'open',
  'in_progress',
  'resolved',
  'waived_by_owner',
] as const;
export type PunchState = (typeof PUNCH_STATES)[number];

export const CLOSEOUT_STATES = [
  'open',
  'pending_final_payment',
  'complete',
  'archived',
] as const;
export type CloseoutState = (typeof CLOSEOUT_STATES)[number];

// Actor model for this chain. Only the structured kind counts: an owner
// waiver requires kind === 'owner', whatever a free-text field claims.
export type LifecycleActorKind =
  | 'owner'
  | 'crew'
  | 'runtime'
  | 'agent'
  | 'system';

export interface LifecycleActor {
  kind: LifecycleActorKind;
  id: string;
}

export function isOwnerActor(actor: unknown): actor is LifecycleActor {
  if (actor === null || typeof actor !== 'object') return false;
  const a = actor as Partial<LifecycleActor>;
  return (
    a.kind === 'owner' && typeof a.id === 'string' && a.id.trim().length > 0
  );
}

export function isLifecycleActor(actor: unknown): actor is LifecycleActor {
  if (actor === null || typeof actor !== 'object') return false;
  const a = actor as Partial<LifecycleActor>;
  return (
    (a.kind === 'owner' ||
      a.kind === 'crew' ||
      a.kind === 'runtime' ||
      a.kind === 'agent' ||
      a.kind === 'system') &&
    typeof a.id === 'string' &&
    a.id.trim().length > 0
  );
}

export function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    Number.isFinite(Date.parse(value))
  );
}

// Calendar date in YYYY-MM-DD form (UTC-anchored date math everywhere).
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === value;
}

// Minimal view of a registry row this chain needs. The documents module
// owns the real row shape; we only read type/subtype/currency by value.
export interface DocumentRef {
  id: string;
  document_type: string;
  document_subtype?: string | null;
  is_current: boolean;
}

export function isReceivingEventKind(v: unknown): v is ReceivingEventKind {
  return (RECEIVING_EVENT_KINDS as readonly unknown[]).includes(v);
}
export function isInstallState(v: unknown): v is InstallState {
  return (INSTALL_STATES as readonly unknown[]).includes(v);
}
export function isPunchSeverity(v: unknown): v is PunchSeverity {
  return (PUNCH_SEVERITIES as readonly unknown[]).includes(v);
}
export function isPunchState(v: unknown): v is PunchState {
  return (PUNCH_STATES as readonly unknown[]).includes(v);
}
export function isCloseoutState(v: unknown): v is CloseoutState {
  return (CLOSEOUT_STATES as readonly unknown[]).includes(v);
}
export function isCrewAssignmentState(
  v: unknown,
): v is CrewAssignmentState {
  return (CREW_ASSIGNMENT_STATES as readonly unknown[]).includes(v);
}
