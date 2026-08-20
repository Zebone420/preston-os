// 0020 - dedicated NON-owner runtime service identity.
// Replaces the seeded human-owner runtime session (least-privilege fix,
// R-2 root cause). Static file-level contract pins; live behaviour is
// verified by the owner after applying to staging then prod.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = readFileSync(join(MIG, '0020_runtime_service_identity.sql'), 'utf8');

describe('migration 0020 - runtime service identity', () => {
  it('creates the runtime_services allowlist + is_runtime_service() helper', () => {
    expect(sql).toMatch(/create table if not exists public\.runtime_services/);
    expect(sql).toMatch(/function public\.is_runtime_service\(\)/);
    expect(sql).toContain('select 1 from public.runtime_services s where s.user_id = auth.uid()');
  });

  it('is_runtime_service is SECURITY DEFINER with pinned search_path', () => {
    const fn = sql.slice(sql.indexOf('function public.is_runtime_service'));
    expect(fn).toContain('security definer');
    expect(fn).toContain('set search_path = public');
  });

  it('runtime_services membership is owner-read-only, anon revoked', () => {
    expect(sql).toMatch(/create policy runtime_services_select_owner[\s\S]*?using \(public\.is_owner\(\)\)/);
    expect(sql).toContain('revoke all on public.runtime_services from anon');
  });

  // CRITICAL least-privilege boundary: the decide RPC must NOT be widened.
  // (The migration may MENTION it in comments; it must never redefine it or
  // grant/execute it for the runtime service.)
  it('does NOT redefine or grant the decide path', () => {
    expect(sql).not.toMatch(/function public\.decide_orchestration_approval/);
    expect(sql).not.toMatch(/grant[\s\S]{0,120}decide_orchestration_approval/i);
    expect(sql).not.toMatch(/is_runtime_service[\s\S]{0,120}decide_orchestration_approval/i);
  });

  // CRITICAL: runtime must NOT be able to write system_controls.
  it('gives the runtime SELECT-only on system_controls (no write path)', () => {
    expect(sql).toMatch(/create policy system_controls_runtime_sel on system_controls\s+for select/);
    // no is_runtime_service in any for-all/with-check on system_controls
    const scBlock = sql.slice(sql.indexOf('system_controls_runtime_sel'));
    expect(scBlock).not.toMatch(/system_controls[\s\S]*for all[\s\S]*is_runtime_service/);
  });

  // orchestration_approvals: propose-only, still born pending/undecided.
  it('lets the runtime INSERT only pending/undecided approvals', () => {
    const ins = sql.slice(sql.indexOf('orch_approvals_owner_ins'));
    expect(ins).toMatch(/is_owner\(\) or public\.is_runtime_service\(\)/);
    expect(ins).toContain("status = 'pending'");
    expect(ins).toContain('nonce is null');
    expect(ins).toContain('decided_at is null');
  });

  it('does NOT add any UPDATE policy/grant on orchestration_approvals', () => {
    expect(sql).not.toMatch(/orchestration_approvals[\s\S]*for update/i);
    expect(sql).not.toMatch(/grant update on orchestration_approvals/i);
  });

  it('widens every operational table the runtime writes to (owner OR runtime)', () => {
    for (const t of [
      'master_goals', 'goal_jobs', 'agent_contracts', 'os_jobs',
      'worker_leases', 'runtime_command_packets', 'repository_worktrees',
      'job_dependencies', 'orchestration_decisions', 'job_attempts',
      'job_checkpoints', 'dead_letters',
    ]) {
      const block = sql.slice(sql.indexOf(` on ${t}`));
      expect(
        block.includes('is_runtime_service()'),
        `table ${t} not widened for runtime service`,
      ).toBe(true);
    }
  });

  it('does NOT widen Phase-2 legacy tables (least privilege)', () => {
    for (const t of ['agents', 'agent_memory', 'execution_queue', 'locks', 'os_events']) {
      expect(sql).not.toContain(` on ${t}\n`);
    }
  });

  it('does NOT add the runtime identity to public.owners', () => {
    expect(sql).not.toMatch(/insert into public\.owners/i);
  });
});
