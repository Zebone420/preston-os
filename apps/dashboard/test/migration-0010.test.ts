import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static pins for the Phase 7 orchestration migration. Owner-applied only;
// these keep it additive, owner-scoped, collision-free, and simulation-pinned.

const sql = readFileSync(
  new URL('../../../supabase/migrations/0010_phase7_orchestration.sql', import.meta.url),
  'utf8',
);

const NEW = [
  'master_goals', 'goal_jobs', 'job_dependencies', 'agent_contracts',
  'orchestration_approvals',
];
const EXISTING = [
  'approvals', 'os_jobs', 'audit_log', 'quotes', 'runtime_command_packets',
  'system_controls', 'agents', 'business_clients',
];

describe('migration 0010 - orchestration', () => {
  it('creates exactly the declared new tables', () => {
    const created = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...NEW].sort());
  });
  it('never creates or alters a pre-existing table', () => {
    for (const t of EXISTING) {
      expect(sql).not.toMatch(new RegExp(`create table if not exists ${t}\\b`));
      expect(sql).not.toMatch(new RegExp(`alter table ${t} `));
    }
  });
  it('enables RLS + owner policy on every new table', () => {
    for (const t of NEW) {
      expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security`));
    }
    const policies = [...sql.matchAll(/create policy [\s\S]*?;/g)];
    for (const p of policies) {
      expect(p[0]).toContain('public.is_owner()');
      expect(p[0]).toContain('to authenticated');
    }
  });
  it('revokes all from anon on every new table and grants no delete', () => {
    for (const t of NEW) {
      expect(sql).toMatch(new RegExp(`revoke all on ${t} from anon;`));
    }
    for (const g of [...sql.matchAll(/grant [^;]+;/g)]) {
      expect(g[0]).not.toMatch(/\bdelete\b/);
    }
  });
  it('DB-pins simulation and staging invariants', () => {
    expect(sql).toMatch(/check \(simulation_only = true\)/);
    expect(sql).toMatch(/check \(environment = 'staging'\)/);
    expect(sql).toMatch(/check \(executed = false\)/);
    expect(sql).toMatch(/check \(can_approve = false\)/);
    expect(sql).toMatch(/check \(network_scope = 'none'\)/);
  });
  it('is additive - no destructive SQL', () => {
    expect(sql).not.toMatch(new RegExp('\\b' + 'dr' + 'op\\s+ta' + 'ble\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'trun' + 'cate\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'del' + 'ete\\s+from\\b', 'i'));
  });

  // --- audit reconciliation pins -----------------------------------------
  it('approval_id references the Phase 7 lifecycle, not legacy approvals uuid', () => {
    // goal_jobs.approval_id is text (soft) + a deferred FK to
    // orchestration_approvals(approval_id) - NOT approvals(id).
    expect(sql).toMatch(/approval_id text,/);
    expect(sql).not.toMatch(/approval_id uuid references approvals/);
    expect(sql).toMatch(/goal_jobs_approval_fk[\s\S]*references orchestration_approvals \(approval_id\)/);
  });

  it('enforces same-goal dependency edges via composite FKs', () => {
    expect(sql).toMatch(/unique \(id, goal_id\)/); // goal_jobs composite key
    expect(sql).toMatch(/foreign key \(job_id, goal_id\) references goal_jobs \(id, goal_id\)/);
    expect(sql).toMatch(/foreign key \(depends_on_job_id, goal_id\) references goal_jobs \(id, goal_id\)/);
  });

  it('makes approval fields immutable except the decision fields', () => {
    expect(sql).toMatch(/revoke update on orchestration_approvals from authenticated;/);
    expect(sql).toMatch(/grant update \(status, decided_at, nonce\) on orchestration_approvals/);
  });

  it('requires a non-null unique nonce and expiry-after-creation', () => {
    const block = sql.slice(sql.indexOf('create table if not exists orchestration_approvals'));
    const body = block.slice(0, block.indexOf(');'));
    expect(body).toMatch(/nonce text not null/);
    expect(body).toMatch(/check \(expires_at > created_at\)/);
    expect(body).toMatch(/unique \(nonce\)/);
  });
});
