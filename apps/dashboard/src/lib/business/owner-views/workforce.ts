// Phase 2 - Hermes AI WORKFORCE view. PURE.
//
// Active Claude / Codex jobs with durations, results, failures, evidence
// refs and durable patch refs, built from the SAME rows the orchestration
// read model already loads (goal_jobs) plus the JobResultRecorded events
// the driver writes per attempt (correlation result:job:<id>). Nothing is
// inferred: a job with no recorded report shows result null.

import {
  DEEP_LINKS,
  bounded,
  num,
  parseMs,
  str,
  strOrNull,
  stringList,
  type Row,
} from './types';
import { ACTIVE_JOB_STATUSES } from './today';

export const RESULT_EVENT_TYPE = 'JobResultRecorded';
export const RESULT_CORRELATION_PREFIX = 'result:job:';
const PATCH_REF_PREFIX = 'patch:';
const ARTIFACT_REF_PREFIX = 'artifact:';

export interface WorkforceResult {
  attempt: number;
  outcome: string;
  executed: boolean;
  mode: string;
  provider_model: string | null;
  summary: string;
  files_changed: number;
  duration_ms: number | null;
  recorded_at: string;
}

export interface WorkforceJob {
  job_id: string;
  goal_id: string;
  kind: string;
  title: string;
  status: string;
  role: string | null;
  risk_class: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  // Reported process duration of the latest attempt; for a job that is
  // still active with no report yet, elapsed since creation.
  duration_ms: number | null;
  duration_source: 'reported' | 'elapsed' | 'unknown';
  result: WorkforceResult | null;
  failure_reason: string | null;
  evidence_refs: string[];
  patch_refs: string[];
  artifact_refs: string[];
  unrecorded: { artifact: boolean; patch: boolean };
  deep_link: string;
}

export interface WorkforceInput {
  now: string;
  jobs: Row[];
  // os_events rows of type JobResultRecorded (payload carries the report).
  resultEvents: Row[];
}

export interface AiWorkforceView {
  generated_at: string;
  active: WorkforceJob[];
  awaiting_approval: WorkforceJob[];
  completed: WorkforceJob[];
  failed: WorkforceJob[];
  counts: {
    active: number;
    awaiting_approval: number;
    completed: number;
    failed: number;
    dead_lettered: number;
  };
  by_role: Record<string, number>;
}

function payloadOf(r: Row): Row {
  const p = r['payload'];
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Row) : {};
}

// Latest report per job: highest attempt wins, then latest created_at.
function latestReports(events: Row[]): Map<string, { row: Row; payload: Row }> {
  const out = new Map<string, { row: Row; payload: Row }>();
  for (const row of events) {
    if (str(row, 'type') !== RESULT_EVENT_TYPE) continue;
    const payload = payloadOf(row);
    const corr = str(row, 'correlation_id');
    const jobId = str(payload, 'job_id') ||
      (corr.startsWith(RESULT_CORRELATION_PREFIX)
        ? corr.slice(RESULT_CORRELATION_PREFIX.length)
        : '');
    if (!jobId) continue;
    const prev = out.get(jobId);
    if (!prev) { out.set(jobId, { row, payload }); continue; }
    const a = num(payload, 'attempt');
    const b = num(prev.payload, 'attempt');
    if (a > b) { out.set(jobId, { row, payload }); continue; }
    if (a === b && str(row, 'created_at') > str(prev.row, 'created_at')) {
      out.set(jobId, { row, payload });
    }
  }
  return out;
}

function toResult(report: { row: Row; payload: Row }): WorkforceResult {
  const p = report.payload;
  const duration = p['duration_ms'];
  return {
    attempt: num(p, 'attempt'),
    outcome: str(p, 'outcome'),
    executed: p['executed'] === true,
    mode: str(p, 'mode'),
    provider_model: strOrNull(p, 'provider_model'),
    summary: bounded(p['summary'], 400),
    files_changed: Array.isArray(p['files_changed'])
      ? p['files_changed'].length : 0,
    duration_ms: typeof duration === 'number' && Number.isFinite(duration)
      ? duration : null,
    recorded_at: str(report.row, 'created_at'),
  };
}

export function toWorkforceJob(
  r: Row,
  report: { row: Row; payload: Row } | undefined,
  nowMs: number,
): WorkforceJob {
  const status = str(r, 'status');
  const evidence = stringList(r['evidence_refs']);
  const patchRefs = evidence.filter((e) => e.startsWith(PATCH_REF_PREFIX));
  const artifactRefs = evidence.filter((e) => e.startsWith(ARTIFACT_REF_PREFIX));
  const p = report?.payload;
  if (p) {
    for (const ref of stringList(p['artifact_refs'])) {
      if (!artifactRefs.includes(ref)) artifactRefs.push(ref);
    }
    const patchRef = strOrNull(p, 'patch_ref');
    if (patchRef) {
      const tagged = patchRef.startsWith(PATCH_REF_PREFIX)
        ? patchRef : PATCH_REF_PREFIX + patchRef;
      if (!patchRefs.includes(tagged)) patchRefs.push(tagged);
    }
  }
  const result = report ? toResult(report) : null;
  let duration: number | null = null;
  let source: WorkforceJob['duration_source'] = 'unknown';
  if (result && result.duration_ms !== null) {
    duration = result.duration_ms;
    source = 'reported';
  } else if (ACTIVE_JOB_STATUSES.has(status)) {
    const created = parseMs(str(r, 'created_at'));
    if (created !== null && Number.isFinite(nowMs) && nowMs >= created) {
      duration = nowMs - created;
      source = 'elapsed';
    }
  }
  return {
    job_id: str(r, 'id'),
    goal_id: str(r, 'goal_id'),
    kind: str(r, 'kind'),
    title: bounded(r['title'], 200),
    status,
    role: strOrNull(r, 'assigned_role') ?? (p ? strOrNull(p, 'provider_role') : null),
    risk_class: str(r, 'risk_class'),
    attempts: num(r, 'attempts'),
    created_at: str(r, 'created_at'),
    updated_at: str(r, 'updated_at'),
    duration_ms: duration,
    duration_source: source,
    result,
    failure_reason: strOrNull(r, 'failure_reason') ??
      (p ? strOrNull(p, 'failure_reason') : null),
    evidence_refs: evidence,
    patch_refs: patchRefs,
    artifact_refs: artifactRefs,
    unrecorded: {
      artifact: p ? p['artifact_unrecorded'] === true : false,
      patch: p ? p['patch_unrecorded'] === true : false,
    },
    deep_link: DEEP_LINKS.job(str(r, 'id')),
  };
}

const byUpdatedDesc = (a: WorkforceJob, b: WorkforceJob): number => {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
  return a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0;
};

export function buildAiWorkforce(input: WorkforceInput): AiWorkforceView {
  const nowMs = Date.parse(input.now);
  const reports = latestReports(input.resultEvents);
  const active: WorkforceJob[] = [];
  const awaiting: WorkforceJob[] = [];
  const completed: WorkforceJob[] = [];
  const failed: WorkforceJob[] = [];
  const byRole: Record<string, number> = {};
  let dead = 0;
  const seen = new Set<string>();
  for (const r of input.jobs) {
    const id = str(r, 'id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const job = toWorkforceJob(r, reports.get(id), nowMs);
    const role = job.role ?? 'unassigned';
    byRole[role] = (byRole[role] ?? 0) + 1;
    if (ACTIVE_JOB_STATUSES.has(job.status)) active.push(job);
    else if (job.status === 'awaiting_approval') awaiting.push(job);
    else if (job.status === 'completed') completed.push(job);
    else if (job.status === 'failed' || job.status === 'dead_lettered') {
      if (job.status === 'dead_lettered') dead += 1;
      failed.push(job);
    }
    // cancelled jobs are neither work nor failure; they fall out of view.
  }
  active.sort(byUpdatedDesc);
  awaiting.sort(byUpdatedDesc);
  completed.sort(byUpdatedDesc);
  failed.sort(byUpdatedDesc);
  return {
    generated_at: input.now,
    active,
    awaiting_approval: awaiting,
    completed,
    failed,
    counts: {
      active: active.length,
      awaiting_approval: awaiting.length,
      completed: completed.length,
      failed: failed.length,
      dead_lettered: dead,
    },
    by_role: Object.fromEntries(
      Object.keys(byRole).sort().map((k) => [k, byRole[k]])),
  };
}
