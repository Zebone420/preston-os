// Phase 2 - event-aware OWNER BRIEF + phone notification rules. PURE.
//
// The brief is a SHORT deterministic text (no LLM, no free text from
// external content beyond bounded subjects already in the SSOT) with
// counts and the top five items. notificationRules decides which items
// warrant a phone notification: an owner approval opening, a critical
// incident, an overdue commitment, or a failed send - AT MOST ONCE per
// item (the caller passes what it already notified), bounded per run,
// everything else folded into a digest line.

import type { Incident, IncidentsView } from './incidents';
import { allTodayItems, type TodayView } from './today';
import { parseMs, sortItems, type OwnerItem } from './types';
import type { AiWorkforceView } from './workforce';

export const BRIEF_TOP_ITEMS = 5;
export const MAX_PHONE_NOTIFICATIONS_PER_RUN = 3;

export interface OwnerBrief {
  generated_at: string;
  since: string | null;
  headline: string;
  lines: string[];
  text: string;
  counts: {
    today_total: number;
    waiting_on_preston: number;
    overdue_commitments: number;
    owner_approvals: number;
    vendor_delays: number;
    failed_sends: number;
    business_exceptions: number;
    ai_active: number;
    ai_failed: number;
    incidents: number;
    incidents_critical: number;
    new_since: number;
  };
  top_items: OwnerItem[];
  unreadable: string[];
}

export function incidentAsItem(i: Incident): OwnerItem {
  return {
    id: 'incident:' + i.id,
    kind: 'incident_' + i.kind,
    project_code: null,
    title: i.title,
    due_at: null,
    severity: i.severity,
    observed_at: i.occurred_at,
    evidence_refs: i.evidence_refs,
    deep_link: i.deep_link,
  };
}

function isNewSince(item: OwnerItem, sinceMs: number | null): boolean {
  if (sinceMs === null) return false;
  const at = parseMs(item.observed_at);
  return at !== null && at >= sinceMs;
}

function itemLine(item: OwnerItem, index: number): string {
  const due = item.due_at ? ' due ' + item.due_at : '';
  const code = item.project_code ? ' [' + item.project_code + ']' : '';
  return `${index + 1}. ${item.severity.toUpperCase()} ${item.kind}${code}: ` +
    `${item.title}${due} -> ${item.deep_link}`;
}

export function buildOwnerBrief(
  today: TodayView,
  workforce: AiWorkforceView,
  incidents: IncidentsView,
  since: string | null,
  unreadable: string[] = [],
): OwnerBrief {
  const sinceMs = parseMs(since);
  const items = sortItems([
    ...allTodayItems(today),
    ...incidents.incidents
      .filter((i) => i.severity === 'critical')
      .map(incidentAsItem),
  ]);
  const top = items.slice(0, BRIEF_TOP_ITEMS);
  const newSince = items.filter((i) => isNewSince(i, sinceMs)).length;
  const c = today.counts;
  const counts: OwnerBrief['counts'] = {
    today_total: today.total,
    waiting_on_preston: c.waiting_on_preston,
    overdue_commitments: c.overdue_commitments,
    owner_approvals: c.owner_approvals,
    vendor_delays: c.vendor_delays,
    failed_sends: c.failed_sends,
    business_exceptions: c.business_exceptions,
    ai_active: workforce.counts.active,
    ai_failed: workforce.counts.failed,
    incidents: incidents.counts.total,
    incidents_critical: incidents.counts.critical,
    new_since: newSince,
  };
  const headline =
    `${counts.owner_approvals} approval(s) open, ` +
    `${counts.overdue_commitments} overdue, ` +
    `${counts.incidents_critical} critical incident(s), ` +
    `${counts.ai_active} AI job(s) running`;
  const lines: string[] = [
    'Preston owner brief ' + today.generated_at,
    headline,
    'waiting on Preston: ' + counts.waiting_on_preston +
      ' | vendor delays: ' + counts.vendor_delays +
      ' | failed sends: ' + counts.failed_sends +
      ' | exceptions: ' + counts.business_exceptions,
    'AI workforce: ' + counts.ai_active + ' active, ' +
      workforce.counts.awaiting_approval + ' awaiting approval, ' +
      counts.ai_failed + ' failed (' + workforce.counts.dead_lettered +
      ' dead-lettered)',
    'incidents: ' + counts.incidents + ' (' + counts.incidents_critical +
      ' critical)',
  ];
  if (since) lines.push('new since ' + since + ': ' + newSince);
  if (unreadable.length > 0) {
    lines.push('UNREADABLE buckets (fail-closed, counts are lower bounds): ' +
      [...unreadable].sort().join(', '));
  }
  lines.push(top.length === 0 ? 'top items: none' : 'top items:');
  top.forEach((item, i) => lines.push(itemLine(item, i)));
  return {
    generated_at: today.generated_at,
    since,
    headline,
    lines,
    text: lines.join('\n'),
    counts,
    top_items: top,
    unreadable: [...unreadable].sort(),
  };
}

// --- phone notification rules ----------------------------------------------

export const NOTIFY_KINDS: ReadonlySet<string> = new Set([
  'owner_approval',
  'overdue_commitment',
  'failed_send',
]);

export interface NotificationDecision {
  item_id: string;
  kind: string;
  reason:
    | 'owner_approval_opened'
    | 'critical_incident'
    | 'overdue_commitment'
    | 'failed_send';
  text: string;
}

export interface NotificationPlan {
  // Send one phone notification each (bounded per run).
  notify: NotificationDecision[];
  // Qualifying items beyond the per-run bound: one digest line instead.
  digest: NotificationDecision[];
  digest_text: string | null;
  // Already notified once: never again for the same item.
  suppressed: string[];
  // Items that never warrant a phone notification.
  ignored: number;
}

function reasonFor(item: OwnerItem): NotificationDecision['reason'] | null {
  if (item.kind === 'owner_approval') return 'owner_approval_opened';
  if (item.kind === 'overdue_commitment') return 'overdue_commitment';
  if (item.kind === 'failed_send') return 'failed_send';
  if (item.kind.startsWith('incident_') && item.severity === 'critical') {
    return 'critical_incident';
  }
  return null;
}

function bounded(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

export function notificationRules(
  now: string,
  items: OwnerItem[],
  lastNotifiedAt: Record<string, string>,
  maxPerRun: number = MAX_PHONE_NOTIFICATIONS_PER_RUN,
): NotificationPlan {
  const nowMs = Date.parse(now);
  const bound = Math.max(0, Math.floor(maxPerRun));
  const notify: NotificationDecision[] = [];
  const digest: NotificationDecision[] = [];
  const suppressed: string[] = [];
  let ignored = 0;
  const seen = new Set<string>();
  for (const item of sortItems(items)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const reason = reasonFor(item);
    if (!reason) { ignored += 1; continue; }
    // An item due in the future is not overdue yet: it does not qualify
    // until its due time passes (approvals qualify on opening).
    if (reason === 'overdue_commitment') {
      const due = parseMs(item.due_at);
      if (due !== null && Number.isFinite(nowMs) && due > nowMs) {
        ignored += 1;
        continue;
      }
    }
    // Rate limit: max ONE phone notification per item, ever.
    if (Object.prototype.hasOwnProperty.call(lastNotifiedAt, item.id)) {
      suppressed.push(item.id);
      continue;
    }
    const decision: NotificationDecision = {
      item_id: item.id,
      kind: item.kind,
      reason,
      text: bounded('Preston: ' + reason.replace(/_/g, ' ') + ' - ' +
        item.title + ' -> ' + item.deep_link, 240),
    };
    if (notify.length < bound) notify.push(decision);
    else digest.push(decision);
  }
  const digestText = digest.length === 0
    ? null
    : 'Preston digest: ' + digest.length + ' more item(s) need attention - ' +
      digest.map((d) => d.kind).join(', ') + '. See /brief';
  return {
    notify,
    digest,
    digest_text: digestText ? bounded(digestText, 240) : null,
    suppressed: suppressed.sort(),
    ignored,
  };
}
