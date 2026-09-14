// Order chain - actor model. Approvals in this chain (measurement
// approval, PO approval for placement, owner waivers, the owner's
// placed-by-owner record) require a HUMAN actor. Agents, the runtime,
// and system timers are never human here, whatever they claim in a
// free-text field: only the structured kind counts.

export type ActorKind = 'human' | 'runtime' | 'agent' | 'system';

export interface Actor {
  kind: ActorKind;
  id: string;
}

export function isHumanActor(actor: unknown): actor is Actor {
  if (actor === null || typeof actor !== 'object') return false;
  const a = actor as Partial<Actor>;
  return (
    a.kind === 'human' &&
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
