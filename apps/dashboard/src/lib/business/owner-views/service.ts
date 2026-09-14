// Phase 2 - RLS-bound owner read service.  This is the single I/O adapter for
// the pure Today / Project / Workforce / Incidents / Brief builders.  Reads
// are bounded, never use a service-role key, and preserve unreadable buckets
// explicitly instead of turning read failures into empty/healthy state.

import type { RuntimeClient } from '../../ai-os/store';
import { buildOwnerBrief } from './brief';
import { buildIncidents } from './incidents';
import { buildProjectTruth, type ProjectTruth } from './project';
import { buildToday } from './today';
import type { ReadState, Row } from './types';
import { buildAiWorkforce } from './workforce';

const LIMIT = 200;

interface ReadRows {
  state: ReadState;
  rows: Row[];
}

async function readRows(client: RuntimeClient, table: string): Promise<ReadRows> {
  try {
    const result = await client.from(table).select('*').limit(LIMIT);
    if (result.error) {
      const absent = /relation .* does not exist|schema cache/i.test(result.error.message);
      return { state: absent ? 'migration_absent' : 'error', rows: [] };
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    return { state: rows.length > 0 ? 'ok' : 'empty', rows };
  } catch {
    return { state: 'error', rows: [] };
  }
}

function openApproval(row: Row, nowMs: number): Row {
  const expires = Date.parse(String(row.expires_at ?? ''));
  return {
    ...row,
    decision_open: String(row.status ?? '') === 'pending' &&
      Number.isFinite(expires) && expires > nowMs,
  };
}

function projectCodes(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const id = String(row.id ?? '');
    const code = String(row.project_code ?? '');
    if (id && code) out[id] = code;
  }
  return out;
}

export async function loadOwnerOverview(client: RuntimeClient, now: string) {
  const names = [
    'attention_items', 'orchestration_approvals', 'goal_jobs',
    'vendor_orders', 'side_effects', 'os_events', 'autonomy_anomalies',
    'projects',
  ] as const;
  const reads = await Promise.all(names.map((name) => readRows(client, name)));
  const by = Object.fromEntries(names.map((name, i) => [name, reads[i]])) as
    Record<(typeof names)[number], ReadRows>;
  const nowMs = Date.parse(now);
  const approvals = by.orchestration_approvals.rows.map((r) => openApproval(r, nowMs));
  const jobs = by.goal_jobs.rows;
  const resultEvents = by.os_events.rows.filter((r) =>
    String(r.type ?? '') === 'JobResultRecorded');
  const deadLetters = jobs.filter((r) => String(r.status ?? '') === 'dead_lettered');
  const failedJobs = jobs.filter((r) => String(r.status ?? '') === 'failed');
  const runningJobs = jobs.filter((r) =>
    ['pending', 'ready', 'assigned', 'in_progress'].includes(String(r.status ?? '')));
  const sideEffects = by.side_effects.rows;
  const failedSideEffects = sideEffects.filter((r) =>
    ['failed', 'uncertain'].includes(String(r.status ?? '')));
  const failedSends = sideEffects.filter((r) =>
    String(r.status ?? '') === 'failed' &&
    /^(gmail|calendar)\./.test(String(r.capability ?? '')));
  const vendorDelays = by.vendor_orders.rows.filter((r) =>
    r.backordered === true ||
    ['backordered', 'delayed', 'exception'].includes(String(r.delivery_status ?? '')));
  const today = buildToday({
    now,
    attentionItems: by.attention_items.rows,
    approvals,
    runningJobs,
    failedJobs,
    deadLetters,
    vendorDelays,
    failedSends,
    projectCodes: projectCodes(by.projects.rows),
  });
  const workforce = buildAiWorkforce({ now, jobs, resultEvents });
  const incidents = buildIncidents({
    now,
    deadLetters,
    failedSideEffects,
    anomalies: by.autonomy_anomalies.rows,
    rejections: by.os_events.rows.filter((r) =>
      String(r.type ?? '') === 'GoalSubmitRejected'),
    resultEvents,
  });
  const readStates = Object.fromEntries(
    names.map((name) => [name, by[name].state]),
  ) as Record<string, ReadState>;
  const unreadable = Object.entries(readStates)
    .filter(([, state]) => state === 'error' || state === 'migration_absent')
    .map(([name]) => name);
  return {
    generated_at: now,
    today,
    approvals: approvals.filter((r) => r.decision_open === true),
    workforce,
    incidents,
    brief: buildOwnerBrief(today, workforce, incidents, null, unreadable),
    read_states: readStates,
  };
}

function related(rows: Row[], projectId: string): Row[] {
  return rows.filter((r) => String(r.project_id ?? '') === projectId);
}

export async function loadOwnerProject(
  client: RuntimeClient,
  now: string,
  projectRef: string,
  scope: 'owner' | 'restricted' = 'owner',
): Promise<ProjectTruth> {
  const names = [
    'projects', 'business_clients', 'business_properties', 'communication_messages',
    'communication_events', 'quotes', 'quote_versions', 'documents',
    'project_milestones', 'final_measurements', 'payment_events',
    'payment_expectations', 'contracts', 'vendor_orders',
    'purchase_order_packages', 'receiving_events', 'installation_events',
    'install_states', 'punch_items', 'attention_items',
  ] as const;
  const reads = await Promise.all(names.map((name) => readRows(client, name)));
  const by = Object.fromEntries(names.map((name, i) => [name, reads[i]])) as
    Record<(typeof names)[number], ReadRows>;
  const project = by.projects.rows.find((r) =>
    String(r.id ?? '') === projectRef || String(r.project_code ?? '') === projectRef) ?? null;
  const projectId = String(project?.id ?? '');
  const quoteId = String(project?.quote_id ?? '');
  const clientRow = by.business_clients.rows.find((r) =>
    String(r.id ?? '') === String(project?.client_id ?? '')) ?? null;
  const property = by.business_properties.rows.find((r) =>
    String(r.id ?? '') === String(project?.property_id ?? '')) ?? null;
  const readStates = Object.fromEntries(
    names.map((name) => [name, by[name].state]),
  ) as Record<string, ReadState>;
  return buildProjectTruth(projectRef, {
    now,
    scope,
    project,
    client: clientRow,
    property,
    stage: project ? String(project.stage ?? project.status ?? '') : null,
    // The stage fact snapshot is not stored as one authoritative row yet.
    // Do not synthesize it from partial data; the view reports no gate rather
    // than fabricating a pass.
    facts: null,
    messages: related(by.communication_messages.rows, projectId),
    commEvents: related(by.communication_events.rows, projectId),
    quotes: by.quotes.rows.filter((r) =>
      String(r.id ?? '') === quoteId || String(r.project_id ?? '') === projectId),
    quoteVersions: by.quote_versions.rows.filter((r) =>
      String(r.quote_id ?? '') === quoteId),
    documents: related(by.documents.rows, projectId),
    appointments: related(by.project_milestones.rows, projectId),
    measurements: related(by.final_measurements.rows, projectId),
    payments: related(by.payment_events.rows, projectId),
    paymentExpectations: related(by.payment_expectations.rows, projectId),
    contracts: related(by.contracts.rows, projectId),
    orders: related(by.vendor_orders.rows, projectId),
    poPackages: related(by.purchase_order_packages.rows, projectId),
    receiving: related(by.receiving_events.rows, projectId),
    installEvents: related(by.installation_events.rows, projectId),
    installStates: related(by.install_states.rows, projectId),
    punchItems: related(by.punch_items.rows, projectId),
    attentionItems: related(by.attention_items.rows, projectId),
    readStates,
  });
}
