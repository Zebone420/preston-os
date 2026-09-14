import { describe, expect, it } from 'vitest';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import type { CloseoutPackage } from '../src/lib/business/lifecycle/closeout';
import type { CrewAssignmentProposal } from
  '../src/lib/business/lifecycle/crew-scheduling';
import type { InstallReadinessCheck } from
  '../src/lib/business/lifecycle/install-readiness';
import type { PunchItem } from '../src/lib/business/lifecycle/punch';
import {
  insertCrewAssignment,
  insertPunchItem,
  insertReadinessCheck,
  insertReceivingEvent,
  LIFECYCLE_TABLES,
  listPunchItems,
  listReceivingEvents,
  readInstallState,
  resolvePunchItemCAS,
  updateCrewAssignmentStateCAS,
  upsertCloseoutPackage,
  upsertInstallState,
} from '../src/lib/business/lifecycle/store';

const P = '00000000-0000-4000-8000-0000000000aa';
const ID = '00000000-0000-4000-8000-0000000000e1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
const AT = '2026-09-05T10:00:00.000Z';

const OK: QueryResult = { data: [{ id: ID, project_id: P }], error: null };
const NONE: QueryResult = { data: [], error: null };
const UNIQUE: QueryResult = {
  data: null, error: { message: 'duplicate key value violates unique constraint' },
};
const BOOM: QueryResult = { data: null, error: { message: 'permission denied' } };

interface Call {
  op: 'insert' | 'update' | 'select';
  table: string;
  row?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
}

function scripted(script: {
  insert?: QueryResult[]; update?: QueryResult[]; select?: QueryResult[];
}) {
  const calls: Call[] = [];
  const next = (k: 'insert' | 'update' | 'select'): QueryResult =>
    script[k]?.shift() ?? OK;
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          const call: Call = { op: 'insert', table, row, filters: [] };
          calls.push(call);
          return { select: async () => next('insert') };
        },
        update(row: Record<string, unknown>) {
          const call: Call = { op: 'update', table, row, filters: [] };
          calls.push(call);
          type Node = {
            select: () => Promise<QueryResult>;
            eq: (c: string, v: unknown) => Node;
            lte: (c: string, v: unknown) => Node;
            gt: (c: string, v: unknown) => Node;
          };
          const node: Node = {
            select: async () => next('update'),
            eq: (c, v) => { call.filters.push(['eq', c, v]); return node; },
            lte: (c, v) => { call.filters.push(['lte', c, v]); return node; },
            gt: (c, v) => { call.filters.push(['gt', c, v]); return node; },
          };
          return node;
        },
        select() {
          const call: Call = { op: 'select', table, filters: [] };
          calls.push(call);
          const limit = async () => next('select');
          type Node = {
            limit: (n: number) => Promise<QueryResult>;
            eq: (c: string, v: unknown) => Node;
            order: (c: string, o: { ascending: boolean }) =>
              { limit: (n: number) => Promise<QueryResult> };
          };
          const node: Node = {
            limit,
            eq: (c, v) => { call.filters.push(['eq', c, v]); return node; },
            order: (c, o) => {
              call.filters.push(['order', c, o.ascending]); return { limit };
            },
          };
          return node;
        },
      };
    },
  };
  return { client, calls };
}

const EVENT = {
  id: ID, project_id: P, event: 'delivered' as const, occurred_at: AT,
  recorded_by: 'owner', photos_document_ids: [DOC],
};

describe('insertReceivingEvent', () => {
  it('inserts the row and treats a replay as an idempotent duplicate', async () => {
    const { client, calls } = scripted({ insert: [OK, UNIQUE] });
    const r1 = await insertReceivingEvent(client, EVENT);
    expect(r1).toEqual({ ok: true, id: ID });
    expect(calls[0].table).toBe(LIFECYCLE_TABLES.receivingEvents);
    expect(calls[0].row).toMatchObject({ event: 'delivered', line_items: [],
      photos_document_ids: [DOC], vendor_order_id: null });
    const r2 = await insertReceivingEvent(client, EVENT);
    expect(r2).toEqual({ ok: true, duplicate: true, id: ID });
  });
  it('fails closed on validation and db errors (no write on validation)', async () => {
    const { client, calls } = scripted({ insert: [BOOM] });
    expect((await insertReceivingEvent(client, { ...EVENT, id: 'e1' })).ok)
      .toBe(false);
    expect((await insertReceivingEvent(client,
      { ...EVENT, vendor_order_id: 'vo' })).ok).toBe(false);
    expect((await insertReceivingEvent(client,
      { ...EVENT, photos_document_ids: ['x'] })).ok).toBe(false);
    expect((await insertReceivingEvent(client,
      { ...EVENT, occurred_at: 'now' })).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const r = await insertReceivingEvent(client, EVENT);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/);
  });
  it('lists by project ordered by occurred_at', async () => {
    const { client, calls } = scripted({ select: [OK] });
    expect((await listReceivingEvents(client, P)).ok).toBe(true);
    expect(calls[0].filters).toEqual([['eq', 'project_id', P],
      ['order', 'occurred_at', true]]);
    expect((await listReceivingEvents(client, 'nope')).ok).toBe(false);
  });
});

describe('insertReadinessCheck (append-only)', () => {
  const check: InstallReadinessCheck & { id: string } = {
    id: ID, project_id: P, evaluated_at: AT,
    predicates: {
      all_units_received: false,
      site_access_confirmed: true,
      crew_confirmed: true,
      building_approval_on_file: true,
      final_measure_bound: true,
      payment_condition_for_install: true,
      client_contact_present_for_scheduling: true,
    },
    all_ok: false, blocked_by: ['all_units_received'],
  };
  it('inserts evidence rows', async () => {
    const { client, calls } = scripted({});
    expect((await insertReadinessCheck(client, check)).ok).toBe(true);
    expect(calls[0].op).toBe('insert');
    expect(calls[0].table).toBe(LIFECYCLE_TABLES.readinessChecks);
  });
  it('refuses an all_ok flag that contradicts blocked_by', async () => {
    const { client, calls } = scripted({});
    const r = await insertReadinessCheck(client, { ...check, all_ok: true });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('crew assignments', () => {
  const proposal: CrewAssignmentProposal = {
    project_id: P, crew_id: 'crew-a', scheduled_start: AT,
    scheduled_end: '2026-09-05T16:00:00.000Z',
    site_access: { contact_role: 'super', instructions: 'x',
      coi_required: false },
    state: 'proposed', confirmed_by: null,
    capability: 'crew_scheduling.propose', site_access_checklist: [],
  };
  it('inserts only proposals', async () => {
    const { client, calls } = scripted({});
    expect((await insertCrewAssignment(client, ID, proposal, AT)).ok).toBe(true);
    expect(calls[0].row).toMatchObject({ state: 'proposed', confirmed_by: null });
    const r = await insertCrewAssignment(client, ID,
      { ...proposal, state: 'confirmed' as 'proposed' }, AT);
    expect(r.ok).toBe(false);
  });
  it('confirm is CAS on proposed and records confirmed_by', async () => {
    const { client, calls } = scripted({ update: [OK, NONE] });
    const r = await updateCrewAssignmentStateCAS(client, ID, 'proposed',
      'confirmed', 'owner-1', AT);
    expect(r.ok).toBe(true);
    expect(calls[0].filters).toEqual([['eq', 'id', ID], ['eq', 'state', 'proposed']]);
    expect(calls[0].row).toMatchObject({ state: 'confirmed',
      confirmed_by: 'owner-1' });
    const lost = await updateCrewAssignmentStateCAS(client, ID, 'proposed',
      'confirmed', 'owner-1', AT);
    expect(lost).toEqual({ ok: false, error: 'state_conflict' });
    expect((await updateCrewAssignmentStateCAS(client, ID, 'completed',
      'confirmed', 'owner-1', AT)).ok).toBe(false);
  });
});

describe('upsertInstallState (CAS on state)', () => {
  it('inserts the initial not_ready row only', async () => {
    const { client, calls } = scripted({});
    const r = await upsertInstallState(client,
      { project_id: P, state: 'not_ready', state_changed_at: AT, evidence: {} },
      null);
    expect(r.ok).toBe(true);
    expect(calls[0].op).toBe('insert');
    const bad = await upsertInstallState(client,
      { project_id: P, state: 'ready', state_changed_at: AT, evidence: {} }, null);
    expect(bad.ok).toBe(false);
  });
  it('updates guarded on the prior state; conflict when moved elsewhere', async () => {
    const { client, calls } = scripted({ update: [OK, NONE] });
    const rec = { project_id: P, state: 'ready' as const, state_changed_at: AT,
      evidence: { readiness_all_ok: true } };
    expect((await upsertInstallState(client, rec, 'not_ready')).ok).toBe(true);
    expect(calls[0].filters).toEqual([['eq', 'project_id', P],
      ['eq', 'state', 'not_ready']]);
    expect(await upsertInstallState(client, rec, 'not_ready'))
      .toEqual({ ok: false, error: 'state_conflict' });
    expect((await upsertInstallState(client, rec, 'ready')).ok).toBe(false);
    expect((await upsertInstallState(client,
      { ...rec, state: 'flying' as 'ready' }, 'not_ready')).ok).toBe(false);
  });
  it('reads a single row by project id', async () => {
    const { client, calls } = scripted({ select: [OK] });
    expect((await readInstallState(client, P)).rows).toHaveLength(1);
    expect(calls[0].filters).toEqual([['eq', 'project_id', P]]);
  });
});

describe('punch items', () => {
  const open: PunchItem = {
    id: ID, project_id: P, description: 'scratch', severity: 'cosmetic',
    photo_document_ids: [DOC], state: 'open', resolved_at: null,
    resolved_by: null,
  };
  it('inserts open items only', async () => {
    const { client, calls } = scripted({});
    expect((await insertPunchItem(client, open)).ok).toBe(true);
    expect(calls[0].table).toBe(LIFECYCLE_TABLES.punchItems);
    expect((await insertPunchItem(client, { ...open, state: 'resolved' })).ok)
      .toBe(false);
    expect((await insertPunchItem(client,
      { ...open, photo_document_ids: ['nope'] })).ok).toBe(false);
  });
  it('resolve is CAS on open|in_progress', async () => {
    const { client, calls } = scripted({ update: [OK, NONE] });
    const resolved: PunchItem = { ...open, state: 'resolved', resolved_at: AT,
      resolved_by: 'crew:crew-a' };
    expect((await resolvePunchItemCAS(client, resolved, 'open')).ok).toBe(true);
    expect(calls[0].filters).toEqual([['eq', 'id', ID], ['eq', 'state', 'open']]);
    expect(await resolvePunchItemCAS(client, resolved, 'in_progress'))
      .toEqual({ ok: false, error: 'state_conflict' });
    expect((await resolvePunchItemCAS(client, resolved, 'resolved')).ok)
      .toBe(false);
    expect((await resolvePunchItemCAS(client, open, 'open')).ok).toBe(false);
  });
  it('waiver writes require owner actor and cosmetic severity', async () => {
    const { client, calls } = scripted({});
    const waived: PunchItem = { ...open, state: 'waived_by_owner',
      resolved_at: AT, resolved_by: 'owner:owner-1' };
    expect((await resolvePunchItemCAS(client, waived, 'open')).ok).toBe(true);
    expect((await resolvePunchItemCAS(client,
      { ...waived, resolved_by: 'crew:crew-a' }, 'open')).ok).toBe(false);
    expect((await resolvePunchItemCAS(client,
      { ...waived, severity: 'safety' }, 'open')).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
  it('lists by project', async () => {
    const { client } = scripted({ select: [BOOM] });
    const r = await listPunchItems(client, P);
    expect(r).toEqual({ ok: false, rows: [], error: 'permission denied' });
  });
});

describe('upsertCloseoutPackage (CAS on state)', () => {
  const pkg: CloseoutPackage = {
    project_id: P, completion_certificate_document_id: DOC,
    final_photos_document_ids: [DOC],
    warranty_registration: { andersen_registration_deadline: '2026-12-04',
      registered_at: null, registration_ref: null },
    bdf_claims: [], review_survey: { requested_at: null, response: null },
    final_payment_eligible: false, final_payment_evaluated_at: null,
    archived_at: null, state: 'open',
  };
  it('inserts a new open package', async () => {
    const { client, calls } = scripted({});
    expect((await upsertCloseoutPackage(client, ID, pkg, null)).ok).toBe(true);
    expect(calls[0].op).toBe('insert');
    expect(calls[0].row).toMatchObject({ id: ID, project_id: P, state: 'open',
      final_payment_eligible: false });
    expect((await upsertCloseoutPackage(client, ID,
      { ...pkg, state: 'complete' }, null)).ok).toBe(false);
  });
  it('updates guarded on id + project + prior state', async () => {
    const { client, calls } = scripted({ update: [OK, NONE] });
    const next: CloseoutPackage = { ...pkg, state: 'pending_final_payment',
      final_payment_eligible: true, final_payment_evaluated_at: AT };
    expect((await upsertCloseoutPackage(client, ID, next, 'open')).ok).toBe(true);
    expect(calls[0].filters).toEqual([['eq', 'id', ID], ['eq', 'project_id', P],
      ['eq', 'state', 'open']]);
    expect(calls[0].row).not.toHaveProperty('id');
    expect(await upsertCloseoutPackage(client, ID, next, 'open'))
      .toEqual({ ok: false, error: 'state_conflict' });
  });
  it('fails closed: eligibility without evaluation time, archived immutable, ' +
    'archived without archived_at', async () => {
    const { client, calls } = scripted({});
    expect((await upsertCloseoutPackage(client, ID,
      { ...pkg, final_payment_eligible: true }, 'open')).ok).toBe(false);
    expect((await upsertCloseoutPackage(client, ID,
      { ...pkg, state: 'complete' }, 'archived')).ok).toBe(false);
    expect((await upsertCloseoutPackage(client, ID,
      { ...pkg, state: 'archived' }, 'complete')).ok).toBe(false);
    expect((await upsertCloseoutPackage(client, 'bad', pkg, null)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
