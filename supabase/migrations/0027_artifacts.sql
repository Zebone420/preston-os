-- 0027_artifacts.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Power-station master goal section 5 + PRESTON_ARTIFACT_DURABILITY_DESIGN
-- v1: the minimal SSOT metadata table for durable worker artifacts. The
-- object BYTES live in the private per-environment Supabase Storage bucket
-- 'artifacts' (created at owner Gate C alongside this migration; storage
-- policies are in the gate packet). NO binary data in DB rows; existing
-- evidence refs (artifact:<id>) link jobs to artifacts - no link table.
--
-- RLS: owner + runtime service may select/insert (the runtime persists
-- artifacts post-run; readback is owner-side through Preston Control).
-- UPDATE is limited to the owner (retention_state changes are owner
-- decisions); no delete grant (physical deletion = owner storage action +
-- retention_state, never a row purge).
--
-- Depends on: 0002 (is_owner), 0020 (is_runtime_service).
-- Rollback: reports/p2_evidence/rollback/rollback_0027.sql.txt.

create table if not exists public.artifacts (
  artifact_id text primary key,
  goal_id text not null,
  job_id text not null,
  run_id text not null,
  artifact_type text not null
    check (artifact_type in ('document','diff','report','export',
                             'image','data','other')),
  name text not null,
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  created_by text not null,
  provider text,
  commit_sha text,
  environment text not null
    check (environment in ('staging','production')),
  classification text not null default 'internal'
    check (classification in ('internal','owner_only')),
  retention_policy text not null default 'standard'
    check (retention_policy in ('standard','extended','ephemeral')),
  retention_state text not null default 'active'
    check (retention_state in ('active','expired','removed')),
  created_at timestamptz not null default now()
);

-- One metadata row per stored object path; replays converge.
create unique index if not exists uq_artifacts_object_path
  on public.artifacts (object_path);
create index if not exists idx_artifacts_job
  on public.artifacts (job_id);
create index if not exists idx_artifacts_goal
  on public.artifacts (goal_id, created_at);

alter table public.artifacts enable row level security;

drop policy if exists artifacts_owner_runtime_sel on public.artifacts;
create policy artifacts_owner_runtime_sel on public.artifacts
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists artifacts_owner_runtime_ins on public.artifacts;
create policy artifacts_owner_runtime_ins on public.artifacts
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists artifacts_owner_upd on public.artifacts;
create policy artifacts_owner_upd on public.artifacts
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.artifacts from anon;
revoke all on public.artifacts from authenticated;
grant select, insert, update on public.artifacts to authenticated;
