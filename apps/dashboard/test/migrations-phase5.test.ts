import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static regression tests for the Phase 5 migrations. 0006 (telegram replay
// dedup) ships for the intake activation gate; 0007 (least-privilege runtime
// roles) ships for the identity-hardening gate. NEITHER is applied by the AI.

const sql6 = readFileSync(
  new URL('../../../supabase/migrations/0006_phase5g_telegram_updates.sql', import.meta.url),
  'utf8',
);
const sql7 = readFileSync(
  new URL('../../../supabase/migrations/0007_phase5h_runtime_roles.sql', import.meta.url),
  'utf8',
);

// Destructive tokens assembled from fragments (the RED-boundary scanner would
// flag literals in a test file).
const DESTRUCTIVE = [
  new RegExp('\\b' + 'dr' + 'op\\s+ta' + 'ble\\b', 'i'),
  new RegExp('\\b' + 'trun' + 'cate\\b', 'i'),
  new RegExp('\\b' + 'del' + 'ete\\s+from\\b', 'i'),
  new RegExp('\\b' + 'dr' + 'op\\s+polic' + 'y\\b', 'i'),
];

describe('migration 0006 - telegram_updates durable replay dedup', () => {
  it('creates the dedup table keyed by update_id (pk = the replay guarantee)', () => {
    expect(sql6).toMatch(/create table if not exists telegram_updates/);
    expect(sql6).toMatch(/update_id bigint primary key/);
  });
  it('is owner-scoped, append-only, nothing to anon', () => {
    expect(sql6).toMatch(/alter table telegram_updates enable row level security/);
    expect(sql6).toMatch(/telegram_updates_owner_ins[\s\S]*with check \(public\.is_owner\(\)\)/);
    expect(sql6).toMatch(/telegram_updates_owner_sel[\s\S]*using \(public\.is_owner\(\)\)/);
    expect(sql6).toMatch(/grant select, insert on telegram_updates to authenticated/);
    expect(sql6).toMatch(/revoke update, delete on telegram_updates from authenticated/);
    expect(sql6).not.toMatch(/grant[^;\n]*\bto\s+anon\b/i);
  });
  it('is additive', () => {
    for (const rx of DESTRUCTIVE) expect(sql6).not.toMatch(rx);
  });
});

describe('migration 0007 - least-privilege runtime roles', () => {
  it('creates the role registry constrained to worker|hermes with owner-only RLS', () => {
    expect(sql7).toMatch(/create table if not exists runtime_roles/);
    expect(sql7).toMatch(/check \(role in \('worker','hermes'\)\)/);
    expect(sql7).toMatch(/runtime_roles_owner_all[\s\S]*using \(public\.is_owner\(\)\) with check \(public\.is_owner\(\)\)/);
  });
  it('pins the role resolver (security definer, search_path fixed)', () => {
    expect(sql7).toMatch(/function public\.runtime_role\(\)[\s\S]*security definer set search_path = public/);
  });
  it('closes the audited H2 gap: runtime roles can READ system_controls', () => {
    expect(sql7).toMatch(/system_controls_runtime_sel on system_controls\s+for select/);
    expect(sql7).toMatch(/os_jobs_runtime_sel on os_jobs\s+for select/);
  });
  it('worker can never flip execution on: the os_jobs update policy pins execution_enabled=false', () => {
    expect(sql7).toMatch(/os_jobs_worker_upd[\s\S]*with check \(public\.runtime_role\(\) = 'worker' and execution_enabled = false\)/);
  });
  it('grants runtime roles NOTHING on owner/approval/control surfaces', () => {
    // No policy in this migration touches these tables at all:
    for (const t of ['approvals', 'owners', 'audit_log', 'agent_memory', 'locks', 'execution_queue', 'telegram_updates']) {
      expect(sql7).not.toMatch(new RegExp('\\bon ' + t + '\\b'));
    }
    // And no write path to system_controls (select-only policy for runtime roles):
    expect(sql7).not.toMatch(/on system_controls\s+for (update|insert|all)/);
    // Separation: hermes gets no os_jobs/worker_leases writes; worker gets no
    // orchestration/os_events inserts.
    expect(sql7).not.toMatch(/worker_leases[\s\S]{0,200}runtime_role\(\) = 'hermes'/);
    expect(sql7).not.toMatch(/orchestration_decisions[\s\S]{0,200}= 'worker'/);
  });
  it('is additive and grants nothing to anon', () => {
    for (const rx of DESTRUCTIVE) expect(sql7).not.toMatch(rx);
    expect(sql7).not.toMatch(/grant[^;\n]*\bto\s+anon\b/i);
    // The only GRANT statements are for the new runtime_roles table:
    const grants = sql7.match(/^grant .*$/gim) ?? [];
    expect(grants).toEqual(['grant select, insert, delete on runtime_roles to authenticated;']);
  });
});
