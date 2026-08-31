// ChatGPT Supervisor Bridge slice 1 - preston_poll_events + submit-rejection
// recording (docs/PRESTON_CHATGPT_SUPERVISOR_BRIDGE_DESIGN_v1.md). Pins:
// event/state normalization onto the fixed vocabulary, deterministic ids,
// cursor dedupe/idempotency (a repeated cursor returns the identical page;
// an advanced cursor never re-emits), submit-time rejections distinct from
// runtime failures (goal_id null), approval_required visibility WITHOUT any
// decision, terminal visibility, fail-closed unknown states, and ZERO write
// authority on the poll path.

import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  normalizeSupervisorEvents,
  pageAfterCursor,
  sortEvents,
  type SupervisorEvent,
} from '../src/lib/preston-control/supervisor-events';
import {
  prestonPollEvents,
  prestonSubmitGoal,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import { TOOL_NAMES } from '../src/lib/preston-control/server';
import { buildOpenApiDocument } from '../src/lib/preston-control/openapi';
import { makeComposerFakeDb } from './composer-fake-db';

const NOW = '2026-08-28T23:00:00.000Z';
const T0 = '2026-08-28T22:00:00.000Z';
const T1 = '2026-08-28T22:10:00.000Z';
const T2 = '2026-08-28T22:20:00.000Z';

function job(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'job-sup-0001', goal_id: 'goal-sup-0001', kind: 'code',
    title: 't', objective: 'o', risk_class: 'GREEN', assigned_role: 'claude',
    status: 'pending', attempts: 0, requires_approval: false,
    approval_id: null, correlation_id: 'corr-sup', evidence_refs: [],
    failure_reason: null, updated_at: T1, created_at: T0, ...over,
  };
}

const CONTROLS = { readable: true, paused: false, owner_stop: false, updated_at: T0 };

function normalize(over: {
  jobs?: Record<string, unknown>[]; goals?: Record<string, unknown>[];
  controls?: typeof CONTROLS; rejections?: Record<string, unknown>[];
}) {
  return normalizeSupervisorEvents({
    goals: over.goals ?? [], jobs: over.jobs ?? [],
    controls: over.controls ?? CONTROLS, rejections: over.rejections ?? [],
  });
}

describe('normalization onto the fixed vocabulary', () => {
  it('maps every job status to its event kind with full provenance', () => {
    const cases: Array<[Record<string, unknown>, string, string | null]> = [
      [job({ status: 'pending' }), 'queued', null],
      [job({ status: 'ready' }), 'queued', null],
      [job({ status: 'in_progress' }), 'running', null],
      [job({ status: 'awaiting_approval', approval_id: 'apr-1', requires_approval: true }), 'approval_required', null],
      [job({ status: 'completed' }), 'completed', 'running'],
      [job({ status: 'cancelled' }), 'stopped', null],
      [job({ status: 'failed', failure_reason: 'exit_1' }), 'failed', 'running'],
      [job({ status: 'failed', failure_reason: 'retryable:real_required:timeout' }), 'timed_out', 'running'],
      [job({ status: 'dead_lettered', failure_reason: 'terminal:real_required:kind_not_eligible' }), 'kind_not_eligible', null],
      [job({ status: 'dead_lettered', failure_reason: 'timeout' }), 'timed_out', null],
      [job({ status: 'dead_lettered', failure_reason: 'retry_exhausted' }), 'dead_lettered', null],
    ];
    for (const [row, kind, prior] of cases) {
      const { events, unmapped_states } = normalize({ jobs: [row] });
      expect(unmapped_states).toBe(0);
      expect(events).toHaveLength(1);
      const e = events[0];
      expect(e.kind).toBe(kind);
      expect(e.prior_state).toBe(prior);
      expect(e.goal_id).toBe('goal-sup-0001');
      expect(e.job_id).toBe('job-sup-0001');
      expect(e.job_kind).toBe('code');
      expect(e.provider_role).toBe('claude');
      expect(e.risk_class).toBe('GREEN');
      expect(e.occurred_at).toBe(T1);
      expect(e.new_state).toBe(String(row.status));
    }
  });

  it('approval_required carries the approval id and never a decision', () => {
    const { events } = normalize({
      jobs: [job({ status: 'awaiting_approval', approval_id: 'apr-sup-1', requires_approval: true })],
    });
    expect(events[0].kind).toBe('approval_required');
    expect(events[0].approval_id).toBe('apr-sup-1');
    expect(events[0].requires_approval).toBe(true);
  });

  it('goal blocked + controls paused/stopped map to their kinds', () => {
    const { events } = normalize({
      goals: [{ id: 'goal-b', status: 'blocked', updated_at: T2, correlation_id: 'c' }],
      controls: { readable: true, paused: true, owner_stop: true, updated_at: T0 },
    });
    expect(events.map((e) => e.kind).sort()).toEqual(['blocked', 'paused', 'stopped']);
  });

  it('unknown job status fails CLOSED: no invented event, counted', () => {
    const { events, unmapped_states } = normalize({ jobs: [job({ status: 'zorbled' })] });
    expect(events).toHaveLength(0);
    expect(unmapped_states).toBe(1);
  });

  it('submit rejection maps to task_kind_unresolved with NO goal id (never entered runtime)', () => {
    const { events } = normalize({
      rejections: [{
        type: 'GoalSubmitRejected',
        created_at: T2,
        payload: {
          request_id: 'pc-rej-0001', rejected_at: T2,
          errors: ['ambiguous_request:task_kind_unresolved'],
        },
      }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('task_kind_unresolved');
    expect(events[0].goal_id).toBeNull();
    expect(events[0].job_id).toBeNull();
    expect(events[0].failure_reason).toContain('task_kind_unresolved');
    // Other rejection codes surface as submit_rejected with the codes.
    const other = normalize({
      rejections: [{
        type: 'GoalSubmitRejected', created_at: T2,
        payload: { request_id: 'pc-rej-0002', rejected_at: T2, errors: ['secret_in_request'] },
      }],
    });
    expect(other.events[0].kind).toBe('submit_rejected');
    expect(other.events[0].failure_reason).toBe('secret_in_request');
  });
});

describe('deterministic ids, cursor dedupe, idempotency', () => {
  const threeEvents = (): SupervisorEvent[] => normalize({
    jobs: [
      job({ id: 'j1', status: 'completed', updated_at: T0 }),
      job({ id: 'j2', status: 'in_progress', updated_at: T1 }),
      job({ id: 'j3', status: 'pending', updated_at: T2 }),
    ],
  }).events;

  it('the same snapshot normalizes to IDENTICAL event ids (repeat-read dedupe)', () => {
    expect(threeEvents()).toEqual(threeEvents());
  });

  it('a retry re-entering the same status later is a NEW event (new timestamp)', () => {
    const a = normalize({ jobs: [job({ status: 'failed', failure_reason: 'exit_1', updated_at: T0 })] }).events[0];
    const b = normalize({ jobs: [job({ status: 'failed', failure_reason: 'exit_1', updated_at: T2 })] }).events[0];
    expect(a.event_id).not.toBe(b.event_id);
  });

  it('repeated cursor returns the identical page; advanced cursor never re-emits', () => {
    const events = sortEvents(threeEvents());
    const first = pageAfterCursor(events, null, 2);
    const firstAgain = pageAfterCursor(events, null, 2);
    expect(first).toEqual(firstAgain); // idempotent
    const second = pageAfterCursor(events, decodeCursor(first.next_cursor), 10);
    const firstIds = new Set(first.page.map((e) => e.event_id));
    expect(second.page.some((e) => firstIds.has(e.event_id))).toBe(false); // no dupes
    expect(first.page.length + second.page.length).toBe(events.length);
    // Past the end: empty page, no cursor churn.
    const third = pageAfterCursor(events, decodeCursor(second.next_cursor), 10);
    expect(third.page).toHaveLength(0);
    expect(third.next_cursor).toBeNull();
  });

  it('cursor round-trips and an invalid cursor decodes as an explicit failure', () => {
    const e = threeEvents()[0];
    const d = decodeCursor(encodeCursor(e));
    expect(d && d.ok).toBe(true);
    expect(decodeCursor('nonsense')).toEqual({ ok: false });
    expect(decodeCursor('v1:abc:def')).toEqual({ ok: false });
    expect(decodeCursor(undefined)).toBeNull(); // absent = start of window
  });
});

// --- end-to-end through the tool layer (fake DB) ----------------------------

const ctxFor = (client: ToolContext['client']): ToolContext => ({
  client, ownerEmail: 'info@preston.nyc', now: NOW,
});

// Write-counting wrapper: proves the poll path performs ZERO writes.
function countingClient(inner: ToolContext['client']) {
  const writes = { inserts: 0, updates: 0, rpcs: 0 };
  const client = {
    from(table: string) {
      const t = (inner as { from: (t: string) => Record<string, unknown> }).from(table);
      return {
        ...t,
        insert(...a: unknown[]) { writes.inserts++; return (t.insert as (...x: unknown[]) => unknown)(...a); },
        update(...a: unknown[]) { writes.updates++; return (t.update as (...x: unknown[]) => unknown)(...a); },
      };
    },
    rpc(...a: unknown[]) {
      writes.rpcs++;
      return (inner as unknown as { rpc: (...x: unknown[]) => unknown }).rpc(...a);
    },
  } as unknown as ToolContext['client'];
  return { client, writes };
}

describe('preston_poll_events end-to-end (fake DB)', () => {
  it('accepted goal -> queued; then running; then completed - each visible once', async () => {
    const db = makeComposerFakeDb();
    const ctx = ctxFor(db.client);
    const sub = await prestonSubmitGoal(ctx, {
      request: 'Audit the repository.', request_id: 'pc-sup-e2e-0001',
    });
    expect(sub.status).toBe('accepted');

    // queued
    const p1 = await prestonPollEvents(ctx, {});
    if (!p1.ok) throw new Error('poll failed');
    const queued = p1.events.filter((e) => e.kind === 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].goal_id).toBe(sub.goals?.[0]?.goal_id);

    // consume the page, then transition the row: running becomes visible as
    // a NEW event past the cursor; queued is never re-emitted.
    const jobRow = db.rowsOf('goal_jobs')[0];
    Object.assign(jobRow, { status: 'in_progress', updated_at: '2026-08-28T23:05:00.000Z' });
    const p2 = await prestonPollEvents(ctx, { cursor: p1.next_cursor ?? undefined });
    if (!p2.ok) throw new Error('poll failed');
    expect(p2.events.map((e) => e.kind)).toEqual(['running']);

    Object.assign(jobRow, { status: 'completed', updated_at: '2026-08-28T23:06:00.000Z' });
    const p3 = await prestonPollEvents(ctx, { cursor: p2.next_cursor ?? undefined });
    if (!p3.ok) throw new Error('poll failed');
    expect(p3.events.map((e) => e.kind)).toEqual(['completed']);
    expect(p3.events[0].prior_state).toBe('running');

    // Dedupe across repeated reads: same cursor, identical page.
    const p3again = await prestonPollEvents(ctx, { cursor: p2.next_cursor ?? undefined });
    expect(p3again).toEqual(p3);
  });

  it('failed/dead_lettered visibility incl. kind_not_eligible mapping', async () => {
    const db = makeComposerFakeDb();
    const ctx = ctxFor(db.client);
    await prestonSubmitGoal(ctx, { request: 'Audit the repository.', request_id: 'pc-sup-e2e-0002' });
    const jobRow = db.rowsOf('goal_jobs')[0];
    Object.assign(jobRow, {
      status: 'dead_lettered',
      failure_reason: 'terminal:real_required:kind_not_eligible',
      updated_at: '2026-08-28T23:07:00.000Z',
    });
    const p = await prestonPollEvents(ctx, {});
    if (!p.ok) throw new Error('poll failed');
    const kinds = p.events.map((e) => e.kind);
    expect(kinds).toContain('kind_not_eligible');
    expect(kinds).not.toContain('dead_lettered'); // the finer kind wins
  });

  it('submit-time rejection is durably recorded, idempotent, and visible as never-entered-runtime', async () => {
    const db = makeComposerFakeDb();
    const ctx = ctxFor(db.client);
    const r1 = await prestonSubmitGoal(ctx, { request: 'Zorble the frobnicator.', request_id: 'pc-sup-rej-0001' });
    expect(r1.status).toBe('rejected');
    // Replay the same request id: still exactly ONE durable record.
    await prestonSubmitGoal(ctx, { request: 'Zorble the frobnicator.', request_id: 'pc-sup-rej-0001' });
    const evRows = db.rowsOf('os_events').filter((r) => String(r.type) === 'GoalSubmitRejected');
    expect(evRows).toHaveLength(1);
    // The record carries codes + request id only - never the request text.
    expect(JSON.stringify(evRows[0])).not.toContain('Zorble');

    const p = await prestonPollEvents(ctx, {});
    if (!p.ok) throw new Error('poll failed');
    const rej = p.events.filter((e) => e.kind === 'task_kind_unresolved');
    expect(rej).toHaveLength(1);
    expect(rej[0].goal_id).toBeNull(); // submit-time, not a runtime failure
    expect(p.window.rejections_readable).toBe(true);
  });

  it('approval_required is visible WITHOUT any decision being made', async () => {
    const db = makeComposerFakeDb();
    const ctx = ctxFor(db.client);
    const sub = await prestonSubmitGoal(ctx, {
      request: 'Fix the deploy script for the dashboard.', request_id: 'pc-sup-apr-0001',
    });
    expect(sub.status).toBe('accepted');
    // The composed gated job parks; emulate the parked status the driver sets.
    const jobRow = db.rowsOf('goal_jobs')[0];
    expect(jobRow.requires_approval).toBe(true);
    Object.assign(jobRow, { status: 'awaiting_approval', updated_at: '2026-08-28T23:08:00.000Z' });
    const approvalsBefore = JSON.stringify(db.rowsOf('orchestration_approvals'));
    const p = await prestonPollEvents(ctx, {});
    if (!p.ok) throw new Error('poll failed');
    const apr = p.events.filter((e) => e.kind === 'approval_required');
    expect(apr).toHaveLength(1);
    expect(apr[0].approval_id).toBeTruthy();
    // No bypass: polling changed NOTHING about the approval rows.
    expect(JSON.stringify(db.rowsOf('orchestration_approvals'))).toBe(approvalsBefore);
  });

  it('the poll path performs ZERO writes (no authority escalation)', async () => {
    const db = makeComposerFakeDb();
    await prestonSubmitGoal(ctxFor(db.client), { request: 'Audit the repository.', request_id: 'pc-sup-w-0001' });
    const counted = countingClient(db.client);
    const p = await prestonPollEvents(ctxFor(counted.client), {});
    expect(p.ok).toBe(true);
    expect(counted.writes).toEqual({ inserts: 0, updates: 0, rpcs: 0 });
  });

  it('an invalid cursor is an explicit error, never a silent reset', async () => {
    const db = makeComposerFakeDb();
    const p = await prestonPollEvents(ctxFor(db.client), { cursor: 'garbage' });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toBe('cursor_invalid');
  });
});

describe('SB-1 regression: same-millisecond lifecycle transitions stay visible', () => {
  // Live staging drill 2026-08-31: the oneshot worker stamps lease AND
  // completion with one cycle timestamp, so running and completed share the
  // exact updated_at. A cursor advanced past the running event must still
  // see the terminal event.
  const TS = '2026-08-31T20:30:37.505Z';

  it('a cursor at the running event still yields the same-ms completed event', () => {
    const running = normalize({ jobs: [job({ status: 'in_progress', updated_at: TS })] });
    expect(running.events).toHaveLength(1);
    const cursor = encodeCursor(running.events[0]);

    // The job completes within the same worker cycle: same updated_at.
    const done = normalize({ jobs: [job({ status: 'completed', updated_at: TS })] });
    const page = pageAfterCursor(done.events, decodeCursor(cursor), 50);
    expect(page.page.map((e) => e.kind)).toEqual(['completed']);
    expect(page.page[0].event_id.endsWith(`:completed:${Date.parse(TS)}`)).toBe(true);
  });

  it('same-ms events sort by lifecycle progression, not lexicographically', () => {
    const pending = normalize({ jobs: [job({ status: 'pending', updated_at: TS })] }).events[0];
    const runningE = normalize({ jobs: [job({ status: 'in_progress', updated_at: TS })] }).events[0];
    const doneE = normalize({ jobs: [job({ status: 'completed', updated_at: TS })] }).events[0];
    const sorted = sortEvents([doneE, pending, runningE]);
    expect(sorted.map((e) => e.kind)).toEqual(['queued', 'running', 'completed']);
  });

  it('an advanced cursor never re-emits an earlier same-ms lifecycle state', () => {
    const doneE = normalize({ jobs: [job({ status: 'completed', updated_at: TS })] }).events[0];
    const cursor = decodeCursor(encodeCursor(doneE));
    const runningE = normalize({ jobs: [job({ status: 'in_progress', updated_at: TS })] }).events[0];
    const page = pageAfterCursor([runningE], cursor, 50);
    expect(page.page).toHaveLength(0);
  });

  it('repeating the same cursor still returns an identical page', () => {
    const events = [
      normalize({ jobs: [job({ status: 'completed', updated_at: TS })] }).events[0],
      normalize({ jobs: [job({ id: 'job-sup-0002', status: 'in_progress', updated_at: TS })] }).events[0],
    ];
    const sorted = sortEvents(events);
    const cursor = decodeCursor(`v1:${Date.parse(TS) - 1}:sup:job:job-sup-0000:completed:${Date.parse(TS) - 1}`);
    const a = pageAfterCursor(sorted, cursor, 50);
    const b = pageAfterCursor(sorted, cursor, 50);
    expect(a.page.map((e) => e.event_id)).toEqual(b.page.map((e) => e.event_id));
    expect(a.next_cursor).toBe(b.next_cursor);
  });
});

describe('surface registration (deliberate 11th operation)', () => {
  it('preston_poll_events is registered on the MCP catalogue (11 tools)', () => {
    expect(TOOL_NAMES).toContain('preston_poll_events');
    expect(TOOL_NAMES).toHaveLength(11);
  });

  it('pollPrestonEvents is the 11th REST operation and is read-only', () => {
    const doc = buildOpenApiDocument('https://example.test') as {
      paths: Record<string, Record<string, { operationId: string; 'x-openai-isConsequential': boolean }>>;
    };
    const ops = Object.values(doc.paths).flatMap((m) => Object.values(m));
    expect(ops).toHaveLength(11);
    const poll = ops.find((o) => o.operationId === 'pollPrestonEvents');
    expect(poll).toBeTruthy();
    expect(poll?.['x-openai-isConsequential']).toBe(false);
  });
});
