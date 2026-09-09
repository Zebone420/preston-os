-- 0034_p7_graduated_autonomy.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Final master build plan PHASE 7 (graduated autonomy, capability class by
-- capability class; there is NO global autonomous mode) + sections 10/11
-- (approval classes) + 18 (reliability metrics that define anomalies).
--
-- Model: each autonomy CLASS groups capability ids under one approval class
-- and sits on ONE rung of the graduation ladder
--   CODED -> TESTED -> DEPLOYED -> SHADOW -> OWNER_APPROVED_LIVE
--         -> CERTIFIED -> L1_VETO -> L1_AUTO
-- A rung only ever moves through an autonomy_grants row (owner promotion,
-- one rung at a time, evidence attached) or an autonomy_anomalies row
-- (auto-demotion to the safer rung). STEP_UP classes can never graduate
-- past OWNER_APPROVED_LIVE (CHECK below). The GLOBAL system_controls
-- ceiling (hermes_mode / execution_enabled / owner_stop) always wins in
-- code; nothing in these tables can raise it.
--
-- Nothing here executes anything: the tables record grants, outcomes and
-- anomalies, and the runtime computes the EFFECTIVE mode from them.
--
-- RLS (mirrors 0027): owner + runtime service may select/insert; UPDATE is
-- owner-only on grants (revocation) and anomalies (acknowledgement),
-- owner+runtime on classes (runtime auto-demotes); outcomes are append-only
-- (no update grant path is exercised); NO delete grant for anyone; anon
-- fully revoked.
--
-- Depends on: 0002 (is_owner), 0020 (is_runtime_service),
--             0026 (side_effects - outcome evidence source).
-- Rollback: drop the four tables (safe while no class is above SHADOW).

create table if not exists public.autonomy_classes (
  class_id text primary key,
  description text not null default '',
  kind text not null
    check (kind in ('model','deterministic')),
  approval_class text not null
    check (approval_class in ('INTERNAL','EXTERNAL','STEP_UP')),
  capability_ids text[] not null default '{}',
  rung text not null default 'CODED'
    check (rung in ('CODED','TESTED','DEPLOYED','SHADOW',
                    'OWNER_APPROVED_LIVE','CERTIFIED','L1_VETO','L1_AUTO')),
  max_rung text not null default 'L1_AUTO'
    check (max_rung in ('CODED','TESTED','DEPLOYED','SHADOW',
                        'OWNER_APPROVED_LIVE','CERTIFIED','L1_VETO',
                        'L1_AUTO')),
  updated_at timestamptz not null default now(),
  -- STEP_UP (money / legal / order / authority) never graduates past
  -- owner-approved live: every action stays individually owner-approved.
  constraint autonomy_classes_step_up_ceiling
    check (approval_class <> 'STEP_UP' or max_rung = 'OWNER_APPROVED_LIVE')
);

create table if not exists public.autonomy_grants (
  id uuid primary key default gen_random_uuid(),
  class_id text not null references public.autonomy_classes (class_id),
  from_rung text not null
    check (from_rung in ('CODED','TESTED','DEPLOYED','SHADOW',
                         'OWNER_APPROVED_LIVE','CERTIFIED','L1_VETO',
                         'L1_AUTO')),
  to_rung text not null
    check (to_rung in ('CODED','TESTED','DEPLOYED','SHADOW',
                       'OWNER_APPROVED_LIVE','CERTIFIED','L1_VETO',
                       'L1_AUTO')),
  granted_by text not null,
  granted_at timestamptz not null default now(),
  evidence jsonb not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  constraint autonomy_grants_moves check (from_rung <> to_rung)
);

create index if not exists idx_autonomy_grants_class
  on public.autonomy_grants (class_id, granted_at);

create table if not exists public.autonomy_outcomes (
  id uuid primary key default gen_random_uuid(),
  class_id text not null references public.autonomy_classes (class_id),
  capability_id text not null,
  side_effect_id uuid,
  outcome text not null
    check (outcome in ('success','failure','vetoed','anomaly')),
  mode_at_time text not null
    check (mode_at_time in ('CODED','TESTED','DEPLOYED','SHADOW',
                            'OWNER_APPROVED_LIVE','CERTIFIED','L1_VETO',
                            'L1_AUTO')),
  recorded_at timestamptz not null default now(),
  evidence_ref text
);

create index if not exists idx_autonomy_outcomes_class
  on public.autonomy_outcomes (class_id, recorded_at);

create table if not exists public.autonomy_anomalies (
  id uuid primary key default gen_random_uuid(),
  class_id text not null references public.autonomy_classes (class_id),
  severity text not null
    check (severity in ('critical','major','minor')),
  kind text not null
    check (kind in ('duplicate_side_effect','contact_leak',
                    'stale_approval_execution','wrong_project',
                    'kill_switch','budget_breach','other')),
  evidence jsonb not null,
  detected_at timestamptz not null default now(),
  demoted_to text
    check (demoted_to is null or
           demoted_to in ('CODED','TESTED','DEPLOYED','SHADOW',
                          'OWNER_APPROVED_LIVE','CERTIFIED','L1_VETO',
                          'L1_AUTO')),
  acknowledged_by text,
  acknowledged_at timestamptz
);

create index if not exists idx_autonomy_anomalies_class
  on public.autonomy_anomalies (class_id, detected_at);

-- Seed: the plan's good early candidates, all at CODED. Replays converge.
insert into public.autonomy_classes
  (class_id, description, kind, approval_class, capability_ids, max_rung)
values
  ('internal_summaries', 'Internal summaries of threads and documents',
   'model', 'INTERNAL', '{}', 'L1_AUTO'),
  ('stale_deal_detection', 'Stale-deal detection over pipeline state',
   'deterministic', 'INTERNAL', '{}', 'L1_AUTO'),
  ('internal_task_creation', 'Internal task creation from findings',
   'deterministic', 'INTERNAL', '{}', 'L1_AUTO'),
  ('deterministic_filing', 'Deterministic document filing',
   'deterministic', 'INTERNAL', '{}', 'L1_AUTO'),
  ('vendor_order_status_checks', 'Vendor / order status read checks',
   'deterministic', 'INTERNAL', '{}', 'L1_AUTO'),
  ('low_risk_reminders', 'Low-risk internal reminders',
   'deterministic', 'INTERNAL', '{}', 'L1_AUTO'),
  ('knowledge_indexing', 'Knowledge fabric indexing',
   'deterministic', 'INTERNAL', '{}', 'L1_AUTO'),
  ('daily_brief', 'Daily owner brief composition',
   'model', 'INTERNAL', '{}', 'L1_AUTO'),
  ('external_client_send', 'Client-facing sends (email, invites)',
   'model', 'EXTERNAL', '{}', 'L1_VETO'),
  ('money_order_actions', 'Money, order placement, legal authority',
   'deterministic', 'STEP_UP', '{}', 'OWNER_APPROVED_LIVE')
on conflict (class_id) do nothing;

alter table public.autonomy_classes enable row level security;
alter table public.autonomy_grants enable row level security;
alter table public.autonomy_outcomes enable row level security;
alter table public.autonomy_anomalies enable row level security;

-- autonomy_classes: owner + runtime read/insert; owner + runtime update
-- (the runtime auto-demotes on a critical anomaly; the owner promotes).
drop policy if exists autonomy_classes_owner_runtime_sel
  on public.autonomy_classes;
create policy autonomy_classes_owner_runtime_sel on public.autonomy_classes
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_classes_owner_runtime_ins
  on public.autonomy_classes;
create policy autonomy_classes_owner_runtime_ins on public.autonomy_classes
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_classes_owner_runtime_upd
  on public.autonomy_classes;
create policy autonomy_classes_owner_runtime_upd on public.autonomy_classes
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- autonomy_grants: owner + runtime read; owner + runtime insert (the row
-- carries the owner identity in granted_by); owner-only update (revoke).
drop policy if exists autonomy_grants_owner_runtime_sel
  on public.autonomy_grants;
create policy autonomy_grants_owner_runtime_sel on public.autonomy_grants
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_grants_owner_runtime_ins
  on public.autonomy_grants;
create policy autonomy_grants_owner_runtime_ins on public.autonomy_grants
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_grants_owner_upd on public.autonomy_grants;
create policy autonomy_grants_owner_upd on public.autonomy_grants
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- autonomy_outcomes: append-only evidence (select + insert only).
drop policy if exists autonomy_outcomes_owner_runtime_sel
  on public.autonomy_outcomes;
create policy autonomy_outcomes_owner_runtime_sel
  on public.autonomy_outcomes
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_outcomes_owner_runtime_ins
  on public.autonomy_outcomes;
create policy autonomy_outcomes_owner_runtime_ins
  on public.autonomy_outcomes
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());

-- autonomy_anomalies: owner + runtime read/insert; owner-only update
-- (acknowledgement is an owner decision; it unpins the demoted rung).
drop policy if exists autonomy_anomalies_owner_runtime_sel
  on public.autonomy_anomalies;
create policy autonomy_anomalies_owner_runtime_sel
  on public.autonomy_anomalies
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_anomalies_owner_runtime_ins
  on public.autonomy_anomalies;
create policy autonomy_anomalies_owner_runtime_ins
  on public.autonomy_anomalies
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists autonomy_anomalies_owner_upd
  on public.autonomy_anomalies;
create policy autonomy_anomalies_owner_upd on public.autonomy_anomalies
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Supabase default privileges are broad: revoke everything from anon
-- explicitly (0009 lesson); grant the minimum to authenticated; no delete.
revoke all on public.autonomy_classes from anon;
revoke all on public.autonomy_grants from anon;
revoke all on public.autonomy_outcomes from anon;
revoke all on public.autonomy_anomalies from anon;
revoke all on public.autonomy_classes from authenticated;
revoke all on public.autonomy_grants from authenticated;
revoke all on public.autonomy_outcomes from authenticated;
revoke all on public.autonomy_anomalies from authenticated;
grant select, insert, update on public.autonomy_classes to authenticated;
grant select, insert, update on public.autonomy_grants to authenticated;
grant select, insert on public.autonomy_outcomes to authenticated;
grant select, insert, update on public.autonomy_anomalies to authenticated;
