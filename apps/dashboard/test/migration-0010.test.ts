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
  it('only additively alters repository_worktrees (add column if not exists)', () => {
    // The migration intentionally extends the pre-existing 0004
    // repository_worktrees table with the Phase 7 fencing columns. That is
    // allowed, but it must stay ADDITIVE: every alter is `add column if not
    // exists`, never a drop/type-change. (repository_worktrees is deliberately
    // NOT in EXISTING above so this specific, guarded alteration is permitted.)
    const alters = [...sql.matchAll(/alter table repository_worktrees\s+([\s\S]*?);/g)];
    expect(alters.length).toBeGreaterThanOrEqual(3);
    for (const a of alters) {
      expect(a[1]).toMatch(/add column if not exists/);
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

  it('makes approvals function-only: no direct UPDATE grant or policy', () => {
    // Audit critical #17: direct UPDATE is fully revoked and there is NO
    // column-level update grant and NO update policy. The ONLY decision path
    // is the transactional function public.decide_orchestration_approval.
    expect(sql).toMatch(/revoke update on orchestration_approvals from authenticated;/);
    expect(sql).not.toMatch(/grant update \([^)]*\) on orchestration_approvals/);
    expect(sql).not.toMatch(/create policy orch_approvals_owner_upd/);
  });

  it('uses a nullable decision nonce with a PARTIAL unique index', () => {
    // nonce is NULL while pending (a plain NOT NULL would block pending
    // inserts); uniqueness is enforced only on real decision nonces via a
    // partial unique index. Asserted against the full SQL for robustness.
    expect(sql).toMatch(/\n\s*nonce text,\n/);
    expect(sql).not.toMatch(/nonce text not null/);
    expect(sql).toMatch(/check \(expires_at > created_at\)/);
    // no table-level unique(nonce) constraint (a partial index instead)
    expect(sql).not.toMatch(/\n\s*unique \(nonce\)\n/);
    expect(sql).toMatch(/create unique index if not exists uq_orchestration_approvals_nonce\s+on orchestration_approvals \(nonce\) where nonce is not null/);
  });

  // --- concurrent-mod reconciliation pins (findings #12/#16/#17) ----------
  it('adds a durable iteration counter and correlation idempotency index', () => {
    // #12: iteration lives in the row so the driver loop budget survives a
    // restart. #16: one goal graph per correlation key (idempotent retry).
    expect(sql).toMatch(/iteration integer not null default 0\s*check \(iteration >= 0\)/);
    expect(sql).toMatch(/create unique index if not exists uq_master_goals_correlation\s*on master_goals \(correlation_id\)/);
  });

  it('persists goal decomposition atomically via a SECURITY INVOKER fn', () => {
    // #16: goal + jobs + deps in one transaction; caller RLS applies (invoker);
    // idempotent replay; bounded job count; owner-authorized.
    const m = sql.match(/create or replace function public\.submit_goal_decomposition[\s\S]*?\$fn\$;/);
    expect(m).not.toBeNull();
    const body = m![0];
    expect(body).toMatch(/security invoker/);
    expect(body).toMatch(/set search_path = public, pg_temp/);
    expect(body).toMatch(/public\.is_owner\(\)/);
    expect(body).toMatch(/too_many_jobs/);
    expect(body).toMatch(/'created', false/); // idempotent replay returns existing
    expect(body).toMatch(/insert into public\.master_goals/);
    expect(body).toMatch(/insert into public\.goal_jobs/);
    expect(body).toMatch(/insert into public\.job_dependencies/);
    // hardened (Codex reconcile): per-correlation advisory lock makes concurrent
    // replay operationally idempotent; deterministic both-keys identity check
    // raises idempotency_conflict on a partial/cross match; non-array deps fail.
    expect(body).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('submit_goal_decomposition:' \|\| v_corr, 0\)\)/);
    expect(body).not.toMatch(/pg_advisory_xact_lock\(hashtext\(/); // not the 32-bit key
    expect(body).toMatch(/idempotency_conflict/);
    expect(body).toMatch(/v_corr_of_id is not distinct from v_corr\s*and v_id_of_corr is not distinct from v_goal_id/);
    expect(body).toMatch(/deps_invalid/);
    // no legacy non-deterministic "id = ... or correlation_id = ... limit 1"
    expect(body).not.toMatch(/where id = v_goal_id or correlation_id = v_corr\s*limit 1/);
    // execute restricted to authenticated; revoked from public + anon.
    expect(sql).toMatch(/revoke all on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s*from public;/);
    expect(sql).toMatch(/revoke all on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s*from anon;/);
    expect(sql).toMatch(/grant execute on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s*to authenticated;/);
  });

  it('decides approvals via a hardened SECURITY DEFINER fn', () => {
    // #17: the only decision path. Owner-checked, row-locked, pending-only,
    // one-time nonce, expiry from db time, outcome-validated, decision-fields
    // only, fixed search_path, execute restricted to authenticated.
    const m = sql.match(/create or replace function public\.decide_orchestration_approval[\s\S]*?\$fn\$;/);
    expect(m).not.toBeNull();
    const body = m![0];
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = public, pg_temp/);
    expect(body).toMatch(/public\.is_owner\(\)/);
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/v_row\.status <> 'pending'/);
    expect(body).toMatch(/v_row\.nonce is not null/);
    // hardened (Codex reconcile): real wall-clock taken AFTER the row lock so a
    // decider that waited on FOR UPDATE cannot approve a lease that expired
    // while it was blocked. now()/transaction_timestamp() must NOT gate expiry.
    expect(body).toMatch(/v_now timestamptz/);
    // ORDER matters: the row lock, THEN the post-lock clock, THEN the expiry gate.
    expect(body).toMatch(/for update[\s\S]*?v_now := clock_timestamp\(\)[\s\S]*?v_now >= v_row\.expires_at/);
    // no wall-clock-at-transaction-start may gate expiry (now/transaction_timestamp)
    expect(body).not.toMatch(/(now|transaction_timestamp)\(\)\s*>=\s*v_row\.expires_at/);
    expect(body).toMatch(/not in \('approved', 'rejected', 'more_info'\)/);
    // mutates ONLY the decision fields, with decided_at = the post-lock clock
    expect(body).toMatch(/set status = p_outcome,\s*decided_at = v_now,\s*nonce = p_nonce/);
    expect(sql).toMatch(/revoke all on function public\.decide_orchestration_approval\(text, text, text\)\s*from public;/);
    expect(sql).toMatch(/revoke all on function public\.decide_orchestration_approval\(text, text, text\)\s*from anon;/);
    expect(sql).toMatch(/grant execute on function public\.decide_orchestration_approval\(text, text, text\)\s*to authenticated;/);
  });
});
