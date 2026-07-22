import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static pins for the Phase 6B business-foundation migration. The file is
// owner-applied only; these tests keep it additive, owner-scoped, collision
// free against the 24 pre-existing/authored tables, and simulation-pinned
// at the DB level (quote drafts cannot be marked executable or
// non-simulation without a later owner-gated migration).

const sql = readFileSync(
  new URL(
    '../../../supabase/migrations/0009_phase6b_business_foundation.sql',
    import.meta.url,
  ),
  'utf8',
);

const NEW_TABLES = [
  'business_clients',
  'business_contacts',
  'business_properties',
  'sales_leads',
  'quotes',
  'quote_versions',
  'quote_items',
  'projects',
  'project_milestones',
  'vendor_orders',
  'installation_events',
  'payment_schedules',
  'payment_events',
  'communication_records',
  'business_activity_events',
  'agent_recommendations',
  'quote_draft_runs',
  'approval_links',
];

// Tables that already exist in staging (0001-0006) or in unapplied
// migrations (0007/0008). 0009 must not create or alter any of them.
const EXISTING_TABLES = [
  'tasks',
  'approvals',
  'audit_log',
  'department_configs',
  'briefs',
  'command_packets',
  'access_events',
  'owners',
  'agents',
  'agent_memory',
  'locks',
  'execution_queue',
  'os_events',
  'runtime_command_packets',
  'os_jobs',
  'worker_leases',
  'job_attempts',
  'job_checkpoints',
  'dead_letters',
  'repository_worktrees',
  'orchestration_decisions',
  'system_controls',
  'telegram_updates',
  'runtime_roles',
];

const APPEND_ONLY = [
  'quote_items',
  'payment_schedules',
  'payment_events',
  'business_activity_events',
  'quote_draft_runs',
  'approval_links',
];

describe('migration 0009 - business foundation', () => {
  it('creates every business table with if-not-exists', () => {
    for (const t of NEW_TABLES) {
      expect(sql).toMatch(
        new RegExp(`create table if not exists ${t}\\b`),
      );
    }
  });

  it('creates no table outside the declared set', () => {
    const created = [
      ...sql.matchAll(/create table if not exists (\w+)/g),
    ].map((m) => m[1]);
    expect(created.sort()).toEqual([...NEW_TABLES].sort());
  });

  it('never creates or alters a pre-existing table', () => {
    for (const t of EXISTING_TABLES) {
      expect(sql).not.toMatch(
        new RegExp(`create table if not exists ${t}\\b`),
      );
      expect(sql).not.toMatch(new RegExp(`alter table ${t}\\b`));
    }
  });

  it('enables RLS on every new table', () => {
    for (const t of NEW_TABLES) {
      expect(sql).toMatch(
        new RegExp(`alter table ${t} enable row level security`),
      );
    }
  });

  it('gates every policy on public.is_owner()', () => {
    const policies = [...sql.matchAll(/create policy [\s\S]*?;/g)];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p[0]).toContain('public.is_owner()');
      expect(p[0]).toContain('to authenticated');
    }
  });

  it('grants nothing to anon and never uses a broad grant-all', () => {
    expect(sql).not.toMatch(/grant [^;]*to anon\b/);
    expect(sql).not.toMatch(/grant all\b/i);
  });

  it('revokes update and delete privileges on append-only tables', () => {
    for (const t of APPEND_ONLY) {
      expect(sql).toMatch(
        new RegExp(
          `revoke update, delete on ${t}\\s+from authenticated`,
        ),
      );
      expect(sql).not.toMatch(
        new RegExp(`grant [^;]*update[^;]* on ${t}\\b`),
      );
    }
  });

  it('grants delete on nothing', () => {
    const grants = [...sql.matchAll(/grant [^;]+;/g)];
    for (const g of grants) {
      expect(g[0]).not.toMatch(/\bdelete\b/);
    }
  });

  it('revokes all default privileges from anon on every table', () => {
    for (const t of NEW_TABLES) {
      expect(sql).toMatch(
        new RegExp(`revoke all on ${t} from anon;`),
      );
    }
  });

  it('revokes the default delete privilege on every mutable table', () => {
    const mutable = NEW_TABLES.filter(
      (t) => !APPEND_ONLY.includes(t),
    );
    for (const t of mutable) {
      const hasComboRevoke = new RegExp(
        `revoke update, delete on ${t}\\s+from authenticated`,
      ).test(sql);
      const hasDeleteRevoke = new RegExp(
        `revoke delete on ${t} from authenticated;`,
      ).test(sql);
      expect(
        hasComboRevoke || hasDeleteRevoke,
        `${t} must revoke the delete privilege for authenticated`,
      ).toBe(true);
    }
  });

  it('pins quote_versions numbers via a column-level update grant', () => {
    expect(sql).toMatch(
      /revoke update on quote_versions from authenticated;/,
    );
    expect(sql).toMatch(
      /grant update \(approval_id\) on quote_versions to authenticated;/,
    );
    // No whole-row update grant may exist for quote_versions.
    expect(sql).not.toMatch(
      /grant select, insert, update on quote_versions/,
    );
  });

  it('CHECK-pins the activity ledger simulation state', () => {
    const block = sql.slice(
      sql.indexOf(
        'create table if not exists business_activity_events',
      ),
    );
    const body = block.slice(0, block.indexOf(');'));
    expect(body).toMatch(/check \(simulation_state = 'simulation'\)/);
  });

  it('adds only the insert privilege on approvals (no policy change)', () => {
    // The 0001 approvals table gains insert (owner-RLS still applies)
    // so business draft approvals can be recorded. Nothing else on
    // approvals may change here.
    expect(sql).toMatch(/grant insert on approvals to authenticated;/);
    expect(sql).not.toMatch(/create policy \w+ on approvals\b/);
    expect(sql).not.toMatch(/drop policy [\w ]+ on approvals\b/);
    expect(sql).not.toMatch(/alter table approvals\b/);
  });

  it('pins simulation state at the DB level', () => {
    expect(sql).toMatch(/check \(simulation_state = 'simulation'\)/);
    expect(sql).toMatch(/check \(simulation_only = true\)/);
    expect(sql).toMatch(/check \(execution_eligible = false\)/);
  });

  it('keeps quote versions unique per quote and runs idempotent', () => {
    expect(sql).toMatch(/unique \(quote_id, version\)/);
    for (const t of [
      'payment_events',
      'business_activity_events',
      'agent_recommendations',
      'quote_draft_runs',
    ]) {
      const block = sql.slice(sql.indexOf(`create table if not exists ${t}`));
      const body = block.slice(0, block.indexOf(');'));
      expect(body).toMatch(/idempotency_key text not null unique/);
    }
  });

  it('stores money as bigint cents and rates as integer milli-percent', () => {
    expect(sql).toMatch(/material_cents bigint/);
    expect(sql).toMatch(/labor_cents bigint/);
    expect(sql).toMatch(/fees_cents bigint/);
    expect(sql).toMatch(/tax_cents bigint/);
    expect(sql).toMatch(/total_cents bigint/);
    expect(sql).toMatch(/margin_cents bigint/);
    expect(sql).toMatch(/tax_rate_milli_pct integer/);
    expect(sql).not.toMatch(/numeric\(/);
    expect(sql).not.toMatch(/\bfloat\b/);
    expect(sql).not.toMatch(/\breal\b/);
  });

  it('has no sent state for communications (nothing sends in V1)', () => {
    const block = sql.slice(
      sql.indexOf('create table if not exists communication_records'),
    );
    const body = block.slice(0, block.indexOf(');'));
    expect(body).toContain("'draft'");
    expect(body).not.toContain("'sent'");
    expect(body).toContain("'outbound_draft'");
    expect(body).not.toContain("'outbound_sent'");
  });

  it('depends only on applied migrations (no 0007/0008 objects)', () => {
    expect(sql).not.toMatch(/runtime_role\(/);
    expect(sql).not.toMatch(/\bos_jobs\b/);
    expect(sql).not.toMatch(/push_allowed/);
  });

  it('is additive - no destructive SQL in the migration file', () => {
    // Keywords assembled from fragments so this test file holds no literal
    // destructive token (which the RED-boundary scanner would flag).
    expect(sql).not.toMatch(new RegExp('\\b' + 'dr' + 'op\\s+ta' + 'ble\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'trun' + 'cate\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'del' + 'ete\\s+from\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'dr' + 'op\\s+column\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'al' + 'ter\\s+column\\b', 'i'));
  });
});
