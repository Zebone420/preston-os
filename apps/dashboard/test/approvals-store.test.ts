import { describe, expect, it } from 'vitest';
import {
  decideApprovalRow,
  interpretApprovalsError,
  listApprovalRows,
  type ControlPlaneClient,
  type StoreResult,
} from '../src/lib/approvals-store';

const NOW = '2026-07-08T12:00:00.000Z';
const ID = '11111111-2222-3333-4444-555555555555';

interface FakeCalls {
  updates: {
    patch: Record<string, unknown>;
    eqs: [string, string][];
  }[];
  audits: Record<string, unknown>[];
  selects: number;
}

// Fake control-plane client capturing every call. Fail-open behaviors are
// impossible to fake accidentally: each result is provided explicitly.
function fakeClient(opts: {
  selectResult?: StoreResult;
  updateResult?: StoreResult;
  auditError?: { message: string } | null;
}): { client: ControlPlaneClient; calls: FakeCalls } {
  const calls: FakeCalls = { updates: [], audits: [], selects: 0 };
  const client = {
    from(table: string) {
      if (table === 'audit_log') {
        return {
          insert: async (row: Record<string, unknown>) => {
            calls.audits.push(row);
            return { error: opts.auditError ?? null };
          },
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: async () => {
              calls.selects++;
              return opts.selectResult ?? { data: [], error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const eqs: [string, string][] = [];
          const entry = { patch, eqs };
          calls.updates.push(entry);
          return {
            eq: (c1: string, v1: string) => {
              eqs.push([c1, v1]);
              return {
                eq: (c2: string, v2: string) => {
                  eqs.push([c2, v2]);
                  return {
                    select: async () =>
                      opts.updateResult ?? { data: [], error: null },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as ControlPlaneClient;
  return { client, calls };
}

describe('listApprovalRows', () => {
  it('maps rows and tolerates nulls', async () => {
    const { client } = fakeClient({
      selectResult: {
        data: [
          {
            id: ID,
            task_id: null,
            requested_action: 'draft lead reply',
            action_class: 'GREEN',
            decision: 'pending',
            decision_at: null,
            notes: null,
            created_at: NOW,
          },
        ],
        error: null,
      },
    });
    const out = await listApprovalRows(client);
    expect(out.error).toBeUndefined();
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      id: ID,
      task_id: null,
      requested_action: 'draft lead reply',
      decision: 'pending',
    });
  });

  it('returns an error note (not a throw) on read failure', async () => {
    const { client } = fakeClient({
      selectResult: { data: null, error: { message: 'rls denied' } },
    });
    const out = await listApprovalRows(client);
    expect(out.rows).toEqual([]);
    expect(out.error).toContain('rls denied');
  });
});

describe('decideApprovalRow - fail-closed validation (no I/O attempted)', () => {
  it('rejects an unknown decision value before any write', async () => {
    const { client, calls } = fakeClient({});
    const out = await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'executed' as never,
      now: NOW,
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('invalid_decision');
    expect(calls.updates).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
  });

  it('rejects a non-uuid approval id before any write', async () => {
    const { client, calls } = fakeClient({});
    for (const bad of ['', '   ', 'malicious-non-uuid-input', '1234', ID + 'x']) {
      const out = await decideApprovalRow(client, {
        approvalId: bad,
        decision: 'approved',
        now: NOW,
      });
      expect(out.ok).toBe(false);
      expect(out.code).toBe('invalid_id');
    }
    expect(calls.updates).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
  });
});

describe('decideApprovalRow - conditional write', () => {
  it('records an approval only against a still-pending row', async () => {
    const { client, calls } = fakeClient({
      updateResult: { data: [{ id: ID }], error: null },
    });
    const out = await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'approved',
      now: NOW,
      reason: 'looks right',
    });
    expect(out.ok).toBe(true);
    expect(out.code).toBe('decided');
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toMatchObject({
      decision: 'approved',
      decision_at: NOW,
      explicit_confirmation: false, // one click is never explicit confirmation
      notes: 'looks right',
    });
    // The update is guarded on id AND decision='pending' (race-safe no-op).
    expect(calls.updates[0].eqs).toEqual([
      ['id', ID],
      ['decision', 'pending'],
    ]);
  });

  it('reports not_pending when the conditional update matches no row', async () => {
    const { client, calls } = fakeClient({
      updateResult: { data: [], error: null },
    });
    const out = await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'rejected',
      now: NOW,
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('not_pending');
    expect(calls.audits).toHaveLength(0); // nothing changed -> nothing audited
  });

  it('reports write_failed on a database error', async () => {
    const { client, calls } = fakeClient({
      updateResult: { data: null, error: { message: 'permission denied' } },
    });
    const out = await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'approved',
      now: NOW,
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('write_failed');
    expect(out.message).toContain('permission denied');
    expect(calls.audits).toHaveLength(0);
  });
});

describe('decideApprovalRow - audit trail', () => {
  it('writes one audit row per decision with safe fixed fields', async () => {
    const { client, calls } = fakeClient({
      updateResult: { data: [{ id: ID }], error: null },
    });
    await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'rejected',
      now: NOW,
    });
    expect(calls.audits).toHaveLength(1);
    expect(calls.audits[0]).toMatchObject({
      actor: 'owner',
      actor_type: 'human',
      action: 'approval_decision:rejected',
      action_class: 'GREEN',
      environment: 'staging',
      production_touched: false,
      write_actions_performed: false,
      secrets_exposed: false,
    });
  });

  it('surfaces audit_failed loudly when the audit insert fails', async () => {
    const { client } = fakeClient({
      updateResult: { data: [{ id: ID }], error: null },
      auditError: { message: 'insert blocked' },
    });
    const out = await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'approved',
      now: NOW,
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('audit_failed');
    expect(out.message).toContain('insert blocked');
  });

  it('truncates an oversized reason to 500 chars in the notes patch', async () => {
    const { client, calls } = fakeClient({
      updateResult: { data: [{ id: ID }], error: null },
    });
    await decideApprovalRow(client, {
      approvalId: ID,
      decision: 'approved',
      now: NOW,
      reason: 'x'.repeat(2000),
    });
    expect(String(calls.updates[0].patch['notes'])).toHaveLength(500);
  });
});

describe('interpretApprovalsError', () => {
  it('returns undefined for no error', () => {
    expect(interpretApprovalsError(undefined)).toBeUndefined();
    expect(interpretApprovalsError('')).toBeUndefined();
  });

  it('flags permission denied as a missing GRANT (Branch B)', () => {
    const hint = interpretApprovalsError(
      'approvals read failed: permission denied for table approvals',
    );
    expect(hint).toContain('GRANT');
    expect(hint).toContain('Branch B');
  });

  it('flags RLS violations as owner-row/policy (Branch A/C)', () => {
    const hint = interpretApprovalsError(
      'new row violates row-level security policy for table "approvals"',
    );
    expect(hint).toContain('RLS');
    expect(hint).toContain('Branch A/C');
  });

  it('flags missing relation/function as incomplete migrations', () => {
    expect(
      interpretApprovalsError('relation "approvals" does not exist'),
    ).toContain('migrations');
    expect(
      interpretApprovalsError('function public.is_owner() does not exist'),
    ).toContain('migrations');
  });

  it('returns undefined for an unrecognized error (no false hint)', () => {
    expect(
      interpretApprovalsError('approvals read failed: network timeout'),
    ).toBeUndefined();
  });

  it('never echoes secret-shaped input back in the hint', () => {
    const hint = interpretApprovalsError(
      'permission denied for table approvals; token=SECRET123',
    );
    // Hint is fixed guidance text; it must not contain the raw input.
    expect(hint).not.toContain('SECRET123');
  });
});
