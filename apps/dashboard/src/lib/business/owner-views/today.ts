// Phase 2 - Hermes TODAY view. PURE.
//
// Answers "what needs my attention right now" from facts already in the
// SSOT: open attention_items (Lane D detectors), owner approvals whose
// decision is still open, running / failed / dead-lettered AI jobs,
// vendor delays, and failed external sends (side_effects ledger).
// Six fixed sections, deterministic ordering (due first, then severity),
// every item deep-links to a PATH on the secure action surface.

import {
  DEEP_LINKS,
  attentionEvidenceRefs,
  bounded,
  bool,
  parseMs,
  sortItems,
  str,
  strOrNull,
  stringList,
  type OwnerItem,
  type Row,
  type Severity,
} from './types';

export const TODAY_SECTIONS = [
  'waiting_on_preston',
  'overdue_commitments',
  'owner_approvals',
  'vendor_delays',
  'failed_sends',
  'business_exceptions',
] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

export interface TodayInput {
  now: string;
  attentionItems: Row[];
  // Orchestration read-model approval rows (annotated with decision_open).
  approvals: Row[];
  runningJobs: Row[];
  failedJobs: Row[];
  deadLetters: Row[];
  // vendor_orders rows already filtered to delayed states.
  vendorDelays: Row[];
  // side_effects rows in status 'failed'.
  failedSends: Row[];
  // project uuid -> human project code (P26-0041); absent entries render
  // as null rather than the uuid so a code is never invented.
  projectCodes?: Record<string, string>;
}

export interface TodayView {
  generated_at: string;
  sections: Record<TodaySection, OwnerItem[]>;
  counts: Record<TodaySection, number>;
  total: number;
}

// Detectors whose WAITING_ON item is a vendor delay rather than a client
// or internal wait (Lane D detector names, migration 0031).
const VENDOR_DETECTORS: ReadonlySet<string> = new Set([
  'vendor_quote_no_return',
  'delivery_status_overdue',
]);

// Job statuses that mean Preston is actively working (transitions.ts).
export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set([
  'pending', 'ready', 'assigned', 'in_progress',
]);

function codeFor(
  projectId: string | null,
  codes: Record<string, string> | undefined,
): string | null {
  if (!projectId || !codes) return null;
  const code = codes[projectId];
  return code ? code : null;
}

function attentionItem(
  r: Row,
  nowMs: number,
  codes: Record<string, string> | undefined,
): { section: TodaySection; item: OwnerItem } | null {
  if (str(r, 'status') !== 'open') return null;
  const type = str(r, 'item_type');
  const detector = str(r, 'detector');
  const projectId = strOrNull(r, 'project_id');
  const code = codeFor(projectId, codes);
  const due = strOrNull(r, 'due_at');
  const dueMs = parseMs(due);
  const overdue = dueMs !== null && dueMs < nowMs;
  const id = 'attention:' + str(r, 'id');
  const base = {
    id,
    project_code: code,
    title: bounded(str(r, 'subject') || detector, 200),
    due_at: due,
    observed_at: strOrNull(r, 'first_seen_at'),
    evidence_refs: attentionEvidenceRefs(r['evidence']),
    deep_link: DEEP_LINKS.attention(str(r, 'id'), code ?? projectId),
  };
  if (type === 'OUR_COMMITMENT') {
    if (overdue) {
      return {
        section: 'overdue_commitments',
        item: { ...base, kind: 'overdue_commitment', severity: 'high' },
      };
    }
    return {
      section: 'waiting_on_preston',
      item: { ...base, kind: 'our_commitment', severity: 'normal' },
    };
  }
  if (type === 'WAITING_ON' && VENDOR_DETECTORS.has(detector)) {
    return {
      section: 'vendor_delays',
      item: {
        ...base,
        kind: 'vendor_delay',
        severity: overdue ? 'high' : 'normal',
      },
    };
  }
  if (type === 'WAITING_ON') {
    return {
      section: 'business_exceptions',
      item: {
        ...base,
        kind: 'waiting_on',
        severity: overdue ? 'high' : 'normal',
      },
    };
  }
  if (type === 'RISK') {
    return {
      section: 'business_exceptions',
      item: { ...base, kind: 'risk', severity: 'high' },
    };
  }
  // OPPORTUNITY items are not exceptions and never interrupt the owner.
  return null;
}

function approvalItem(r: Row): OwnerItem | null {
  // Expired-but-pending rows stay 'pending' in the table; only a row whose
  // decision is still OPEN belongs on Today (status-truth repair, 0010).
  if (r['decision_open'] !== true) return null;
  const risk = str(r, 'risk_class');
  const severity: Severity = risk === 'RED' ? 'critical' : 'high';
  const approvalId = str(r, 'approval_id');
  const refs: string[] = [];
  if (str(r, 'goal_id')) refs.push('goal:' + str(r, 'goal_id'));
  if (str(r, 'job_id')) refs.push('job:' + str(r, 'job_id'));
  return {
    id: 'approval:' + approvalId,
    kind: 'owner_approval',
    project_code: null,
    title: bounded((risk || 'approval') + ': ' + str(r, 'action'), 200),
    due_at: strOrNull(r, 'expires_at'),
    severity,
    observed_at: strOrNull(r, 'created_at'),
    evidence_refs: refs,
    deep_link: DEEP_LINKS.approval(approvalId),
  };
}

function jobItem(r: Row, kind: string, severity: Severity): OwnerItem {
  const jobId = str(r, 'id');
  const refs = stringList(r['evidence_refs']);
  if (str(r, 'goal_id')) refs.unshift('goal:' + str(r, 'goal_id'));
  const reason = strOrNull(r, 'failure_reason');
  const label = str(r, 'title') || str(r, 'kind') || 'job';
  return {
    id: 'job:' + jobId,
    kind,
    project_code: null,
    title: bounded(reason ? label + ' - ' + reason : label, 200),
    due_at: null,
    severity,
    observed_at: strOrNull(r, 'updated_at') ?? strOrNull(r, 'created_at'),
    evidence_refs: refs,
    deep_link: DEEP_LINKS.job(jobId),
  };
}

function vendorItem(
  r: Row,
  codes: Record<string, string> | undefined,
): OwnerItem {
  const orderId = str(r, 'id');
  const projectId = strOrNull(r, 'project_id');
  const code = codeFor(projectId, codes);
  const status = str(r, 'delivery_status');
  const backordered = bool(r, 'backordered') || status === 'backordered';
  const label = (str(r, 'vendor') || 'vendor') + ' order ' +
    (str(r, 'order_number') || orderId.slice(0, 8)) + ': ' +
    (status || 'unknown');
  const note = strOrNull(r, 'exception_note');
  return {
    id: 'vendor_order:' + orderId,
    kind: 'vendor_delay',
    project_code: code,
    title: bounded(note ? label + ' - ' + note : label, 200),
    due_at: strOrNull(r, 'expected_ship_date'),
    severity: backordered || status === 'exception' ? 'high' : 'normal',
    observed_at: strOrNull(r, 'updated_at'),
    evidence_refs: ['vendor_order:' + orderId],
    deep_link: DEEP_LINKS.vendorOrder(orderId, code ?? projectId),
  };
}

function failedSendItem(r: Row): OwnerItem {
  const id = str(r, 'side_effect_id') || str(r, 'id');
  const refs = stringList(r['evidence_refs']);
  refs.unshift('side_effect:' + id);
  if (str(r, 'job_id')) refs.push('job:' + str(r, 'job_id'));
  const reason = strOrNull(r, 'error_message');
  const label = (str(r, 'capability') || 'send') + ' -> ' +
    (str(r, 'target') || 'unknown target');
  return {
    id: 'side_effect:' + id,
    kind: 'failed_send',
    project_code: null,
    title: bounded(
      reason ? label + ' failed: ' + reason : label + ' failed', 200),
    due_at: null,
    severity: 'high',
    observed_at: strOrNull(r, 'updated_at') ?? strOrNull(r, 'created_at'),
    evidence_refs: refs,
    deep_link: DEEP_LINKS.sideEffect(id),
  };
}

export function buildToday(input: TodayInput): TodayView {
  const nowMs = Date.parse(input.now);
  const codes = input.projectCodes;
  const sections: Record<TodaySection, OwnerItem[]> = {
    waiting_on_preston: [],
    overdue_commitments: [],
    owner_approvals: [],
    vendor_delays: [],
    failed_sends: [],
    business_exceptions: [],
  };
  const seen = new Set<string>();
  const push = (section: TodaySection, item: OwnerItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    sections[section].push(item);
  };

  for (const r of input.attentionItems) {
    const placed = attentionItem(r, nowMs, codes);
    if (placed) push(placed.section, placed.item);
  }
  for (const r of input.approvals) {
    const item = approvalItem(r);
    if (item) push('owner_approvals', item);
  }
  for (const r of input.runningJobs) {
    if (!ACTIVE_JOB_STATUSES.has(str(r, 'status'))) continue;
    push('waiting_on_preston', jobItem(r, 'ai_job_running', 'normal'));
  }
  for (const r of input.failedJobs) {
    push('business_exceptions', jobItem(r, 'ai_job_failed', 'high'));
  }
  for (const r of input.deadLetters) {
    push('business_exceptions',
      jobItem(r, 'ai_job_dead_lettered', 'critical'));
  }
  for (const r of input.vendorDelays) {
    push('vendor_delays', vendorItem(r, codes));
  }
  for (const r of input.failedSends) {
    if (str(r, 'status') !== 'failed') continue;
    push('failed_sends', failedSendItem(r));
  }

  const counts = {} as Record<TodaySection, number>;
  let total = 0;
  for (const s of TODAY_SECTIONS) {
    sections[s] = sortItems(sections[s]);
    counts[s] = sections[s].length;
    total += counts[s];
  }
  return { generated_at: input.now, sections, counts, total };
}

export function allTodayItems(view: TodayView): OwnerItem[] {
  const out: OwnerItem[] = [];
  for (const s of TODAY_SECTIONS) out.push(...view.sections[s]);
  return sortItems(out);
}
