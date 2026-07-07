import { getServerSupabase } from './supabase/server';

// Audit trail writer. In setup mode (no Supabase env / no sink) it degrades to
// a no-op that reports logged:false so callers can surface it. The sink is
// injectable so the logger is unit-testable without a live client (same
// dependency-injection pattern as cards.getApprovalsCard).

export interface AuditEntry {
  actor: string;
  action: string;
  action_class?: 'GREEN' | 'YELLOW' | 'RED';
  environment?: 'test_dev' | 'staging' | 'production';
  detail?: Record<string, unknown>;
  rollback_note?: string;
}

export interface AuditInsertResult {
  error: { message: string } | null;
}

// Minimal shape of the audit sink - the subset of the Supabase client this
// module uses. Append-only: insert into audit_log only (never update/delete).
export interface AuditSink {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<AuditInsertResult>;
  };
}

// Pure builder for the audit row, with the fixed defaults. Exposed so the row
// shape can be asserted directly in tests.
export function toAuditRow(entry: AuditEntry): Record<string, unknown> {
  return {
    actor: entry.actor,
    actor_type: 'system',
    action: entry.action,
    action_class: entry.action_class ?? 'GREEN',
    environment: entry.environment ?? 'staging',
    detail: entry.detail ?? null,
    rollback_note: entry.rollback_note ?? null,
  };
}

export async function logAudit(
  entry: AuditEntry,
  opts?: { supabase?: AuditSink | null },
): Promise<{ logged: boolean }> {
  // Explicit sink (incl. null for setup mode) wins; otherwise resolve the
  // server client. Tests always inject, so no live client is ever created.
  const supabase =
    opts?.supabase !== undefined
      ? opts.supabase
      : ((await getServerSupabase()) as unknown as AuditSink | null);

  if (!supabase) return { logged: false };
  const { error } = await supabase.from('audit_log').insert(toAuditRow(entry));
  return { logged: !error };
}
