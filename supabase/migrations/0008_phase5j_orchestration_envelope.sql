-- ============================================================
-- 0008_phase5j_orchestration_envelope.sql
-- Phase 5J: shared multi-agent job envelope columns (FILES ONLY; NOT applied
-- by the AI; staging-only; owner applies later at an explicit gate).
--
-- Adds the orchestration-envelope fields that os_jobs was missing (per the
-- Phase 5J gap analysis against runtime_command_packets/os_jobs and
-- src/lib/ai-os/{commands,queue}.ts): environment, title, objective, the
-- allowed/prohibited operation allowlists, base branch/commit + worktree
-- path, the implementer/reviewer assignment, required tests/evidence, an
-- explicit owner approval_state, and hard-pinned push/deploy flags. These
-- columns back apps/dashboard/src/lib/ai-os/envelope.ts (JobEnvelope /
-- validateJobEnvelope), owned by this same gate.
--
-- Additive-safe: ALTER TABLE ... ADD COLUMN IF NOT EXISTS only, every new
-- column has a safe default so existing rows remain valid with no backfill
-- step required. No column is dropped, renamed, or retyped. No existing
-- constraint, policy, grant, or row is modified or removed. No RLS changes.
-- push_allowed/deploy_allowed are CHECKed to the literal false: this
-- migration cannot itself grant push or deploy capability - that requires a
-- later, separate, owner-approved RED gate that alters the CHECK.
--
-- NOT persisted by this migration (architecture audit F2): JobEnvelope has
-- five fields with no column added here - scope, checkpoint_state,
-- audit_refs, source, requested_by. These remain in-memory-only contract
-- fields on the envelope; they are neither read nor written by this schema.
-- A future migration may add persistence for them, or they may stay derived
-- from existing columns/tables (e.g. checkpoint_state from job_checkpoints,
-- requested_by/source from the linked runtime_command_packets row) - that
-- decision is deliberately deferred, not made by this migration.
-- ============================================================

alter table os_jobs
  add column if not exists environment text not null default 'staging'
    check (environment = 'staging'),
  add column if not exists title text not null default '',
  add column if not exists objective text not null default '',
  add column if not exists allowed_operations text[] not null default '{}',
  add column if not exists prohibited_operations text[] not null default '{}',
  add column if not exists base_branch text not null default 'master',
  add column if not exists base_commit text not null default '',
  add column if not exists worktree_path text not null default '',
  add column if not exists assigned_implementer text not null default '',
  add column if not exists assigned_reviewer text not null default '',
  add column if not exists required_tests text[] not null default '{}',
  add column if not exists required_evidence text[] not null default '{}',
  add column if not exists approval_state text not null default 'pending_owner'
    check (approval_state in ('pending_owner','owner_approved','owner_rejected')),
  add column if not exists push_allowed boolean not null default false
    check (push_allowed = false),
  add column if not exists deploy_allowed boolean not null default false
    check (deploy_allowed = false);

-- An implementer may never also be the reviewer for the same job (the empty
-- default '' for both columns is exempt so the ADD COLUMN backfill above
-- never violates this check on existing rows before assignment happens).
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so this is guarded
-- explicitly via pg_constraint to keep the migration re-run-safe/idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'os_jobs_implementer_reviewer_distinct'
  ) then
    alter table os_jobs
      add constraint os_jobs_implementer_reviewer_distinct
      check (assigned_implementer is distinct from assigned_reviewer or assigned_implementer = '');
  end if;
end $$;
