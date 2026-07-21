import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerContext } from '../src/lib/ai-os/owner-context';

// Phase 5 test-audit F2: route-level tests for the six owner-only OS routes.
// resolveOwner is the single auth chokepoint every route calls first; it is
// mocked here (its own internals need a Next request context), while
// depsFrom stays REAL so the handlers run against the fake client exactly as
// wired. Pins: (1) a non-owner gets 401 from every route with NO DB touch;
// (2) the owner path maps handler results to the documented statuses.

const resolveOwnerMock = vi.fn();

vi.mock('@/lib/ai-os/owner-context', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/ai-os/owner-context')>();
  return { ...real, resolveOwner: () => resolveOwnerMock() };
});

import { POST as commandPost } from '../src/app/api/os/command/route';
import { POST as controlPost } from '../src/app/api/os/control/route';
import { POST as enqueuePost } from '../src/app/api/os/enqueue/route';
import { POST as cancelPost } from '../src/app/api/os/jobs/cancel/route';
import { GET as queueGet } from '../src/app/api/os/queue/route';
import { GET as statusGet } from '../src/app/api/os/status/route';

const OWNER = 'info@preston.nyc';

function req(body: unknown): Request {
  const raw = JSON.stringify(body);
  return { json: async () => JSON.parse(raw) as unknown } as unknown as Request;
}

interface Call {
  table: string;
  op: 'insert' | 'select' | 'update';
}

// Minimal owner-context fake: every query resolves to `result`; every call is
// recorded so the no-DB-touch assertion is real.
function fakeCtx(result: { data: Record<string, unknown>[] | null; error: { message: string } | null }) {
  const calls: Call[] = [];
  const thenable = async () => result;
  const chain = () => {
    type Node = {
      limit: () => Promise<typeof result>;
      eq: () => Node;
      order: () => { limit: () => Promise<typeof result> };
      select: () => Promise<typeof result>;
      lte: () => Node;
      gt: () => Node;
    };
    const node: Node = {
      limit: thenable, eq: () => node, lte: () => node, gt: () => node,
      order: () => ({ limit: thenable }), select: thenable,
    };
    return node;
  };
  const client = {
    from(table: string) {
      return {
        insert() {
          calls.push({ table, op: 'insert' });
          return { select: thenable, then: undefined };
        },
        select() {
          calls.push({ table, op: 'select' });
          return chain();
        },
        update() {
          calls.push({ table, op: 'update' });
          return chain();
        },
      };
    },
  };
  const ctx = { ownerEmail: OWNER, client, audit: client } as unknown as OwnerContext;
  return { ctx, calls };
}

beforeEach(() => {
  process.env['OWNER_EMAIL_ALLOWLIST'] = OWNER;
});

afterEach(() => {
  resolveOwnerMock.mockReset();
  delete process.env['OWNER_EMAIL_ALLOWLIST'];
});

describe('owner OS routes - non-owner is refused with 401 and zero DB access', () => {
  it('refuses all six routes when resolveOwner returns null', async () => {
    resolveOwnerMock.mockResolvedValue(null);
    const results = [
      await commandPost(req({ requested_action: 'read status' })),
      await controlPost(req({ action: 'pause' })),
      await enqueuePost(req({})),
      await cancelPost(req({})),
      await queueGet(),
      await statusGet(),
    ];
    for (const res of results) {
      expect(res.status).toBe(401);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(false);
    }
    expect(resolveOwnerMock).toHaveBeenCalledTimes(6);
  });
});

describe('owner OS routes - owner-path status mapping', () => {
  it('POST /api/os/control rejects an unknown action with 400 before any write', async () => {
    const { ctx, calls } = fakeCtx({ data: [{ id: 'global' }], error: null });
    resolveOwnerMock.mockResolvedValue(ctx);
    const res = await controlPost(req({ action: 'enable-execution' }));
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it('POST /api/os/control applies pause with 200 (audited write path runs)', async () => {
    const { ctx, calls } = fakeCtx({ data: [{ id: 'global' }], error: null });
    resolveOwnerMock.mockResolvedValue(ctx);
    const res = await controlPost(req({ action: 'pause' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(true);
    expect(body.code).toBe('pause');
    expect(calls.some((c) => c.op === 'update' && c.table === 'system_controls')).toBe(true);
  });

  it('GET /api/os/status returns fail-closed defaults when controls are unreadable', async () => {
    const { ctx } = fakeCtx({ data: null, error: { message: 'permission denied' } });
    resolveOwnerMock.mockResolvedValue(ctx);
    const res = await statusGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: { execution_enabled: boolean; hermes_mode: string; remote_runner_enabled: boolean };
    };
    expect(body.status.execution_enabled).toBe(false);
    expect(body.status.hermes_mode).toBe('disabled');
    expect(body.status.remote_runner_enabled).toBe(false);
  });

  it('POST /api/os/command rejects malformed JSON with 400', async () => {
    const { ctx, calls } = fakeCtx({ data: [{ id: 'x' }], error: null });
    resolveOwnerMock.mockResolvedValue(ctx);
    const bad = { json: async () => { throw new Error('bad json'); } } as unknown as Request;
    const res = await commandPost(bad);
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it('POST /api/os/enqueue maps invalid (non-uuid) input to 400 with no write', async () => {
    const { ctx, calls } = fakeCtx({ data: [{ id: 'x' }], error: null });
    resolveOwnerMock.mockResolvedValue(ctx);
    const res = await enqueuePost(req({
      command_id: 'not-a-uuid', approval_id: 'also-not',
      correlation_id: 'corr-abc12345', idempotency_key: 'idem-abc12345',
    }));
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.op !== 'select').length).toBe(0);
  });

  it('POST /api/os/jobs/cancel maps an invalid job id to 400 with no write', async () => {
    const { ctx, calls } = fakeCtx({ data: [{ id: 'x' }], error: null });
    resolveOwnerMock.mockResolvedValue(ctx);
    const res = await cancelPost(req({ job_id: 'nope', correlation_id: 'corr-abc12345' }));
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.op === 'update').length).toBe(0);
  });

  it('GET /api/os/queue returns lists (read-only) for the owner', async () => {
    const { ctx, calls } = fakeCtx({ data: [], error: null });
    resolveOwnerMock.mockResolvedValue(ctx);
    const res = await queueGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(calls.every((c) => c.op === 'select')).toBe(true);
  });
});
