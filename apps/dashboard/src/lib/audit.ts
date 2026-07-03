import { getServerSupabase } from './supabase/server';

// Audit trail writer. In setup mode (no Supabase env) it degrades to
// a no-op that reports logged:false so callers can surface it.

export interface AuditEntry {
  actor: string;
  action: string;
  action_class?: 'GREEN' | 'YELLOW' | 'RED';
  environment?: 'test_dev' | 'staging' | 'production';
  detail?: Record<string, unknown>;
  rollback_note?: string;
}

export async function logAudit(
  entry: AuditEntry,
): Promise<{ logged: boolean }> {
  const supabase = await getServerSupabase();
  if (!supabase) return { logged: false };
  const { error } = await supabase.from('audit_log').insert({
    actor: entry.actor,
    actor_type: 'system',
    action: entry.action,
    action_class: entry.action_class ?? 'GREEN',
    environment: entry.environment ?? 'staging',
    detail: entry.detail ?? null,
    rollback_note: entry.rollback_note ?? null,
  });
  return { logged: !error };
}
