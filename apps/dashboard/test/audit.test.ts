import { describe, expect, it } from 'vitest';
import { logAudit, toAuditRow, type AuditSink } from '../src/lib/audit';

// A capturing mock sink - proves no live client is needed and lets us assert
// the exact row and table written.
function mockSink(error: { message: string } | null = null) {
  const calls: { table: string; row: Record<string, unknown> }[] = [];
  const sink: AuditSink = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          return Promise.resolve({ error });
        },
      };
    },
  };
  return { sink, calls };
}

describe('audit.toAuditRow (defaults + passthrough)', () => {
  it('applies fixed defaults (system actor_type, GREEN, staging, null detail/rollback)', () => {
    const row = toAuditRow({ actor: 'claude', action: 'read cards' });
    expect(row).toEqual({
      actor: 'claude',
      actor_type: 'system',
      action: 'read cards',
      action_class: 'GREEN',
      environment: 'staging',
      detail: null,
      rollback_note: null,
    });
  });

  it('preserves provided class/environment/detail/rollback', () => {
    const row = toAuditRow({
      actor: 'owner',
      action: 'approve draft',
      action_class: 'YELLOW',
      environment: 'test_dev',
      detail: { task_id: 't1' },
      rollback_note: 'revert approval t1',
    });
    expect(row.action_class).toBe('YELLOW');
    expect(row.environment).toBe('test_dev');
    expect(row.detail).toEqual({ task_id: 't1' });
    expect(row.rollback_note).toBe('revert approval t1');
  });
});

describe('audit.logAudit (fail-safe, injectable sink)', () => {
  it('setup mode (supabase: null) is a no-op reporting logged:false', async () => {
    const res = await logAudit({ actor: 'claude', action: 'x' }, { supabase: null });
    expect(res).toEqual({ logged: false });
  });

  it('writes an append-only row to audit_log and reports logged:true', async () => {
    const { sink, calls } = mockSink(null);
    const res = await logAudit(
      { actor: 'claude', action: 'read cards' },
      { supabase: sink },
    );
    expect(res).toEqual({ logged: true });
    expect(calls.length).toBe(1);
    expect(calls[0].table).toBe('audit_log');
    expect(calls[0].row.actor).toBe('claude');
    expect(calls[0].row.action_class).toBe('GREEN');
    expect(calls[0].row.environment).toBe('staging');
  });

  it('reports logged:false when the insert returns an error', async () => {
    const { sink } = mockSink({ message: 'rls denied' });
    const res = await logAudit({ actor: 'claude', action: 'x' }, { supabase: sink });
    expect(res).toEqual({ logged: false });
  });

  it('never performs any operation other than an audit_log insert', async () => {
    const { sink, calls } = mockSink(null);
    await logAudit({ actor: 'claude', action: 'x' }, { supabase: sink });
    // only one call, to audit_log, via insert (append-only)
    expect(calls.every((c) => c.table === 'audit_log')).toBe(true);
    expect(calls.length).toBe(1);
  });
});
