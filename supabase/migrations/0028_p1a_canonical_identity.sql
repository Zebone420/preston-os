-- 0028_p1a_canonical_identity.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 1 Lane A (Canonical Identity) of the FINAL MASTER BUILD PLAN v1,
-- section 4 (identity), 5.1 (project-id minting), 8.3 (evidence), 19
-- (owner rules). Additive only: one nullable column on projects, four
-- new tables, one sequence table, one SECURITY DEFINER minter.
--
-- Identity rules pinned here (not app-only):
--   * project codes are DB-minted, unique, permanent, never reused and
--     never AI-generated: the ONLY writer is public.mint_project_code;
--   * an identity link may only reach confidence 'confirmed' through an
--     owner session (a runtime/AI actor cannot insert or update a
--     confirmed row) and must carry confirmed_by + confirmed_at;
--   * a review-queue item may only be decided (confirmed/rejected) by
--     the owner session; the runtime may open or expire items;
--   * an alias may only be marked approved by the owner session;
--   * the business field-ownership matrix is owner-maintained data.
--
-- RLS mirrors 0027: owner + runtime service may select/insert; updates
-- are narrowed per table; no anon grant; NO row-removal grant anywhere.
--
-- Depends on: 0002 (is_owner), 0009 (projects), 0020 (is_runtime_service).
-- Rollback: reports/p2_evidence/rollback/rollback_0028.sql.txt (owner
-- packet; kept out of this file so it stays free of destructive DDL).

-- ============================================================
-- 1. projects.project_code - human project id (P26-0001)
-- ============================================================
alter table public.projects
  add column if not exists project_code text;

alter table public.projects
  drop constraint if exists projects_project_code_format;
alter table public.projects
  add constraint projects_project_code_format
  check (project_code is null or project_code ~ '^P[0-9]{2}-[0-9]{4}$');

create unique index if not exists uq_projects_project_code
  on public.projects (project_code)
  where project_code is not null;

-- ============================================================
-- 2. project_code_sequences - one counter row per two-digit year
-- ============================================================
create table if not exists public.project_code_sequences (
  year_yy char(2) primary key check (year_yy ~ '^[0-9]{2}$'),
  next_seq integer not null default 1
    check (next_seq >= 1 and next_seq <= 10000),
  updated_at timestamptz not null default now()
);

-- Read-only for sessions: the ONLY writer is mint_project_code below
-- (SECURITY DEFINER). No insert/update policy and no write grant, so
-- even the owner session cannot move the counter by hand.
alter table public.project_code_sequences enable row level security;

drop policy if exists project_code_sequences_owner_runtime_sel
  on public.project_code_sequences;
create policy project_code_sequences_owner_runtime_sel
  on public.project_code_sequences
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

revoke all on public.project_code_sequences from anon;
revoke all on public.project_code_sequences from authenticated;
grant select on public.project_code_sequences to authenticated;

-- ============================================================
-- 3. mint_project_code - the ONLY writer of projects.project_code
--    Atomic: row-locks the project, then the year counter. Refuses
--    when the project already has a code (codes are permanent) and
--    when the year counter is exhausted (codes are never reused).
--    SECURITY DEFINER so the counter table needs no direct write
--    grant; the caller is still gated to owner or runtime service.
-- ============================================================
create or replace function public.mint_project_code(
  p_project_id uuid,
  p_year_yy text default to_char(now(), 'YY')
) returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing text;
  v_seq integer;
  v_code text;
begin
  if not (public.is_owner() or public.is_runtime_service()) then
    raise exception 'mint_project_code: not_authorized';
  end if;
  if p_year_yy is null or p_year_yy !~ '^[0-9]{2}$' then
    raise exception 'mint_project_code: invalid_year';
  end if;

  select project_code into v_existing
    from public.projects
   where id = p_project_id
   for update;
  if not found then
    raise exception 'mint_project_code: project_not_found';
  end if;
  if v_existing is not null then
    raise exception 'mint_project_code: project_already_coded';
  end if;

  insert into public.project_code_sequences (year_yy, next_seq)
  values (p_year_yy, 1)
  on conflict (year_yy) do nothing;

  select next_seq into v_seq
    from public.project_code_sequences
   where year_yy = p_year_yy
   for update;
  if v_seq > 9999 then
    raise exception 'mint_project_code: sequence_exhausted';
  end if;

  v_code := 'P' || p_year_yy || '-' || lpad(v_seq::text, 4, '0');

  update public.project_code_sequences
     set next_seq = v_seq + 1, updated_at = now()
   where year_yy = p_year_yy;

  update public.projects
     set project_code = v_code, updated_at = now()
   where id = p_project_id;

  return v_code;
end
$fn$;

revoke all on function public.mint_project_code(uuid, text) from public;
revoke all on function public.mint_project_code(uuid, text) from anon;
grant execute on function public.mint_project_code(uuid, text)
  to authenticated;

-- ============================================================
-- 4. identity_links - external-system id -> canonical entity
-- ============================================================
create table if not exists public.identity_links (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('client','contact','property','project',
                           'lead','communication')),
  entity_id uuid not null,
  external_system text not null
    check (external_system in ('airtable','gmail_thread','iqplus',
                               'home_depot_case','home_depot_quote',
                               'andersen_lead','docusign_envelope',
                               'drive_folder')),
  external_id text not null check (length(external_id) > 0),
  confidence text not null default 'candidate'
    check (confidence in ('orphan','candidate','linked_auto',
                          'confirmed')),
  signal text not null,
  evidence jsonb not null default '[]',
  proposed_by text not null,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_links_confirmed_requires_human check (
    confidence <> 'confirmed'
    or (confirmed_by is not null and confirmed_at is not null)
  ),
  unique (external_system, external_id)
);
create index if not exists idx_identity_links_entity
  on public.identity_links (entity_type, entity_id);

alter table public.identity_links enable row level security;

drop policy if exists identity_links_owner_runtime_sel
  on public.identity_links;
create policy identity_links_owner_runtime_sel on public.identity_links
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
-- The runtime may insert orphan/candidate/linked_auto rows only; a
-- 'confirmed' row can only be born from an owner session.
drop policy if exists identity_links_owner_runtime_ins
  on public.identity_links;
create policy identity_links_owner_runtime_ins on public.identity_links
  for insert to authenticated
  with check (
    public.is_owner()
    or (public.is_runtime_service() and confidence <> 'confirmed')
  );
drop policy if exists identity_links_owner_runtime_upd
  on public.identity_links;
create policy identity_links_owner_runtime_upd on public.identity_links
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (
    public.is_owner()
    or (public.is_runtime_service() and confidence <> 'confirmed')
  );

revoke all on public.identity_links from anon;
revoke all on public.identity_links from authenticated;
grant select, insert, update on public.identity_links to authenticated;

-- ============================================================
-- 5. contact_aliases - approved deterministic aliases
-- ============================================================
create table if not exists public.contact_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_kind text not null
    check (alias_kind in ('email','phone','address')),
  normalized_value text not null check (length(normalized_value) > 0),
  display_value text not null default '',
  client_id uuid references public.business_clients (id),
  contact_id uuid references public.business_contacts (id),
  property_id uuid references public.business_properties (id),
  project_id uuid references public.projects (id),
  source text not null default 'manual',
  approved boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint contact_aliases_has_target check (
    client_id is not null or contact_id is not null
    or property_id is not null or project_id is not null
  ),
  unique (alias_kind, normalized_value)
);
create index if not exists idx_contact_aliases_client
  on public.contact_aliases (client_id);
create index if not exists idx_contact_aliases_project
  on public.contact_aliases (project_id);

alter table public.contact_aliases enable row level security;

drop policy if exists contact_aliases_owner_runtime_sel
  on public.contact_aliases;
create policy contact_aliases_owner_runtime_sel on public.contact_aliases
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
-- approved=true is an owner decision: the runtime can only propose.
drop policy if exists contact_aliases_owner_runtime_ins
  on public.contact_aliases;
create policy contact_aliases_owner_runtime_ins on public.contact_aliases
  for insert to authenticated
  with check (
    public.is_owner()
    or (public.is_runtime_service() and approved = false)
  );
drop policy if exists contact_aliases_owner_upd on public.contact_aliases;
create policy contact_aliases_owner_upd on public.contact_aliases
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.contact_aliases from anon;
revoke all on public.contact_aliases from authenticated;
grant select, insert, update on public.contact_aliases to authenticated;

-- ============================================================
-- 6. identity_review_queue - human decisions on ambiguous matches
-- ============================================================
create table if not exists public.identity_review_queue (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id text,
  candidate_entity_type text not null
    check (candidate_entity_type in ('client','contact','property',
                                     'project','lead','communication')),
  candidate_entity_id uuid,
  reason text not null check (length(reason) > 0),
  signals jsonb not null default '[]',
  status text not null default 'open'
    check (status in ('open','confirmed','rejected','expired')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint identity_review_decision_requires_actor check (
    status not in ('confirmed','rejected')
    or (decided_by is not null and decided_at is not null)
  )
);
create index if not exists idx_identity_review_queue_status
  on public.identity_review_queue (status, created_at);

alter table public.identity_review_queue enable row level security;

drop policy if exists identity_review_owner_runtime_sel
  on public.identity_review_queue;
create policy identity_review_owner_runtime_sel
  on public.identity_review_queue
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
-- A directly-inserted item may only be born OPEN and undecided.
drop policy if exists identity_review_owner_runtime_ins
  on public.identity_review_queue;
create policy identity_review_owner_runtime_ins
  on public.identity_review_queue
  for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service())
    and status = 'open' and decided_by is null and decided_at is null
  );
-- The runtime may only expire; confirm/reject is an owner decision.
drop policy if exists identity_review_owner_runtime_upd
  on public.identity_review_queue;
create policy identity_review_owner_runtime_upd
  on public.identity_review_queue
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (
    public.is_owner()
    or (public.is_runtime_service() and status in ('open','expired'))
  );

revoke all on public.identity_review_queue from anon;
revoke all on public.identity_review_queue from authenticated;
grant select, insert, update on public.identity_review_queue
  to authenticated;

-- ============================================================
-- 7. business_field_ownership - exactly one owner per synced field
--    (plan 3.3: no ambiguous two-way authority). Supabase owns
--    identity, stage, clocks and money; Airtable is a mirror
--    surface; Gmail owns message facts; vendor systems own their
--    own reference numbers; 'owner' marks human-decided fields.
--    Finance fields are never mirrored (sync_direction none).
-- ============================================================
create table if not exists public.business_field_ownership (
  field_path text primary key
    check (field_path ~ '^[a-z_]+\.[a-z_]+$'),
  owner_system text not null
    check (owner_system in ('supabase','airtable','gmail','drive',
                            'iqplus','owner')),
  sync_direction text not null default 'none'
    check (sync_direction in ('none','supabase_to_airtable',
                              'airtable_to_supabase')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  constraint business_field_ownership_direction_matches_owner check (
    (sync_direction = 'none')
    or (sync_direction = 'supabase_to_airtable'
        and owner_system in ('supabase','owner'))
    or (sync_direction = 'airtable_to_supabase'
        and owner_system = 'airtable')
  )
);

alter table public.business_field_ownership enable row level security;

drop policy if exists business_field_ownership_owner_runtime_sel
  on public.business_field_ownership;
create policy business_field_ownership_owner_runtime_sel
  on public.business_field_ownership
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists business_field_ownership_owner_ins
  on public.business_field_ownership;
create policy business_field_ownership_owner_ins
  on public.business_field_ownership
  for insert to authenticated with check (public.is_owner());
drop policy if exists business_field_ownership_owner_upd
  on public.business_field_ownership;
create policy business_field_ownership_owner_upd
  on public.business_field_ownership
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.business_field_ownership from anon;
revoke all on public.business_field_ownership from authenticated;
grant select, insert, update on public.business_field_ownership
  to authenticated;

-- Seed matrix. Mirrors FIELD_OWNERSHIP in
-- apps/dashboard/src/lib/business/identity/field-ownership.ts (the
-- lint test pins both lists to each other). Re-applying converges
-- every seeded row to this file's values.
insert into public.business_field_ownership
  (field_path, owner_system, sync_direction, note)
values
  ('business_clients.display_name', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_clients.client_type', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_clients.primary_email', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_clients.primary_phone', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_clients.notes', 'owner', 'none', 'owner free text'),
  ('business_contacts.full_name', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_contacts.email', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_contacts.phone', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_properties.address_line', 'supabase',
   'supabase_to_airtable', 'identity'),
  ('business_properties.unit', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_properties.city', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_properties.postal_code', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('business_properties.lpc_review', 'owner', 'supabase_to_airtable',
   'owner compliance ruling'),
  ('business_properties.dob_permit', 'owner', 'supabase_to_airtable',
   'owner compliance ruling'),
  ('sales_leads.stage', 'supabase', 'supabase_to_airtable', 'stage'),
  ('sales_leads.stage_changed_at', 'supabase', 'supabase_to_airtable',
   'clock'),
  ('sales_leads.lead_source', 'supabase', 'supabase_to_airtable',
   'identity'),
  ('sales_leads.owner_next_action', 'owner', 'none', 'owner free text'),
  ('quotes.status', 'supabase', 'supabase_to_airtable', 'stage'),
  ('quotes.current_version', 'supabase', 'none', 'identity'),
  ('quote_versions.total_cents', 'supabase', 'none',
   'money - never mirrored'),
  ('quote_versions.subtotal_cents', 'supabase', 'none',
   'money - never mirrored'),
  ('projects.project_code', 'supabase', 'supabase_to_airtable',
   'identity - DB-minted only'),
  ('projects.status', 'supabase', 'supabase_to_airtable', 'stage'),
  ('projects.stage', 'supabase', 'supabase_to_airtable',
   'stage-gate model stage; column lands with the stage-gate migration'),
  ('projects.contract_status', 'supabase', 'supabase_to_airtable',
   'stage'),
  ('projects.deposit_status', 'supabase', 'supabase_to_airtable',
   'stage'),
  ('projects.milestone_summary', 'supabase', 'none', 'derived'),
  ('projects.created_at', 'supabase', 'none', 'clock'),
  ('projects.updated_at', 'supabase', 'none', 'clock'),
  ('project_milestones.status', 'supabase', 'supabase_to_airtable',
   'stage'),
  ('project_milestones.due_date', 'supabase', 'supabase_to_airtable',
   'clock'),
  ('project_milestones.completed_at', 'supabase', 'none', 'clock'),
  ('vendor_orders.order_number', 'iqplus', 'none',
   'vendor reference - reconciled, never invented'),
  ('vendor_orders.delivery_status', 'supabase', 'supabase_to_airtable',
   'stage'),
  ('vendor_orders.expected_ship_date', 'supabase',
   'supabase_to_airtable', 'clock'),
  ('installation_events.scheduled_date', 'supabase',
   'supabase_to_airtable', 'clock'),
  ('installation_events.status', 'supabase', 'supabase_to_airtable',
   'stage'),
  ('payment_schedules.stages', 'supabase', 'none',
   'money - never mirrored'),
  ('payment_schedules.total_cents', 'supabase', 'none',
   'money - never mirrored'),
  ('payment_events.amount_cents', 'supabase', 'none',
   'money - never mirrored'),
  ('communication_records.subject', 'gmail', 'none', 'message fact'),
  ('communication_records.occurred_at', 'gmail', 'none',
   'message fact'),
  ('communication_records.source_link', 'gmail', 'none',
   'message fact'),
  ('business_activity_events.summary', 'supabase', 'none', 'ledger')
on conflict (field_path) do update
  set owner_system = excluded.owner_system,
      sync_direction = excluded.sync_direction,
      note = excluded.note,
      updated_at = now();
