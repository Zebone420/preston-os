// Preston AI OS - Phase 8 remote-intake consumption. FAIL-CLOSED. Pure store
// operations + the deterministic composer; no spawning, no network, no send.
//
// The 0011 gateway lets an authenticated remote caller (the ChatGPT bridge)
// INSERT bounded request rows. This module is the other half: the staging
// host runtime - running under the owner identity, RLS-bound - consumes
// pending rows through the SAME composer pipeline the owner dashboard uses
// (deterministic parsing, policy classification, approval gating, idempotent
// persistence). A remote request can therefore never reach the goal graph by
// any weaker path than the owner's own.
//
// Safety properties:
//  - Owner binding: a request whose owner_identity differs from the
//    configured expected identity is REJECTED, never composed.
//  - Idempotency: request_id doubles as the composer request key, so a
//    re-consumed row (crash between persist and mark) replays the identical
//    deterministic goal graph instead of minting a second one.
//  - Concurrency: consumption marks rows with a status CAS
//    (pending -> consumed/rejected); a lost CAS means another worker owns
//    the row - we never double-report.
//  - Bounded: at most maxRequests rows per invocation, oldest first.
//  - Never blocks the tick: every failure is contained to the row.

import { RUNTIME_ID_RE } from '../commands';
import { composeRequest } from './composer';
import {
  confirmComposedRequest,
  type ComposerClient,
} from './composer-persist';

export const REMOTE_INTAKE_TABLE = 'remote_intake_requests';
export const REMOTE_INTAKE_OWNER_ENV = 'REMOTE_INTAKE_OWNER_IDENTITY';
export const REMOTE_INTAKE_MAX_PER_TICK = 3;

export interface RemoteIntakeRow {
  request_id: string;
  source: string;
  owner_identity: string;
  raw_request: string;
  status: string;
}

export interface IntakeConsumeResult {
  configured: boolean;
  available: boolean; // false when 0011 is not applied / table unreadable
  consumed: Array<{ request_id: string; goal_ids: string[] }>;
  rejected: Array<{ request_id: string; reason: string }>;
  errors: string[];
}

function bounded(s: string, n: number): string {
  return String(s ?? '').slice(0, n);
}

// The gateway CHECK pins request_id to a runtime-id-compatible shape; this
// re-validates locally so a drifted schema cannot feed the composer an
// unexpected key (fail-closed, defense in depth).
function usableRequestKey(id: string): boolean {
  return RUNTIME_ID_RE.test(id);
}

export async function consumeRemoteIntakeOnce(
  client: ComposerClient,
  env: Record<string, string | undefined>,
  nowIso: string,
  maxRequests: number = REMOTE_INTAKE_MAX_PER_TICK,
): Promise<IntakeConsumeResult> {
  const out: IntakeConsumeResult = {
    configured: false, available: false, consumed: [], rejected: [], errors: [],
  };
  const expectedOwner = String(env[REMOTE_INTAKE_OWNER_ENV] ?? '')
    .trim().toLowerCase();
  if (!expectedOwner) return out; // not configured on this host - inert
  out.configured = true;

  let rows: Record<string, unknown>[] = [];
  try {
    const res = await client
      .from(REMOTE_INTAKE_TABLE)
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(Math.max(1, Math.min(maxRequests, 10)));
    if (res.error) {
      out.errors.push('intake_unreadable');
      return out; // 0011 absent or RLS/read failure - skip silently-safe
    }
    rows = res.data ?? [];
  } catch {
    out.errors.push('intake_unreadable');
    return out;
  }
  out.available = true;

  for (const raw of rows) {
    const requestId = String(raw.request_id ?? '');
    const rowOwner = String(raw.owner_identity ?? '').trim().toLowerCase();
    const rawRequest = String(raw.raw_request ?? '');

    const mark = async (
      status: 'consumed' | 'rejected',
      patch: Record<string, unknown>,
    ): Promise<boolean> => {
      try {
        const res = await client
          .from(REMOTE_INTAKE_TABLE)
          .update({ status, ...patch })
          .eq('request_id', requestId)
          .eq('status', 'pending')
          .select('request_id');
        return !res.error && (res.data ?? []).length > 0;
      } catch {
        return false;
      }
    };

    // Owner binding precedes EVERYTHING else about the row.
    if (rowOwner !== expectedOwner) {
      const ok = await mark('rejected', {
        reject_reason: 'owner_identity_mismatch', consumed_at: nowIso,
      });
      if (ok) out.rejected.push({ request_id: requestId, reason: 'owner_identity_mismatch' });
      continue;
    }
    if (!usableRequestKey(requestId)) {
      const ok = await mark('rejected', {
        reject_reason: 'request_id_shape', consumed_at: nowIso,
      });
      if (ok) out.rejected.push({ request_id: requestId, reason: 'request_id_shape' });
      continue;
    }

    // Deterministic interpretation; a request the composer cannot interpret
    // is rejected with bounded reasons (the remote caller reads them via
    // the status gateway).
    const composed = composeRequest(rawRequest);
    if (!composed.ok) {
      const reason = bounded('compose:' + composed.errors.join(','), 300);
      const ok = await mark('rejected', {
        reject_reason: reason, consumed_at: nowIso,
      });
      if (ok) out.rejected.push({ request_id: requestId, reason });
      continue;
    }

    // Full owner-equivalent confirmation: recompose server-side, verify the
    // hash, persist idempotently (request_id = request key -> deterministic
    // goal/job ids), compensate on partial failure.
    const confirmed = await confirmComposedRequest(client, {
      ownerEmail: expectedOwner,
      rawRequest,
      requestKey: requestId,
      presentedHash: composed.proposal_hash,
      now: nowIso,
    });

    if (!confirmed.ok) {
      const reason = bounded('confirm:' + confirmed.errors.join(','), 300);
      const ok = await mark('rejected', {
        reject_reason: reason, consumed_at: nowIso,
      });
      if (ok) out.rejected.push({ request_id: requestId, reason });
      continue;
    }

    const goalIds = confirmed.created.map((c) => c.goal_id);
    const ok = await mark('consumed', {
      goal_ids: goalIds, consumed_at: nowIso,
    });
    if (ok) out.consumed.push({ request_id: requestId, goal_ids: goalIds });
    // A lost CAS here means a concurrent tick already recorded the SAME
    // deterministic outcome (idempotent replay) - nothing to repair.
  }
  return out;
}
