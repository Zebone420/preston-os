// Architect Gate AG-5: mandatory, fail-closed actor attribution. PURE.

import { RUNTIME_ID_RE } from '../commands';
import {
  canAgentPerform,
} from '../orchestration/agent-contracts';
import type { AgentRole } from '../orchestration/model';

export type ArchitectExecutor = Exclude<AgentRole, 'chatgpt'>;

export interface ActorAttribution {
  requested_by: string;
  proposer: string;
  approver: string | null;
  executor: ArchitectExecutor;
  correlation_id: string;
  run_id: string | null;
}

export type AttributionError =
  | 'requested_by_invalid'
  | 'proposer_invalid'
  | 'approver_missing'
  | 'approver_invalid'
  | 'executor_invalid'
  | 'correlation_id_invalid'
  | 'run_id_missing'
  | 'run_id_invalid'
  | 'self_approval_denied'
  | 'executor_capability_denied';

export type AttributionResult =
  | { ok: true; attribution: ActorAttribution }
  | { ok: false; errors: AttributionError[] };

const EXECUTORS: ReadonlySet<string> = new Set(['claude', 'codex', 'hermes', 'audit']);
// Preston Control authenticates the owner by email. Keep that exact principal
// rather than inventing an opaque alias; other Architect identities continue
// to use the shared runtime ID format. This is intentionally conservative and
// bounded to the two owner-bearing fields.
const OWNER_EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const own = (o: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && RUNTIME_ID_RE.test(value);
const validOwnerIdentity = (value: unknown): value is string =>
  validId(value) || (typeof value === 'string' && value.length <= 254 && OWNER_EMAIL_RE.test(value));

export function requireAttribution(raw: unknown): AttributionResult {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const errors: AttributionError[] = [];
  if (!validOwnerIdentity(value.requested_by)) errors.push('requested_by_invalid');
  if (!validId(value.proposer)) errors.push('proposer_invalid');
  if (!own(value, 'approver')) errors.push('approver_missing');
  else if (value.approver !== null && !validOwnerIdentity(value.approver)) {
    errors.push('approver_invalid');
  }
  if (typeof value.executor !== 'string' || !EXECUTORS.has(value.executor)) {
    errors.push('executor_invalid');
  }
  if (!validId(value.correlation_id)) errors.push('correlation_id_invalid');
  if (!own(value, 'run_id')) errors.push('run_id_missing');
  else if (value.run_id !== null && !validId(value.run_id)) errors.push('run_id_invalid');
  if (validId(value.proposer) && value.approver === value.proposer) {
    errors.push('self_approval_denied');
  }
  if (typeof value.executor === 'string' && EXECUTORS.has(value.executor) &&
      !canAgentPerform(value.executor as ArchitectExecutor, 'propose_github_change')) {
    errors.push('executor_capability_denied');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, attribution: value as unknown as ActorAttribution };
}
