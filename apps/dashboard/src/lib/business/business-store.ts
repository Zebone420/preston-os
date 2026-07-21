// Business Command Center - Supabase adapters (Phase 6C).
//
// Same idiom as lib/ai-os/store.ts: server-side, RLS-bound (owner
// session via the anon key), service-role key NEVER used, every
// write validates first and is idempotent where a unique key
// exists, reads fail closed to empty results with an error string.
// This module persists business STATE only; it executes nothing,
// sends nothing, and never talks to an external business system.

import { redactSecrets } from '../ai-os/memory';
import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../ai-os/store';
import { UUID_RE } from './types';

export const BUSINESS_TABLES = {
  clients: 'business_clients',
  contacts: 'business_contacts',
  properties: 'business_properties',
  leads: 'sales_leads',
  quotes: 'quotes',
  quoteVersions: 'quote_versions',
  quoteItems: 'quote_items',
  projects: 'projects',
  milestones: 'project_milestones',
  vendorOrders: 'vendor_orders',
  installationEvents: 'installation_events',
  paymentSchedules: 'payment_schedules',
  paymentEvents: 'payment_events',
  communications: 'communication_records',
  activity: 'business_activity_events',
  recommendations: 'agent_recommendations',
  quoteDraftRuns: 'quote_draft_runs',
  approvalLinks: 'approval_links',
  approvals: 'approvals', // 0001 table, reused by the Approval Center
} as const;

export interface ListOutcome {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

async function runList(
  q: PromiseLike<QueryResult>,
): Promise<ListOutcome> {
  try {
    const res = await q;
    if (res.error) {
      return { ok: false, rows: [], error: res.error.message };
    }
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
}

export interface ListOptions {
  limit?: number;
  orderBy?: string;
  ascending?: boolean;
  eq?: { col: string; val: string };
}

const DEFAULT_LIMIT = 200;

export async function listBusinessRows(
  client: RuntimeClient,
  table: string,
  opts: ListOptions = {},
): Promise<ListOutcome> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 500);
  const orderBy = opts.orderBy ?? 'created_at';
  const ascending = opts.ascending ?? false;
  const base = client.from(table).select('*');
  if (opts.eq) {
    return runList(
      base
        .eq(opts.eq.col, opts.eq.val)
        .order(orderBy, { ascending })
        .limit(limit),
    );
  }
  return runList(base.order(orderBy, { ascending }).limit(limit));
}

async function insertRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(table).insert(row).select('id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: String(row.id ?? '') };
      }
      return {
        ok: false,
        error: `${table} record failed: ` + res.error.message,
      };
    }
    const id = res.data?.[0]?.['id'];
    return { ok: true, id: id ? String(id) : String(row.id ?? '') };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `${table} record failed`,
    };
  }
}

// --- activity ledger -------------------------------------------------------

export interface ActivityEventInput {
  source: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  actor: string;
  provenance?: Record<string, unknown>;
  correlation_id: string;
  approval_id?: string | null;
  simulation_state?: string;
  idempotency_key: string;
}

export async function insertActivityEvent(
  client: RuntimeClient,
  event: ActivityEventInput,
): Promise<WriteOutcome> {
  for (const key of [
    'source',
    'entity_type',
    'entity_id',
    'action',
    'summary',
    'actor',
    'correlation_id',
    'idempotency_key',
  ] as const) {
    const v = event[key];
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, error: `activity event missing ${key}` };
    }
  }
  return insertRow(client, BUSINESS_TABLES.activity, {
    source: event.source,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    action: event.action,
    summary: event.summary,
    actor: event.actor,
    provenance: redactSecrets(event.provenance ?? {}),
    correlation_id: event.correlation_id,
    approval_id: event.approval_id ?? null,
    simulation_state: event.simulation_state ?? 'simulation',
    idempotency_key: event.idempotency_key,
  });
}

// --- quote draft persistence ----------------------------------------------

export async function readQuoteDraftRunByKey(
  client: RuntimeClient,
  idempotencyKey: string,
): Promise<ListOutcome> {
  return runList(
    client
      .from(BUSINESS_TABLES.quoteDraftRuns)
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .limit(1),
  );
}

export async function readQuoteById(
  client: RuntimeClient,
  quoteId: string,
): Promise<ListOutcome> {
  if (!UUID_RE.test(quoteId)) {
    return { ok: false, rows: [], error: 'invalid quote id' };
  }
  return runList(
    client
      .from(BUSINESS_TABLES.quotes)
      .select('*')
      .eq('id', quoteId)
      .limit(1),
  );
}

export async function insertBusinessRecord(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
): Promise<WriteOutcome> {
  const allowed = new Set<string>(Object.values(BUSINESS_TABLES));
  if (!allowed.has(table)) {
    return { ok: false, error: 'unknown business table' };
  }
  return insertRow(client, table, row);
}

// Compare-and-set bump of quotes.current_version so two concurrent
// drafts cannot both claim the same version number. Zero matched
// rows = lost race (caller retries with a fresh read or fails).
export async function bumpQuoteVersionCAS(
  client: RuntimeClient,
  quoteId: string,
  fromVersion: number,
  toVersion: number,
  status: string,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(quoteId)) {
    return { ok: false, error: 'invalid quote id' };
  }
  try {
    const res = await client
      .from(BUSINESS_TABLES.quotes)
      .update({
        current_version: toVersion,
        status,
        updated_at: nowIso,
      })
      .eq('id', quoteId)
      .eq('current_version', String(fromVersion))
      .select('id');
    if (res.error) {
      return { ok: false, error: res.error.message };
    }
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'version_conflict' };
    }
    return { ok: true, id: quoteId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'version bump failed',
    };
  }
}

// --- approvals bridge ------------------------------------------------------

export interface ApprovalRequestInput {
  requested_action: string;
  action_class: 'GREEN' | 'YELLOW' | 'RED';
  notes?: string;
}

// Creates a pending approvals row (0001 table). Decision recording
// stays in lib/approvals-store.decideApprovalRow. No execution of
// any kind follows from this record.
export async function insertApprovalRequest(
  client: RuntimeClient,
  input: ApprovalRequestInput,
): Promise<WriteOutcome> {
  if (
    typeof input.requested_action !== 'string' ||
    input.requested_action.length === 0
  ) {
    return { ok: false, error: 'requested_action required' };
  }
  return insertRow(client, BUSINESS_TABLES.approvals, {
    requested_action: input.requested_action,
    action_class: input.action_class,
    approver: 'owner',
    decision: 'pending',
    explicit_confirmation: false,
    notes: input.notes ?? null,
  });
}

export async function insertApprovalLink(
  client: RuntimeClient,
  approvalId: string,
  entityType: string,
  entityId: string,
  linkKind: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(approvalId)) {
    return { ok: false, error: 'invalid approval id' };
  }
  return insertRow(client, BUSINESS_TABLES.approvalLinks, {
    approval_id: approvalId,
    entity_type: entityType,
    entity_id: entityId,
    link_kind: linkKind,
  });
}

export async function listApprovalLinksFor(
  client: RuntimeClient,
  approvalId: string,
): Promise<ListOutcome> {
  if (!UUID_RE.test(approvalId)) {
    return { ok: false, rows: [], error: 'invalid approval id' };
  }
  return runList(
    client
      .from(BUSINESS_TABLES.approvalLinks)
      .select('*')
      .eq('approval_id', approvalId)
      .limit(20),
  );
}

// --- recommendations -------------------------------------------------------

export async function updateRecommendationStatusCAS(
  client: RuntimeClient,
  recommendationId: string,
  fromStatus: string,
  toStatus: string,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(recommendationId)) {
    return { ok: false, error: 'invalid recommendation id' };
  }
  const valid = ['open', 'acknowledged', 'dismissed', 'superseded'];
  if (!valid.includes(toStatus) || !valid.includes(fromStatus)) {
    return { ok: false, error: 'invalid status' };
  }
  try {
    const res = await client
      .from(BUSINESS_TABLES.recommendations)
      .update({ status: toStatus, updated_at: nowIso })
      .eq('id', recommendationId)
      .eq('status', fromStatus)
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'not_in_expected_status' };
    }
    return { ok: true, id: recommendationId };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : 'recommendation update failed',
    };
  }
}
