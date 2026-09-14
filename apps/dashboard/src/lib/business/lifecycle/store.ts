// Phase 6 - Supabase adapters for the install -> closeout tables.
//
// Same idiom as lib/business/business-store.ts: RuntimeClient injected,
// RLS-bound, service-role key never used, every write validates first,
// state changes are compare-and-set on the state the caller saw, reads
// fail closed with an error string. No deletes exist (migration 0035
// grants none). Nothing here reaches a vendor, a client, or a money rail.

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import { UUID_RE } from '../types';
import type { CloseoutPackage } from './closeout';
import type { CrewAssignmentProposal } from './crew-scheduling';
import type { InstallReadinessCheck } from './install-readiness';
import type { InstallStateRecord } from './install-state';
import type { PunchItem } from './punch';
import type { ReceivingEvent } from './receiving';
import {
  isCloseoutState,
  isCrewAssignmentState,
  isInstallState,
  isIsoTimestamp,
  isPunchSeverity,
  isPunchState,
  isReceivingEventKind,
  type CrewAssignmentState,
  type InstallState,
  type PunchState,
} from './types';

export const LIFECYCLE_TABLES = {
  receivingEvents: 'receiving_events',
  readinessChecks: 'install_readiness_checks',
  crewAssignments: 'crew_assignments',
  installStates: 'install_states',
  punchItems: 'punch_items',
  closeoutPackages: 'closeout_packages',
} as const;

export interface LifecycleListOutcome {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

function optionalUuid(v: unknown): boolean {
  return v === null || v === undefined ||
    (typeof v === 'string' && UUID_RE.test(v));
}

function uuidList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' &&
    UUID_RE.test(x));
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
      return { ok: false, error: `${table} insert failed: ` +
        res.error.message };
    }
    const id = res.data?.[0]?.['id'];
    return { ok: true, id: id ? String(id) : String(row.id ?? '') };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `${table} insert failed`,
    };
  }
}

async function runList(q: PromiseLike<QueryResult>):
  Promise<LifecycleListOutcome> {
  try {
    const res = await q;
    if (res.error) return { ok: false, rows: [], error: res.error.message };
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
}

// --- receiving_events (append-only, idempotent on id) ------------------------

export async function insertReceivingEvent(
  client: RuntimeClient,
  ev: ReceivingEvent,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(ev.id)) return { ok: false, error: 'invalid id' };
  if (!UUID_RE.test(ev.project_id)) {
    return { ok: false, error: 'invalid project_id' };
  }
  if (!optionalUuid(ev.vendor_order_id)) {
    return { ok: false, error: 'invalid vendor_order_id' };
  }
  if (!optionalUuid(ev.po_package_id)) {
    return { ok: false, error: 'invalid po_package_id' };
  }
  if (!isReceivingEventKind(ev.event)) {
    return { ok: false, error: 'invalid event' };
  }
  if (!isIsoTimestamp(ev.occurred_at)) {
    return { ok: false, error: 'invalid occurred_at' };
  }
  if (typeof ev.recorded_by !== 'string' || ev.recorded_by.length === 0) {
    return { ok: false, error: 'recorded_by required' };
  }
  const photos = ev.photos_document_ids ?? [];
  if (!uuidList(photos)) return { ok: false, error: 'invalid photo ids' };
  return insertRow(client, LIFECYCLE_TABLES.receivingEvents, {
    id: ev.id,
    project_id: ev.project_id,
    vendor_order_id: ev.vendor_order_id ?? null,
    po_package_id: ev.po_package_id ?? null,
    event: ev.event,
    occurred_at: ev.occurred_at,
    recorded_by: ev.recorded_by,
    line_items: ev.line_items ?? [],
    photos_document_ids: photos,
    notes: ev.notes ?? null,
  });
}

export async function listReceivingEvents(
  client: RuntimeClient,
  projectId: string,
): Promise<LifecycleListOutcome> {
  if (!UUID_RE.test(projectId)) {
    return { ok: false, rows: [], error: 'invalid project id' };
  }
  return runList(
    client
      .from(LIFECYCLE_TABLES.receivingEvents)
      .select('*')
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: true })
      .limit(500),
  );
}

// --- install_readiness_checks (append-only evidence) ---------------------------

export async function insertReadinessCheck(
  client: RuntimeClient,
  check: InstallReadinessCheck & { id: string },
): Promise<WriteOutcome> {
  if (!UUID_RE.test(check.id)) return { ok: false, error: 'invalid id' };
  if (!UUID_RE.test(check.project_id)) {
    return { ok: false, error: 'invalid project_id' };
  }
  if (!isIsoTimestamp(check.evaluated_at)) {
    return { ok: false, error: 'invalid evaluated_at' };
  }
  if (check.predicates === null || typeof check.predicates !== 'object') {
    return { ok: false, error: 'predicates required' };
  }
  const derivedAllOk = check.blocked_by.length === 0;
  if (check.all_ok !== derivedAllOk) {
    return { ok: false, error: 'all_ok inconsistent with blocked_by' };
  }
  return insertRow(client, LIFECYCLE_TABLES.readinessChecks, {
    id: check.id,
    project_id: check.project_id,
    evaluated_at: check.evaluated_at,
    predicates: check.predicates,
    all_ok: check.all_ok,
    blocked_by: [...check.blocked_by],
  });
}

// --- crew_assignments ----------------------------------------------------------

export async function insertCrewAssignment(
  client: RuntimeClient,
  id: string,
  proposal: CrewAssignmentProposal,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'invalid id' };
  if (!UUID_RE.test(proposal.project_id)) {
    return { ok: false, error: 'invalid project_id' };
  }
  if (proposal.state !== 'proposed') {
    return { ok: false, error: 'only proposals may be inserted' };
  }
  if (
    !isIsoTimestamp(proposal.scheduled_start) ||
    !isIsoTimestamp(proposal.scheduled_end) ||
    !isIsoTimestamp(nowIso)
  ) {
    return { ok: false, error: 'invalid timestamps' };
  }
  return insertRow(client, LIFECYCLE_TABLES.crewAssignments, {
    id,
    project_id: proposal.project_id,
    crew_id: proposal.crew_id,
    scheduled_start: proposal.scheduled_start,
    scheduled_end: proposal.scheduled_end,
    site_access: proposal.site_access,
    state: 'proposed',
    confirmed_by: null,
    updated_at: nowIso,
  });
}

const CREW_TRANSITIONS: Record<CrewAssignmentState, CrewAssignmentState[]> = {
  proposed: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function updateCrewAssignmentStateCAS(
  client: RuntimeClient,
  id: string,
  fromState: CrewAssignmentState,
  toState: CrewAssignmentState,
  actorId: string,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'invalid id' };
  if (!isCrewAssignmentState(fromState) || !isCrewAssignmentState(toState)) {
    return { ok: false, error: 'invalid state' };
  }
  if (!CREW_TRANSITIONS[fromState].includes(toState)) {
    return { ok: false, error: `${fromState} -> ${toState} not allowed` };
  }
  if (typeof actorId !== 'string' || actorId.length === 0) {
    return { ok: false, error: 'actor required' };
  }
  if (!isIsoTimestamp(nowIso)) return { ok: false, error: 'invalid timestamp' };
  const patch: Record<string, unknown> = { state: toState, updated_at: nowIso };
  if (toState === 'confirmed') patch.confirmed_by = actorId;
  try {
    const res = await client
      .from(LIFECYCLE_TABLES.crewAssignments)
      .update(patch)
      .eq('id', id)
      .eq('state', fromState)
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'state_conflict' };
    }
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'crew assignment update failed',
    };
  }
}

// --- install_states (one row per project; CAS on state) -------------------------

// fromState === null inserts the initial row (must be not_ready); otherwise
// the update is guarded on the state the caller saw. Zero matched rows =
// someone else moved it first.
export async function upsertInstallState(
  client: RuntimeClient,
  record: InstallStateRecord,
  fromState: InstallState | null,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(record.project_id)) {
    return { ok: false, error: 'invalid project_id' };
  }
  if (!isInstallState(record.state)) {
    return { ok: false, error: 'invalid state' };
  }
  if (!isIsoTimestamp(record.state_changed_at)) {
    return { ok: false, error: 'invalid state_changed_at' };
  }
  if (record.evidence === null || typeof record.evidence !== 'object') {
    return { ok: false, error: 'evidence must be an object' };
  }
  if (fromState === null) {
    if (record.state !== 'not_ready') {
      return { ok: false, error: 'initial state must be not_ready' };
    }
    return insertRow(client, LIFECYCLE_TABLES.installStates, {
      project_id: record.project_id,
      state: record.state,
      state_changed_at: record.state_changed_at,
      evidence: record.evidence,
    });
  }
  if (!isInstallState(fromState)) {
    return { ok: false, error: 'invalid from state' };
  }
  if (fromState === record.state) {
    return { ok: false, error: 'no-op transition refused' };
  }
  try {
    const res = await client
      .from(LIFECYCLE_TABLES.installStates)
      .update({
        state: record.state,
        state_changed_at: record.state_changed_at,
        evidence: record.evidence,
      })
      .eq('project_id', record.project_id)
      .eq('state', fromState)
      .select('project_id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'state_conflict' };
    }
    return { ok: true, id: record.project_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'install state update failed',
    };
  }
}

export async function readInstallState(
  client: RuntimeClient,
  projectId: string,
): Promise<LifecycleListOutcome> {
  if (!UUID_RE.test(projectId)) {
    return { ok: false, rows: [], error: 'invalid project id' };
  }
  return runList(
    client
      .from(LIFECYCLE_TABLES.installStates)
      .select('*')
      .eq('project_id', projectId)
      .limit(1),
  );
}

// --- punch_items -----------------------------------------------------------------

export async function insertPunchItem(
  client: RuntimeClient,
  item: PunchItem,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(item.id)) return { ok: false, error: 'invalid id' };
  if (!UUID_RE.test(item.project_id)) {
    return { ok: false, error: 'invalid project_id' };
  }
  if (typeof item.description !== 'string' || item.description.length === 0) {
    return { ok: false, error: 'description required' };
  }
  if (!isPunchSeverity(item.severity)) {
    return { ok: false, error: 'invalid severity' };
  }
  if (item.state !== 'open') {
    return { ok: false, error: 'new punch items must be open' };
  }
  if (!uuidList(item.photo_document_ids)) {
    return { ok: false, error: 'invalid photo ids' };
  }
  return insertRow(client, LIFECYCLE_TABLES.punchItems, {
    id: item.id,
    project_id: item.project_id,
    description: item.description,
    opening_code: item.opening_code ?? null,
    severity: item.severity,
    photo_document_ids: [...item.photo_document_ids],
    state: 'open',
    resolved_at: null,
    resolved_by: null,
  });
}

// CAS: only an item still open|in_progress may be closed. The caller has
// already run resolvePunchItem / waivePunchItem (punch.ts) which enforce
// the owner-only + cosmetic-only waiver rule; this adapter re-checks the
// target state so a bypass of the pure layer still cannot write anything
// but a legal closure.
export async function resolvePunchItemCAS(
  client: RuntimeClient,
  item: PunchItem,
  fromState: PunchState,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(item.id)) return { ok: false, error: 'invalid id' };
  if (fromState !== 'open' && fromState !== 'in_progress') {
    return { ok: false, error: 'from state must be open or in_progress' };
  }
  if (item.state !== 'resolved' && item.state !== 'waived_by_owner') {
    return { ok: false, error: 'target state must be resolved or waived' };
  }
  if (item.state === 'waived_by_owner') {
    if (item.severity !== 'cosmetic') {
      return { ok: false, error: 'only cosmetic items may be waived' };
    }
    if (typeof item.resolved_by !== 'string' ||
      !item.resolved_by.startsWith('owner:')) {
      return { ok: false, error: 'waiver requires an owner actor' };
    }
  }
  if (!isIsoTimestamp(item.resolved_at)) {
    return { ok: false, error: 'resolved_at required' };
  }
  if (typeof item.resolved_by !== 'string' || item.resolved_by.length === 0) {
    return { ok: false, error: 'resolved_by required' };
  }
  if (!isPunchState(item.state)) return { ok: false, error: 'invalid state' };
  try {
    const res = await client
      .from(LIFECYCLE_TABLES.punchItems)
      .update({
        state: item.state,
        resolved_at: item.resolved_at,
        resolved_by: item.resolved_by,
      })
      .eq('id', item.id)
      .eq('state', fromState)
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'state_conflict' };
    }
    return { ok: true, id: item.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'punch item update failed',
    };
  }
}

export async function listPunchItems(
  client: RuntimeClient,
  projectId: string,
): Promise<LifecycleListOutcome> {
  if (!UUID_RE.test(projectId)) {
    return { ok: false, rows: [], error: 'invalid project id' };
  }
  return runList(
    client
      .from(LIFECYCLE_TABLES.punchItems)
      .select('*')
      .eq('project_id', projectId)
      .limit(500),
  );
}

// --- closeout_packages (one per project; CAS on state) ---------------------------

function closeoutRow(id: string, pkg: CloseoutPackage): Record<string, unknown> {
  return {
    id,
    project_id: pkg.project_id,
    completion_certificate_document_id:
      pkg.completion_certificate_document_id ?? null,
    final_photos_document_ids: [...pkg.final_photos_document_ids],
    warranty_registration: pkg.warranty_registration,
    bdf_claims: pkg.bdf_claims,
    review_survey: pkg.review_survey,
    final_payment_eligible: pkg.final_payment_eligible === true,
    final_payment_evaluated_at: pkg.final_payment_evaluated_at ?? null,
    archived_at: pkg.archived_at ?? null,
    state: pkg.state,
  };
}

function validateCloseout(pkg: CloseoutPackage): string | null {
  if (!UUID_RE.test(pkg.project_id)) return 'invalid project_id';
  if (!optionalUuid(pkg.completion_certificate_document_id)) {
    return 'invalid completion certificate id';
  }
  if (!uuidList(pkg.final_photos_document_ids)) return 'invalid photo ids';
  if (!isCloseoutState(pkg.state)) return 'invalid state';
  if (typeof pkg.final_payment_eligible !== 'boolean') {
    return 'final_payment_eligible must be boolean';
  }
  if (pkg.final_payment_eligible && !isIsoTimestamp(
    pkg.final_payment_evaluated_at)) {
    return 'eligibility requires final_payment_evaluated_at';
  }
  if (pkg.state === 'archived' && !isIsoTimestamp(pkg.archived_at)) {
    return 'archived requires archived_at';
  }
  return null;
}

// fromState === null inserts (state must be open); otherwise CAS on the
// state the caller saw. A package never moves backwards from archived.
export async function upsertCloseoutPackage(
  client: RuntimeClient,
  id: string,
  pkg: CloseoutPackage,
  fromState: CloseoutPackage['state'] | null,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'invalid id' };
  const invalid = validateCloseout(pkg);
  if (invalid) return { ok: false, error: invalid };
  if (fromState === null) {
    if (pkg.state !== 'open') {
      return { ok: false, error: 'new closeout packages must be open' };
    }
    return insertRow(client, LIFECYCLE_TABLES.closeoutPackages,
      closeoutRow(id, pkg));
  }
  if (!isCloseoutState(fromState)) {
    return { ok: false, error: 'invalid from state' };
  }
  if (fromState === 'archived') {
    return { ok: false, error: 'archived packages are immutable' };
  }
  const { id: _id, project_id: _pid, ...patch } = closeoutRow(id, pkg);
  void _id;
  void _pid;
  try {
    const res = await client
      .from(LIFECYCLE_TABLES.closeoutPackages)
      .update(patch)
      .eq('id', id)
      .eq('project_id', pkg.project_id)
      .eq('state', fromState)
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'state_conflict' };
    }
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'closeout update failed',
    };
  }
}
