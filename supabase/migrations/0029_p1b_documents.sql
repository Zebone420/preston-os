-- 0029_p1b_documents.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 1 Lane B: Project Document Registry + Google Drive binding.
-- FINAL_MASTER_BUILD_PLAN v1 sections 3.2, 5.1-5.8.
--
-- Three tables:
--   documents             - canonical registry of business documents (metadata
--                           only; the bytes stay in Google Drive, plan 3.2).
--                           NOT the same thing as public.artifacts (0027),
--                           which holds worker run outputs.
--   project_drive_folders - one Drive project folder binding per project
--                           (plan 5.1 "save Drive folder id to Supabase").
--   drive_inventory       - Stage A inventory of the historical Drive
--                           (plan 5.3): traverse + classify, never move.
--
-- RLS mirrors 0027: owner + runtime service may select/insert. UPDATE on
-- documents and drive_inventory is owner or runtime (supersession and
-- inventory status transitions are registration-pipeline writes); UPDATE on
-- project_drive_folders is owner-only (re-binding a project folder is an
-- owner decision). No delete grant anywhere: all versions remain available
-- (plan 5.7); removal is a state, never a row purge. No anon access.
--
-- Depends on: 0002 (is_owner), 0009 (projects, business_clients,
-- business_properties), 0020 (is_runtime_service).

-- ============================================================
-- 1. documents - canonical document registry (plan 5.4)
-- ============================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id),
  client_id uuid references public.business_clients (id),
  property_id uuid references public.business_properties (id),

  drive_file_id text,
  drive_parent_id text,
  source_system text not null
    check (source_system in ('drive','gmail','upload','render',
                             'docusign','vendor')),
  source_message_id text,

  document_type text not null
    check (document_type in ('intake','site_photo','measurement','plan',
      'design','product_spec','vendor_quote','quote_request','proposal',
      'contract','payment_receipt','lpc_dob_building','purchase_order',
      'order_confirmation','delivery','installation_photo','punch',
      'closeout','warranty','knowledge','other')),
  document_subtype text,
  original_filename text not null,
  canonical_filename text not null,

  mime_type text not null default 'application/octet-stream',
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes bigint not null check (file_size_bytes >= 0),

  version integer not null default 1 check (version >= 1),
  is_current boolean not null default false,
  supersedes_document_id uuid references public.documents (id),

  authority_class text not null
    check (authority_class in ('OFFICIAL_CURRENT','OWNER_RULED_CURRENT',
      'INTERNAL_APPROVED','PROJECT_RECORD','CLIENT_EXECUTED',
      'THIRD_PARTY_REFERENCE','HISTORICAL','SUPERSEDED')),
  privacy_class text not null
    check (privacy_class in ('PUBLIC_OFFICIAL','INTERNAL_APPROVED',
      'CLIENT_CONFIDENTIAL','RESTRICTED_FINANCE','RESTRICTED_HR',
      'ARCHIVE','EXCLUDE')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','rejected')),
  approved_use text,

  source_created_at timestamptz,
  source_modified_at timestamptz,
  registered_at timestamptz not null default now(),
  registered_by text not null,

  metadata jsonb not null default '{}',

  -- A superseded row can never be the current one (plan 5.7).
  constraint documents_superseded_not_current
    check (not (is_current and authority_class = 'SUPERSEDED'))
);

-- One registry row per Drive file (when the document lives in Drive).
create unique index if not exists uq_documents_drive_file_id
  on public.documents (drive_file_id)
  where drive_file_id is not null;

-- Version numbers are unique inside the (project, type, subtype) chain.
-- Subtype is part of the chain so two vendors' quotes on one project can
-- both start at V01 (plan 5.8 filename examples).
create unique index if not exists uq_documents_project_type_version
  on public.documents (project_id, document_type,
    coalesce(document_subtype, ''), version)
  where project_id is not null;

-- At most ONE current document per (project, type, subtype) chain.
create unique index if not exists uq_documents_current
  on public.documents (project_id, document_type,
    coalesce(document_subtype, ''))
  where is_current = true and project_id is not null;

create index if not exists idx_documents_project
  on public.documents (project_id, document_type);
create index if not exists idx_documents_sha256
  on public.documents (sha256);
create index if not exists idx_documents_client
  on public.documents (client_id);

alter table public.documents enable row level security;

drop policy if exists documents_owner_runtime_sel on public.documents;
create policy documents_owner_runtime_sel on public.documents
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists documents_owner_runtime_ins on public.documents;
create policy documents_owner_runtime_ins on public.documents
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists documents_owner_runtime_upd on public.documents;
create policy documents_owner_runtime_upd on public.documents
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

revoke all on public.documents from anon;
revoke all on public.documents from authenticated;
grant select, insert, update on public.documents to authenticated;

-- ============================================================
-- 2. project_drive_folders - Drive folder binding (plan 5.1)
-- ============================================================
create table if not exists public.project_drive_folders (
  project_id uuid primary key references public.projects (id),
  drive_folder_id text not null,
  folder_name text not null,
  template_version integer not null default 1
    check (template_version >= 1),
  -- subfolder name -> Drive folder id
  subfolders jsonb not null default '{}',
  created_at timestamptz not null default now(),
  created_by text not null
);

create unique index if not exists uq_project_drive_folders_folder_id
  on public.project_drive_folders (drive_folder_id);

alter table public.project_drive_folders enable row level security;

drop policy if exists project_drive_folders_owner_runtime_sel
  on public.project_drive_folders;
create policy project_drive_folders_owner_runtime_sel
  on public.project_drive_folders
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists project_drive_folders_owner_runtime_ins
  on public.project_drive_folders;
create policy project_drive_folders_owner_runtime_ins
  on public.project_drive_folders
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists project_drive_folders_owner_upd
  on public.project_drive_folders;
create policy project_drive_folders_owner_upd
  on public.project_drive_folders
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.project_drive_folders from anon;
revoke all on public.project_drive_folders from authenticated;
grant select, insert, update on public.project_drive_folders
  to authenticated;

-- ============================================================
-- 3. drive_inventory - Stage A inventory of the old Drive (plan 5.3)
-- ============================================================
create table if not exists public.drive_inventory (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  name text not null,
  mime_type text,
  parent_id text,
  path text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  modified_at timestamptz,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  -- proposed document_type / privacy_class / authority_class,
  -- confidence and reasons (classifier output, never authority)
  classification jsonb not null default '{}',
  inventory_run_id text not null,
  status text not null default 'inventoried'
    check (status in ('inventoried','classified','registered',
                      'duplicate','excluded')),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_drive_inventory_drive_file_id
  on public.drive_inventory (drive_file_id);
create index if not exists idx_drive_inventory_sha256
  on public.drive_inventory (sha256);
create index if not exists idx_drive_inventory_status
  on public.drive_inventory (status);
create index if not exists idx_drive_inventory_run
  on public.drive_inventory (inventory_run_id);

alter table public.drive_inventory enable row level security;

drop policy if exists drive_inventory_owner_runtime_sel
  on public.drive_inventory;
create policy drive_inventory_owner_runtime_sel on public.drive_inventory
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists drive_inventory_owner_runtime_ins
  on public.drive_inventory;
create policy drive_inventory_owner_runtime_ins on public.drive_inventory
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists drive_inventory_owner_runtime_upd
  on public.drive_inventory;
create policy drive_inventory_owner_runtime_upd on public.drive_inventory
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

revoke all on public.drive_inventory from anon;
revoke all on public.drive_inventory from authenticated;
grant select, insert, update on public.drive_inventory to authenticated;
