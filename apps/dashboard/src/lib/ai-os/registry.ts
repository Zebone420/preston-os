import type { AgentRecord, AgentStatus } from './types';

// Preston AI OS - agent registry liveness (Phase 2 foundation). PURE.
// Heartbeat freshness governs effective status: an agent not seen within the
// staleness window is treated as offline regardless of its recorded status
// (fail-safe liveness), so a crashed agent never appears working.

const VALID: readonly AgentStatus[] = [
  'offline',
  'idle',
  'working',
  'blocked',
  'error',
];

export function isValidStatus(s: string): s is AgentStatus {
  return (VALID as readonly string[]).includes(s);
}

export function effectiveStatus(
  agent: AgentRecord,
  now: string,
  staleMs = 120_000,
): AgentStatus {
  if (!agent.last_seen) return 'offline';
  if (Date.parse(now) - Date.parse(agent.last_seen) > staleMs) return 'offline';
  return isValidStatus(agent.status) ? agent.status : 'error';
}

// Produce an updated record for a heartbeat. Unknown status collapses to
// 'error' (fail-closed) rather than being trusted.
export function withHeartbeat(
  agent: AgentRecord,
  now: string,
  status: AgentStatus,
): AgentRecord {
  return {
    ...agent,
    last_seen: now,
    status: isValidStatus(status) ? status : 'error',
  };
}
