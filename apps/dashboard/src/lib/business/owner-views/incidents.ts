// Phase 2 - Hermes INCIDENTS / EVIDENCE view. PURE.
//
// One list with evidence for everything that went wrong or is unsafe:
// dead letters, failed / uncertain external side effects, security
// findings (client contact leaks recorded as autonomy anomalies, prompt
// injection rejections at goal intake), and unrecorded-durability
// conditions (artifact_unrecorded / patch_unrecorded on a result event).
// Ordering: severity, then newest first, then the stable id.

import {
  DEEP_LINKS,
  SEVERITY_RANK,
  bounded,
  str,
  strOrNull,
  stringList,
  type Row,
  type Severity,
} from './types';
import { RESULT_EVENT_TYPE } from './workforce';

export type IncidentKind =
  | 'dead_letter'
  | 'failed_side_effect'
  | 'uncertain_side_effect'
  | 'contact_leak'
  | 'injection_rejected'
  | 'artifact_unrecorded'
  | 'patch_unrecorded'
  | 'anomaly';

export interface Incident {
  id: string;
  kind: IncidentKind;
  severity: Severity;
  title: string;
  occurred_at: string | null;
  goal_id: string | null;
  job_id: string | null;
  evidence_refs: string[];
  deep_link: string;
}

export interface IncidentsInput {
  now: string;
  deadLetters: Row[];
  // side_effects rows in status 'failed' or 'uncertain'.
  failedSideEffects: Row[];
  // autonomy_anomalies rows (kind contact_leak => security finding).
  anomalies: Row[];
  // os_events rows of type GoalSubmitRejected (payload.errors codes).
  rejections: Row[];
  // os_events rows of type JobResultRecorded (unrecorded flags).
  resultEvents: Row[];
}

export interface IncidentsView {
  generated_at: string;
  incidents: Incident[];
  counts: {
    total: number;
    critical: number;
    high: number;
    normal: number;
    by_kind: Record<string, number>;
  };
}

export const REJECTION_EVENT_TYPE = 'GoalSubmitRejected';
const INJECTION_CODE_PREFIX = 'injection:';

function payloadOf(r: Row): Row {
  const p = r['payload'];
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Row) : {};
}

function deadLetter(r: Row): Incident {
  const jobId = str(r, 'id');
  const refs = stringList(r['evidence_refs']);
  refs.unshift('job:' + jobId);
  const label = str(r, 'title') || str(r, 'kind') || 'job';
  const reason = strOrNull(r, 'failure_reason');
  return {
    id: 'dead_letter:' + jobId,
    kind: 'dead_letter',
    severity: 'high',
    title: bounded('dead-lettered ' + label +
      (reason ? ' - ' + reason : ''), 200),
    occurred_at: strOrNull(r, 'updated_at'),
    goal_id: strOrNull(r, 'goal_id'),
    job_id: jobId,
    evidence_refs: refs,
    deep_link: DEEP_LINKS.job(jobId),
  };
}

function sideEffect(r: Row): Incident | null {
  const status = str(r, 'status');
  if (status !== 'failed' && status !== 'uncertain') return null;
  const id = str(r, 'side_effect_id') || str(r, 'id');
  const refs = stringList(r['evidence_refs']);
  refs.unshift('side_effect:' + id);
  const reason = strOrNull(r, 'error_message');
  const label = (str(r, 'capability') || 'side effect') + ' -> ' +
    (str(r, 'target') || 'unknown target');
  const uncertain = status === 'uncertain';
  return {
    id: 'side_effect:' + id,
    // An UNCERTAIN external effect is worse than a known failure: the
    // provider state is unknown and a retry could double-send.
    kind: uncertain ? 'uncertain_side_effect' : 'failed_side_effect',
    severity: uncertain ? 'critical' : 'high',
    title: bounded(label + (uncertain ? ' outcome UNCERTAIN' : ' failed') +
      (reason ? ': ' + reason : ''), 200),
    occurred_at: strOrNull(r, 'updated_at') ?? strOrNull(r, 'created_at'),
    goal_id: strOrNull(r, 'goal_id'),
    job_id: strOrNull(r, 'job_id'),
    evidence_refs: refs,
    deep_link: DEEP_LINKS.sideEffect(id),
  };
}

const ANOMALY_SEVERITY: Readonly<Record<string, Severity>> = {
  critical: 'critical',
  major: 'high',
  minor: 'normal',
};

function anomaly(r: Row): Incident {
  const id = str(r, 'id');
  const kind = str(r, 'kind');
  const evidence = r['evidence'];
  const refs: string[] = ['anomaly:' + id];
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const e = evidence as Row;
    for (const k of ['message_id', 'side_effect_id', 'job_id', 'ref']) {
      const v = strOrNull(e, k);
      if (v) refs.push(k + ':' + v);
    }
  }
  const leak = kind === 'contact_leak';
  return {
    id: 'anomaly:' + id,
    kind: leak ? 'contact_leak' : 'anomaly',
    // A client contact leak is an owner HARD RULE breach: always critical.
    severity: leak ? 'critical' : ANOMALY_SEVERITY[str(r, 'severity')] ?? 'high',
    title: bounded(leak
      ? 'client contact leak detected (vendor-facing material)'
      : 'autonomy anomaly: ' + (kind || 'other'), 200),
    occurred_at: strOrNull(r, 'detected_at'),
    goal_id: null,
    job_id: null,
    evidence_refs: refs,
    deep_link: DEEP_LINKS.incident(id),
  };
}

function rejection(r: Row): Incident | null {
  if (str(r, 'type') !== REJECTION_EVENT_TYPE) return null;
  const p = payloadOf(r);
  const codes = stringList(p['errors'], 8);
  const injection = codes.filter((c) => c.startsWith(INJECTION_CODE_PREFIX));
  if (injection.length === 0) return null;
  const requestId = str(p, 'request_id') || str(r, 'id');
  return {
    id: 'rejection:' + requestId,
    kind: 'injection_rejected',
    severity: 'high',
    title: bounded('goal intake refused: ' + injection.join(','), 200),
    occurred_at: strOrNull(p, 'rejected_at') ?? strOrNull(r, 'created_at'),
    goal_id: null,
    job_id: null,
    evidence_refs: ['event:' + str(r, 'id'), 'submit:' + requestId],
    deep_link: DEEP_LINKS.rejection(requestId),
  };
}

function unrecorded(r: Row): Incident[] {
  if (str(r, 'type') !== RESULT_EVENT_TYPE) return [];
  const p = payloadOf(r);
  const jobId = strOrNull(p, 'job_id');
  const out: Incident[] = [];
  const base = {
    occurred_at: strOrNull(r, 'created_at'),
    goal_id: strOrNull(p, 'goal_id'),
    job_id: jobId,
    deep_link: jobId ? DEEP_LINKS.job(jobId) : DEEP_LINKS.incident(str(r, 'id')),
  };
  if (p['artifact_unrecorded'] === true) {
    out.push({
      ...base,
      id: 'artifact_unrecorded:' + str(r, 'id'),
      kind: 'artifact_unrecorded',
      severity: 'high',
      title: bounded('artifact UNRECORDED for job ' + (jobId ?? 'unknown') +
        ' - work succeeded but persistence failed', 200),
      evidence_refs: ['event:' + str(r, 'id'), ...stringList(p['artifact_refs'])],
    });
  }
  if (p['patch_unrecorded'] === true) {
    const patchRef = strOrNull(p, 'patch_ref');
    out.push({
      ...base,
      id: 'patch_unrecorded:' + str(r, 'id'),
      kind: 'patch_unrecorded',
      severity: 'high',
      title: bounded('patch UNRECORDED for job ' + (jobId ?? 'unknown') +
        ' - diff not durably preserved', 200),
      evidence_refs: ['event:' + str(r, 'id'),
        ...(patchRef ? ['patch:' + patchRef] : [])],
    });
  }
  return out;
}

export function sortIncidents(list: Incident[]): Incident[] {
  return [...list].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    const ta = a.occurred_at ?? '';
    const tb = b.occurred_at ?? '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function buildIncidents(input: IncidentsInput): IncidentsView {
  const list: Incident[] = [];
  const seen = new Set<string>();
  const push = (i: Incident | null) => {
    if (!i || seen.has(i.id)) return;
    seen.add(i.id);
    list.push(i);
  };
  for (const r of input.deadLetters) push(deadLetter(r));
  for (const r of input.failedSideEffects) push(sideEffect(r));
  for (const r of input.anomalies) push(anomaly(r));
  for (const r of input.rejections) push(rejection(r));
  for (const r of input.resultEvents) for (const i of unrecorded(r)) push(i);
  const incidents = sortIncidents(list);
  const byKind: Record<string, number> = {};
  let critical = 0;
  let high = 0;
  let normal = 0;
  for (const i of incidents) {
    byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    if (i.severity === 'critical') critical += 1;
    else if (i.severity === 'high') high += 1;
    else normal += 1;
  }
  return {
    generated_at: input.now,
    incidents,
    counts: {
      total: incidents.length,
      critical,
      high,
      normal,
      by_kind: Object.fromEntries(
        Object.keys(byKind).sort().map((k) => [k, byKind[k]])),
    },
  };
}
