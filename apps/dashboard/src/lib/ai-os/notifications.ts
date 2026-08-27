// Preston AI OS - fast-track Phase H: owner attention notifications.
//
// Model: Hermes stays OBSERVE-ONLY. The attention loop is
//   observe -> evaluate -> needs_attention -> notifier -> owner
// and the notifier (lib/telegram notifyOwner) is Stage-1 OUTBOUND-ONLY with
// its own fail-closed guards. This module:
//
//   - is INERT unless the host env carries TELEGRAM_BOT_TOKEN +
//     TELEGRAM_OWNER_CHAT_ID (owner-gated activation; nothing here reads,
//     stores, or logs the values);
//   - notifies ONLY meaningful events: a pending owner approval, a
//     dead-lettered job, a failed goal - each AT MOST ONCE, deduplicated
//     durably through an idempotent os_events row (ev-notify-*): the send
//     happens only when THIS tick's insert won the PK race;
//   - is bounded (MAX_NOTIFY_PER_TICK) so a backlog can never spam;
//   - never carries free text from job/goal rows beyond bounded, redacted
//     identifiers + reason codes (the scrubber in notifyOwner re-screens).
//
// Failure posture: a notification failure NEVER affects orchestration - the
// caller logs the summary and moves on. A send failure after a won dedup
// insert means that event stays un-notified (visible in status surfaces);
// preferred over double-sends.

import type { RuntimeClient } from './store';
import { insertEvent } from './store';
import { makeEnvelope } from './transport';
import { ORCH_TABLES } from './orchestration/store';

// The SEND function is injected by the caller (the dispatcher composes the
// os-runtime Telegram port; the web tier would compose lib/telegram). This
// module stays free of the guards import chain so the compiled runtime can
// carry it, and stays trivially testable.
export type NotifySender = (
  text: string,
) => Promise<{ sent: boolean; reason: string }>;

export const MAX_NOTIFY_PER_TICK = 5;

export interface AttentionEvent {
  kind: 'approval_required' | 'job_dead_lettered' | 'goal_failed'
    | 'artifact_unrecorded';
  entity_id: string; // approval id / job id / goal id
  text: string; // bounded, identifier + reason-code only
}

export interface NotifyTickResult {
  configured: boolean;
  candidates: number;
  sent: number;
  deduped: number;
  errors: string[];
}

type Env = Record<string, string | undefined>;

function bounded(s: unknown, max = 80): string {
  return String(s ?? '').replace(/\s+/g, ' ').slice(0, max);
}

// Derive the current attention set from bounded reads (newest first, small
// windows). Read failures surface as errors and skip that source - never the
// whole tick.
async function collectAttention(
  client: RuntimeClient,
  errors: string[],
): Promise<AttentionEvent[]> {
  const out: AttentionEvent[] = [];
  try {
    // orchestration_approvals keys on approval_id and has NO id column
    // (0010; store.ts insertRow note) - selecting 'id' made PostgREST
    // reject the whole read, so approval notifications could NEVER fire
    // (latent defect found in the power-station baseline audit, 2026-08-27).
    const ap = await client
      .from(ORCH_TABLES.approvals)
      .select('approval_id, action, risk_class, expires_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);
    if (ap.error) errors.push('approvals_unreadable');
    for (const r of (ap.data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        kind: 'approval_required',
        entity_id: String(r.approval_id ?? ''),
        text: `Preston: approval required (${bounded(r.risk_class, 8)}) ` +
          `${bounded(r.approval_id, 40)} - ${bounded(r.action, 120)}. ` +
          `Expires ${bounded(r.expires_at, 30)}. Decide in Preston Control.`,
      });
    }
  } catch { errors.push('approvals_unreadable'); }
  try {
    const dl = await client
      .from(ORCH_TABLES.jobs)
      .select('id, goal_id, kind, failure_reason, updated_at')
      .eq('status', 'dead_lettered')
      .order('updated_at', { ascending: false })
      .limit(10);
    if (dl.error) errors.push('dead_letters_unreadable');
    for (const r of (dl.data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        kind: 'job_dead_lettered',
        entity_id: String(r.id ?? ''),
        text: `Preston: job dead-lettered ${bounded(r.id, 40)} ` +
          `(kind ${bounded(r.kind, 20)}, goal ${bounded(r.goal_id, 40)}): ` +
          `${bounded(r.failure_reason, 120)}`,
      });
    }
  } catch { errors.push('dead_letters_unreadable'); }
  try {
    const fg = await client
      .from(ORCH_TABLES.goals)
      .select('id, title, updated_at')
      .eq('status', 'failed')
      .order('updated_at', { ascending: false })
      .limit(5);
    if (fg.error) errors.push('failed_goals_unreadable');
    for (const r of (fg.data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        kind: 'goal_failed',
        entity_id: String(r.id ?? ''),
        text: `Preston: goal failed ${bounded(r.id, 40)} - ` +
          `${bounded(r.title, 100)}. See Preston Control for evidence.`,
      });
    }
  } catch { errors.push('failed_goals_unreadable'); }
  try {
    // Power-station section 6: an artifact_unrecorded condition (real work
    // done, persistence failed) must reach the owner - never silent loss.
    // Bounded read of recent ArtifactRecorded events; the payload condition
    // filters client-side (os_events has no jsonb index; window is tiny).
    const ar = await client
      .from('os_events')
      .select('id, payload, created_at')
      .eq('type', 'ArtifactRecorded')
      .order('created_at', { ascending: false })
      .limit(10);
    if (ar.error) errors.push('artifact_events_unreadable');
    for (const r of (ar.data ?? []) as Array<Record<string, unknown>>) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      if (String(p.condition) !== 'artifact_unrecorded') continue;
      out.push({
        kind: 'artifact_unrecorded',
        entity_id: String(r.id ?? ''),
        text: `Preston: artifact UNRECORDED for job ${bounded(p.job_id, 40)} ` +
          `(goal ${bounded(p.goal_id, 40)}): work succeeded but ` +
          `persistence failed. See evidence in Preston Control.`,
      });
    }
  } catch { errors.push('artifact_events_unreadable'); }
  return out.filter((e) => e.entity_id);
}

// One bounded notification pass. Call from the hermes tick (observe-only
// identity); safe to call every tick - dedup makes it idempotent.
export async function notifyAttentionOnce(
  client: RuntimeClient,
  env: Env,
  nowIso: string,
  send: NotifySender,
): Promise<NotifyTickResult> {
  const res: NotifyTickResult = {
    configured: false, candidates: 0, sent: 0, deduped: 0, errors: [],
  };
  const token = String(env['TELEGRAM_BOT_TOKEN'] ?? '').trim();
  const chat = String(env['TELEGRAM_OWNER_CHAT_ID'] ?? '').trim();
  if (!token || !chat) return res; // owner has not activated - fully inert
  res.configured = true;

  const events = await collectAttention(client, res.errors);
  res.candidates = events.length;

  for (const e of events) {
    if (res.sent >= MAX_NOTIFY_PER_TICK) break;
    // Durable dedup: the deterministic event id makes the insert PK-
    // idempotent; only the tick that WINS the insert sends.
    const id = `ev-notify-${e.kind}-${e.entity_id}`;
    const envll = makeEnvelope({
      id,
      type: 'OwnerNotificationRecorded',
      actor: 'hermes',
      source: 'attention-notifier',
      correlation_id: `notify:${e.kind}:${e.entity_id}`,
      idempotency_key: id,
      now: nowIso,
      payload: { kind: e.kind, entity_id: e.entity_id },
    });
    let won = false;
    try {
      const ins = await insertEvent(client, envll);
      // insertEvent is idempotent on the id: a unique-violation replay
      // reports { ok: true, duplicate: true }. Only a FRESH insert wins.
      won = ins.ok && (ins as { duplicate?: boolean }).duplicate !== true;
    } catch { res.errors.push('dedup_insert_failed'); continue; }
    if (!won) { res.deduped++; continue; }
    try {
      const sent = await send(e.text);
      if (sent.sent) res.sent++;
      else res.errors.push(`send_failed:${sent.reason}`);
    } catch { res.errors.push('send_failed:exception'); }
  }
  return res;
}
