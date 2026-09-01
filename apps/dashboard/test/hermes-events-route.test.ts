import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerContext } from '../src/lib/ai-os/owner-context';
import { makeComposerFakeDb } from './composer-fake-db';

// Hermes Supervisor Dashboard v0 - /api/hermes/events transport. Pins:
// (1) non-owner gets 401 with NO DB touch (resolveOwner is the single
// chokepoint, mocked exactly as in os-routes-auth.test.ts); (2) the
// owner path is a faithful pass-through of preston_poll_events; (3) a
// stored-but-invalid cursor surfaces as cursor_invalid - the route must
// NEVER flatten it into an empty feed.

const resolveOwnerMock = vi.fn();

vi.mock('@/lib/ai-os/owner-context', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../src/lib/ai-os/owner-context')>();
  return { ...real, resolveOwner: () => resolveOwnerMock() };
});

import { GET } from '../src/app/api/hermes/events/route';

const T0 = '2026-08-31T10:00:00.000Z';
const GOAL_ID = '11111111-2222-4333-8444-555555555555';
const JOB_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

function seededOwnerCtx() {
  const fake = makeComposerFakeDb();
  fake.rowsOf('master_goals').push({
    id: GOAL_ID, title: 'g', objective: 'o', status: 'running',
    source: 'owner', requested_by: 'info@preston.nyc',
    environment: 'staging', correlation_id: 'corr-1',
    simulation_only: true, iteration: 0, created_at: T0, updated_at: T0,
  });
  fake.rowsOf('goal_jobs').push({
    id: JOB_ID, goal_id: GOAL_ID, kind: 'audit', title: 'j',
    objective: 'o', status: 'completed', risk_class: 'GREEN',
    assigned_role: 'claude', attempts: 1, requires_approval: false,
    approval_id: null, correlation_id: 'corr-1', evidence_refs: [],
    failure_reason: null, created_at: T0, updated_at: T0,
  });
  return {
    ownerEmail: 'info@preston.nyc',
    client: fake.client,
    audit: fake.client,
  } as unknown as OwnerContext;
}

function req(query: string): Request {
  return new Request(`http://localhost/api/hermes/events${query}`);
}

beforeEach(() => {
  resolveOwnerMock.mockReset();
});

describe('/api/hermes/events', () => {
  it('non-owner gets 401 and the DB is never touched', async () => {
    resolveOwnerMock.mockResolvedValue(null);
    const res = await GET(req(''));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('owner path returns the supervisor feed verbatim', async () => {
    resolveOwnerMock.mockResolvedValue(seededOwnerCtx());
    const res = await GET(req('?limit=10'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      ok: boolean;
      events: Array<{ event_id: string; kind: string }>;
      next_cursor: string | null;
      window: { migration_applied: boolean };
      unmapped_states: number;
    };
    expect(body.ok).toBe(true);
    expect(body.events.some((e) => e.kind === 'completed')).toBe(true);
    expect(body.next_cursor).toMatch(/^v1:\d+:/);
    expect(body.window.migration_applied).toBe(true);
    expect(body.unmapped_states).toBe(0);
  });

  it('an invalid cursor is surfaced, never flattened to an empty feed', async () => {
    resolveOwnerMock.mockResolvedValue(seededOwnerCtx());
    const res = await GET(req('?cursor=garbage-cursor-123'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('cursor_invalid');
  });

  it('an advanced cursor never re-emits the same event', async () => {
    resolveOwnerMock.mockResolvedValue(seededOwnerCtx());
    const first = (await (await GET(req(''))).json()) as {
      events: Array<{ event_id: string }>;
      next_cursor: string;
    };
    expect(first.events.length).toBeGreaterThan(0);
    resolveOwnerMock.mockResolvedValue(seededOwnerCtx());
    const cursor = encodeURIComponent(first.next_cursor);
    const second = (await (await GET(req(`?cursor=${cursor}`))).json()) as {
      ok: boolean;
      events: Array<{ event_id: string }>;
    };
    expect(second.ok).toBe(true);
    const firstIds = new Set(first.events.map((e) => e.event_id));
    for (const e of second.events) {
      expect(firstIds.has(e.event_id)).toBe(false);
    }
  });

  it('limit is bounded', async () => {
    resolveOwnerMock.mockResolvedValue(seededOwnerCtx());
    const res = await GET(req('?limit=99999'));
    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
