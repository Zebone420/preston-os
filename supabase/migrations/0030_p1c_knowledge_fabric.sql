-- 0030_p1c_knowledge_fabric.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 1 Lane C - Knowledge Fabric foundation (master build plan section
-- 6, Andersen knowledge layer plan v1). A REGISTRY of cited sources plus
-- deterministic chunks, candidate facts with a human-gated state machine,
-- and an owner-curated eval set. Nothing here invents a product fact: every
-- fact row carries citations into registered source chunks, and only a
-- human actor can move a candidate to VERIFIED / AUTHORIZED_FOR_USE.
--
-- Lane independence: knowledge_sources.document_id references the Lane B
-- document registry (documents.id, migration 0029) by uuid WITHOUT a hard
-- foreign key so this migration applies whether or not 0029 is present.
-- Referential integrity for that column is enforced by the adapters.
--
-- RLS mirrors 0027: owner + runtime service may select/insert; UPDATE is
-- owner-only (verification and authorization are owner decisions); no
-- delete grant on any table; anon fully revoked. knowledge_domains is a
-- seed table: read-only for everyone (no insert/update grant).
--
-- Depends on: 0002 (is_owner), 0020 (is_runtime_service).

-- --- domains (seed) --------------------------------------------------------

create table if not exists public.knowledge_domains (
  domain text primary key,
  restricted boolean not null default false,
  project_scoped boolean not null default false,
  description text not null default ''
);

insert into public.knowledge_domains (domain, restricted, project_scoped, description)
values
  ('ANDERSEN_OFFICIAL', false, false, 'Vendor official documents (registry only)'),
  ('LPC_OFFICIAL', false, false, 'Landmarks official documents and guidance'),
  ('LPC_PRECEDENT', false, false, 'Public precedent and Preston LPC packages'),
  ('PRESTON_SOP', false, false, 'Preston standard operating procedures'),
  ('TEMPLATE_LIBRARY', false, false, 'Current templates'),
  ('FIELD_OPERATIONS', false, false, 'Field and installation operations'),
  ('PRICING_POLICY', false, false, 'Owner pricing policy (rulings, not vendor prices)'),
  ('ARCHITECTURE_HISTORY', false, false, 'Architecture and history references'),
  ('PROJECT_DOCUMENT', false, true, 'Project-scoped client documents'),
  ('FINANCE_RESTRICTED', true, false, 'Restricted finance material'),
  ('HR_RESTRICTED', true, false, 'Restricted HR material'),
  ('INSURANCE_RESTRICTED', true, false, 'Restricted insurance material')
on conflict (domain) do nothing;

-- --- sources ---------------------------------------------------------------

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  project_id uuid,
  domain text not null references public.knowledge_domains (domain),
  title text not null check (length(title) > 0),
  authority_class text not null
    check (authority_class in ('OFFICIAL_CURRENT','OWNER_RULED_CURRENT',
                               'INTERNAL_APPROVED','PROJECT_RECORD',
                               'CLIENT_EXECUTED','THIRD_PARTY_REFERENCE',
                               'HISTORICAL','SUPERSEDED')),
  source_version text not null default '',
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  effective_from date,
  superseded_by uuid,
  is_current boolean not null default true,
  registered_at timestamptz not null default now(),
  registered_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint knowledge_sources_project_scope
    check (domain <> 'PROJECT_DOCUMENT' or project_id is not null),
  constraint knowledge_sources_superseded_not_current
    check (superseded_by is null or is_current = false)
);

create unique index if not exists uq_knowledge_sources_sha_domain
  on public.knowledge_sources (sha256, domain);
create index if not exists idx_knowledge_sources_domain_current
  on public.knowledge_sources (domain, is_current);
create index if not exists idx_knowledge_sources_project
  on public.knowledge_sources (project_id);
create index if not exists idx_knowledge_sources_document
  on public.knowledge_sources (document_id);

-- --- chunks ----------------------------------------------------------------

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources (id),
  chunk_index integer not null check (chunk_index >= 0),
  text text not null,
  char_start integer not null check (char_start >= 0),
  char_end integer not null check (char_end >= char_start),
  token_estimate integer not null check (token_estimate >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  heading_path text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists uq_knowledge_chunks_source_index
  on public.knowledge_chunks (source_id, chunk_index);

-- --- facts (candidates -> human verification) -----------------------------

create table if not exists public.knowledge_facts (
  id uuid primary key default gen_random_uuid(),
  domain text not null references public.knowledge_domains (domain),
  project_id uuid,
  subject text not null check (length(subject) > 0),
  predicate text not null check (length(predicate) > 0),
  object text not null,
  value_json jsonb not null default '{}'::jsonb,
  criticality text not null
    check (criticality in ('informational','quote_critical',
                           'order_critical','compliance_critical')),
  state text not null default 'EXTRACTED_CANDIDATE'
    check (state in ('EXTRACTED_CANDIDATE','VERIFIED','AUTHORIZED_FOR_USE',
                     'REJECTED','SUPERSEDED')),
  citations jsonb not null,
  extracted_by text not null,
  verified_by text,
  verified_at timestamptz,
  authorized_by text,
  authorized_at timestamptz,
  supersedes_fact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_facts_citations_array
    check (jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) >= 1),
  constraint knowledge_facts_verified_requires_human
    check (state not in ('VERIFIED','AUTHORIZED_FOR_USE') or verified_by is not null),
  constraint knowledge_facts_authorized_requires_human
    check (state <> 'AUTHORIZED_FOR_USE' or authorized_by is not null)
);

create index if not exists idx_knowledge_facts_domain_state
  on public.knowledge_facts (domain, state);
create index if not exists idx_knowledge_facts_project
  on public.knowledge_facts (project_id);

-- --- owner-curated eval set -----------------------------------------------

create table if not exists public.knowledge_eval_set (
  id uuid primary key default gen_random_uuid(),
  domain text not null references public.knowledge_domains (domain),
  question text not null check (length(question) > 0),
  expected_answer text not null,
  expected_citation_source_ids uuid[] not null default '{}',
  curated_by text not null,
  created_at timestamptz not null default now()
);

-- --- RLS -------------------------------------------------------------------

alter table public.knowledge_domains enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_facts enable row level security;
alter table public.knowledge_eval_set enable row level security;

drop policy if exists knowledge_domains_owner_runtime_sel on public.knowledge_domains;
create policy knowledge_domains_owner_runtime_sel on public.knowledge_domains
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

drop policy if exists knowledge_sources_owner_runtime_sel on public.knowledge_sources;
create policy knowledge_sources_owner_runtime_sel on public.knowledge_sources
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists knowledge_sources_owner_runtime_ins on public.knowledge_sources;
create policy knowledge_sources_owner_runtime_ins on public.knowledge_sources
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists knowledge_sources_owner_upd on public.knowledge_sources;
create policy knowledge_sources_owner_upd on public.knowledge_sources
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists knowledge_chunks_owner_runtime_sel on public.knowledge_chunks;
create policy knowledge_chunks_owner_runtime_sel on public.knowledge_chunks
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists knowledge_chunks_owner_runtime_ins on public.knowledge_chunks;
create policy knowledge_chunks_owner_runtime_ins on public.knowledge_chunks
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());

drop policy if exists knowledge_facts_owner_runtime_sel on public.knowledge_facts;
create policy knowledge_facts_owner_runtime_sel on public.knowledge_facts
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists knowledge_facts_owner_runtime_ins on public.knowledge_facts;
create policy knowledge_facts_owner_runtime_ins on public.knowledge_facts
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists knowledge_facts_owner_upd on public.knowledge_facts;
create policy knowledge_facts_owner_upd on public.knowledge_facts
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists knowledge_eval_set_owner_runtime_sel on public.knowledge_eval_set;
create policy knowledge_eval_set_owner_runtime_sel on public.knowledge_eval_set
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists knowledge_eval_set_owner_ins on public.knowledge_eval_set;
create policy knowledge_eval_set_owner_ins on public.knowledge_eval_set
  for insert to authenticated
  with check (public.is_owner());
drop policy if exists knowledge_eval_set_owner_upd on public.knowledge_eval_set;
create policy knowledge_eval_set_owner_upd on public.knowledge_eval_set
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- --- grants (no anon, no delete) -------------------------------------------

revoke all on public.knowledge_domains from anon;
revoke all on public.knowledge_domains from authenticated;
grant select on public.knowledge_domains to authenticated;

revoke all on public.knowledge_sources from anon;
revoke all on public.knowledge_sources from authenticated;
grant select, insert, update on public.knowledge_sources to authenticated;

revoke all on public.knowledge_chunks from anon;
revoke all on public.knowledge_chunks from authenticated;
grant select, insert on public.knowledge_chunks to authenticated;

revoke all on public.knowledge_facts from anon;
revoke all on public.knowledge_facts from authenticated;
grant select, insert, update on public.knowledge_facts to authenticated;

revoke all on public.knowledge_eval_set from anon;
revoke all on public.knowledge_eval_set from authenticated;
grant select, insert, update on public.knowledge_eval_set to authenticated;
