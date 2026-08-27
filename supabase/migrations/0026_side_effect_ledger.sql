-- 0026_side_effect_ledger.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Power-station master goal sections 11/12: ONE universal side-effect
-- ledger. Every external provider action Preston will ever take is recorded
-- and idempotency-guarded through THIS table before, during, and after
-- execution. History rides the existing append-only os_events mechanism
-- (event type SideEffectRecorded) - no second event system.
--
-- Lifecycle (CAS-enforced by the runtime adapters, shape-enforced here):
--   proposed -> refused | authorized
--   authorized -> executing | refused
--   executing -> succeeded | failed | uncertain | authorized (retryable)
--   uncertain -> succeeded | failed   (reconciliation only)
--
-- Idempotency spine: side_effect_id is DERIVED from idempotency_key in code
-- (sha256 prefix), and unique(idempotency_key) makes duplicates converge on
-- one row. The executing claim is a CAS fenced on attempt_count.
--
-- RLS: owner + runtime service identity may select/insert/update (the
-- runtime executes authorized side effects and settles them); anon fully
-- revoked; NO delete grant for anyone (the ledger is permanent evidence;
-- retention is a future owner-gated policy).
--
-- Depends on: 0002 (is_owner), 0020 (is_runtime_service).
-- Rollback: reports/p2_evidence/rollback/rollback_0026.sql.txt (safe only
-- while no side-effect capability is activated).

create table if not exists public.side_effects (
  side_effect_id text primary key,
  request_id text not null,
  goal_id text not null,
  job_id text not null,
  run_id text not null,
  actor_id text not null,
  provider text not null,
  account_id text,
  capability text not null,
  capability_version integer not null default 1,
  target text not null,
  payload_hash text not null,
  payload_summary text not null default '',
  risk_class text not null
    check (risk_class in ('GREEN','YELLOW','RED','BLACK')),
  approval_id text,
  status text not null default 'proposed'
    check (status in ('proposed','refused','authorized','executing',
                      'succeeded','failed','uncertain')),
  attempt_count integer not null default 0
    check (attempt_count >= 0 and attempt_count <= 10),
  idempotency_key text not null,
  environment text not null
    check (environment in ('staging','production')),
  provider_result_id text,
  error_type text
    check (error_type is null or
           error_type in ('terminal','retryable','uncertain')),
  error_message text,
  evidence_refs jsonb not null default '[]',
  created_at timestamptz not null default now(),
  authorized_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Duplicate requests converge on one row.
create unique index if not exists uq_side_effects_idempotency_key
  on public.side_effects (idempotency_key);
create index if not exists idx_side_effects_status
  on public.side_effects (status, updated_at);
create index if not exists idx_side_effects_job
  on public.side_effects (job_id);

alter table public.side_effects enable row level security;

drop policy if exists side_effects_owner_runtime on public.side_effects;
create policy side_effects_owner_runtime on public.side_effects
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists side_effects_owner_runtime_ins on public.side_effects;
create policy side_effects_owner_runtime_ins on public.side_effects
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists side_effects_owner_runtime_upd on public.side_effects;
create policy side_effects_owner_runtime_upd on public.side_effects
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- Supabase default privileges are broad: revoke everything from anon
-- explicitly (0009 lesson), and grant ONLY select/insert/update to
-- authenticated (no delete - append-and-transition evidence).
revoke all on public.side_effects from anon;
revoke all on public.side_effects from authenticated;
grant select, insert, update on public.side_effects to authenticated;
