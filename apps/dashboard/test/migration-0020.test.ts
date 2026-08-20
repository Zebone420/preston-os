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
    // scoped to a single statement ([^;]*), not a greedy cross-file match
    expect(sql).not.toMatch(/on orchestration_approvals[^;]*for update/i);
    expect(sql).not.toMatch(/grant update on orchestration_approvals/i);
  });

  // The EXACT runtime surface, proven from the os-runtime dependency graph
  // (store.ts ORCH_TABLES/RUNTIME_TABLES accessors + access modes). NO MORE.
  const RUNTIME_WRITE_SURFACE = [
    'master_goals', 'goal_jobs', 'job_dependencies', 'orchestration_approvals',
    'orchestration_decisions', 'os_jobs', 'worker_leases', 'job_attempts',
    'job_checkpoints', 'dead_letters', 'runtime_command_packets',
    'repository_worktrees', 'agents', 'os_events', 'remote_intake_requests',
  ];
  // Tables a runtime accessor exists for but NO runtime caller invokes, or
  // that are owner-only by security: must NOT be widened.
  const EXCLUDED = [
    'agent_contracts', 'locks', 'telegram_updates', 'agent_memory',
    'execution_queue', 'owners',
  ];

  // Parse every `create policy NAME on TABLE ... ;` into {table, cmd, body}.
  interface Pol { name: string; table: string; body: string }
  const policies: Pol[] = [...sql.matchAll(/create policy (\w+) on (\w+)([\s\S]*?);/g)]
    .map((m) => ({ name: m[1], table: m[2], body: m[3] }));
  const runtimePolsFor = (t: string) =>
    policies.filter((p) => p.table === t && /is_runtime_service\(\)/.test(p.body));

  it('widens EXACTLY the runtime write surface (no less)', () => {
    for (const t of RUNTIME_WRITE_SURFACE) {
      expect(runtimePolsFor(t).length, `table ${t} has no runtime policy`).toBeGreaterThan(0);
    }
  });

  it('does NOT widen any excluded table (no more / least privilege)', () => {
    for (const t of EXCLUDED) {
      expect(runtimePolsFor(t).length, `excluded table ${t} was widened`).toBe(0);
    }
  });

  it('never grants the runtime a DELETE path on any table (least privilege)', () => {
    const runtimeDelete = policies.filter(
      (p) => /is_runtime_service\(\)/.test(p.body) && /for\s+delete/i.test(p.body),
    );
    expect(runtimeDelete.map((p) => p.name), 'runtime delete policy present').toHaveLength(0);
  });

  it('agents: runtime gets insert+update+select only (no delete/for-all)', () => {
    const cmds = runtimePolsFor('agents').map(
      (p) => (p.body.match(/for\s+(insert|update|select|all|delete)/i) ?? [])[1]?.toLowerCase(),
    ).sort();
    expect(cmds).toEqual(['insert', 'select', 'update']);
  });

  it('remote_intake_requests: runtime gets select+update only (no insert/delete/for-all)', () => {
    const cmds = runtimePolsFor('remote_intake_requests').map(
      (p) => (p.body.match(/for\s+(insert|update|select|all|delete)/i) ?? [])[1]?.toLowerCase(),
    ).sort();
    expect(cmds).toEqual(['select', 'update']);
  });

  it('runtime_services writes are revoked from authenticated (defense in depth)', () => {
    expect(sql).toMatch(/revoke insert, update, delete on public\.runtime_services\s+from authenticated/);
  });

  it('gives the runtime WRITE only via for-all or insert policies on the surface, never on system_controls', () => {
    // system_controls must appear ONLY as a SELECT policy for the runtime
    const sc = sql.slice(sql.indexOf('create policy system_controls_runtime_sel'));
    expect(sc.slice(0, 160)).toMatch(/for select/);
    expect(sql).not.toMatch(/on system_controls[\s\S]{0,80}for all[\s\S]{0,80}is_runtime_service/);
    expect(sql).not.toMatch(/system_controls[\s\S]{0,120}for insert[\s\S]{0,60}is_runtime_service/);
    expect(sql).not.toMatch(/system_controls[\s\S]{0,120}for update/);
  });

  it('does NOT add the runtime identity to public.owners', () => {
    expect(sql).not.toMatch(/insert into public\.owners/i);
  });
});
