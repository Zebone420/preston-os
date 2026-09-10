-- 0031_p1d_communications_intelligence.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 1 LANE D: READ-ONLY Gmail import + Deal Intelligence.
-- Master build plan v1 sections 3.4, 7.1-7.11, 8.1-8.4.
--
-- Four tables:
--   mailbox_identities     alias registry (plan 7.10). The outbound sender is
--                          picked by a pure function over this table; an LLM
--                          never chooses a sender address.
--   communication_messages one row per imported Gmail message (references +
--                          structured facts). body_text is NEVER stored for
--                          ingestion_class = 'DROP' (OTP, password reset,
--                          security alerts, auth links, promo noise); for the
--                          other classes it is bounded to 20k chars after
--                          neutralizeUntrusted. Message bodies are DATA only
--                          (CLAUDE.md rule 12), never instruction authority.
--   communication_events   parsed, deterministic provider events (Andersen,
--                          Home Depot, DocuSign, Google Voice, bounces,
--                          vendor quotes, commitments). Payload = parsed
--                          fields only, never the raw body.
--   attention_items        Deal Intelligence findings from the 12 detectors.
--                          Every row carries evidence; dedupe_key makes
--                          detector re-runs idempotent.
--
-- Nothing here enables sending. No send state exists in any table.
--
-- RLS: owner + runtime service may select/insert (the runtime imports and
-- detects; the owner reads through Preston Control). UPDATE is limited to
-- the owner except attention_items where the runtime may refresh
-- last_seen_at. No delete grant on any table; anon fully revoked.
--
-- Depends on: 0002 (is_owner), 0009 (projects), 0020 (is_runtime_service).
-- Rollback: owner packet (remove the four tables in reverse order).

-- ============================================================
-- 1. mailbox_identities - alias registry (plan 7.10)
-- ============================================================
create table if not exists public.mailbox_identities (
  id uuid primary key default gen_random_uuid(),
  mailbox_identity text not null,
  email_address text not null unique,
  role text not null
    check (role in ('primary','send_as_alias','vendor_facing','legacy')),
  active boolean not null default true,
  canonical_sender boolean not null default false,
  allowed_send_classes text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_mailbox_identities_mailbox
  on public.mailbox_identities (mailbox_identity, active);

-- ============================================================
-- 2. communication_messages - imported message references + facts
-- ============================================================
create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gmail' check (provider in ('gmail')),
  provider_message_id text not null unique,
  provider_thread_id text,
  mailbox_identity text not null,
  direction text not null check (direction in ('inbound','outbound')),
  from_address_norm text not null default '',
  to_addresses_norm text[] not null default '{}',
  cc_norm text[] not null default '{}',
  subject text not null default '',
  snippet text not null default '' check (char_length(snippet) <= 500),
  received_at timestamptz not null,
  has_attachments boolean not null default false,
  attachment_manifest jsonb not null default '[]',
  ingestion_class text not null
    check (ingestion_class in
      ('INCLUDE_PROJECT','EVENT_ONLY','FINANCE_RESTRICTED','DROP')),
  drop_reason text,
  -- body_text is null for DROP rows (never stored) and bounded otherwise.
  body_text text
    check (char_length(body_text) <= 20000),
  project_id uuid references public.projects (id),
  link_confidence text not null default 'orphan'
    check (link_confidence in
      ('orphan','candidate','linked_auto','confirmed')),
  link_signal text not null default '',
  imported_at timestamptz not null default now(),
  import_run_id text not null,
  constraint communication_messages_drop_has_no_body
    check (ingestion_class <> 'DROP' or body_text is null),
  constraint communication_messages_drop_has_reason
    check (ingestion_class <> 'DROP' or drop_reason is not null)
);
create index if not exists idx_communication_messages_thread
  on public.communication_messages (provider_thread_id, received_at);
create index if not exists idx_communication_messages_project
  on public.communication_messages (project_id, received_at);
create index if not exists idx_communication_messages_class
  on public.communication_messages (ingestion_class, received_at desc);

-- ============================================================
-- 3. communication_events - parsed provider events
-- ============================================================
create table if not exists public.communication_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.communication_messages (id),
  event_type text not null
    check (event_type in (
      'andersen_lead_new','andersen_lead_reminder','andersen_status_nudge',
      'hd_case_submitted','hd_quote_received','hd_quote_revised',
      'hd_receipt','hd_order_status','vendor_quote_received',
      'docusign_sent','docusign_completed','docusign_voided',
      'voice_sms','voice_missed_call','delivery_failed',
      'client_status_request','commitment_detected')),
  payload jsonb not null default '{}',
  project_id uuid references public.projects (id),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (message_id, event_type)
);
create index if not exists idx_communication_events_type
  on public.communication_events (event_type, occurred_at desc);
create index if not exists idx_communication_events_project
  on public.communication_events (project_id, occurred_at desc);

-- ============================================================
-- 4. attention_items - Deal Intelligence findings (plan 8.1-8.3)
-- ============================================================
create table if not exists public.attention_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null
    check (item_type in
      ('OUR_COMMITMENT','WAITING_ON','RISK','OPPORTUNITY')),
  detector text not null
    check (detector in (
      'inbound_unanswered','first_response_lag','quote_follow_up_overdue',
      'stale_quote','stale_negotiation','andersen_deadline_breach',
      'orphan_communication','commitment_due','bounced_email',
      'vendor_quote_no_return','delivery_status_overdue',
      'client_update_unanswered')),
  project_id uuid references public.projects (id),
  subject text not null,
  source_system text not null,
  source_ref text not null,
  evidence jsonb not null
    check (jsonb_typeof(evidence) = 'array'
      and jsonb_array_length(evidence) >= 1),
  confidence text not null check (confidence in ('high','medium','low')),
  suggested_action text not null,
  due_at timestamptz,
  status text not null default 'open'
    check (status in ('open','acknowledged','resolved','suppressed')),
  dedupe_key text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists idx_attention_items_status
  on public.attention_items (status, last_seen_at desc);
create index if not exists idx_attention_items_project
  on public.attention_items (project_id, status);

-- ============================================================
-- RLS (0027 pattern): owner + runtime select/insert; owner update
-- (attention_items: runtime may also update to refresh last_seen_at
-- and to write detector-side status transitions under CAS). No
-- delete policy or grant anywhere. anon fully revoked.
-- ============================================================

alter table public.mailbox_identities enable row level security;
drop policy if exists mailbox_identities_owner_runtime_sel
  on public.mailbox_identities;
create policy mailbox_identities_owner_runtime_sel
  on public.mailbox_identities
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists mailbox_identities_owner_ins
  on public.mailbox_identities;
create policy mailbox_identities_owner_ins on public.mailbox_identities
  for insert to authenticated
  with check (public.is_owner());
drop policy if exists mailbox_identities_owner_upd
  on public.mailbox_identities;
create policy mailbox_identities_owner_upd on public.mailbox_identities
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

alter table public.communication_messages enable row level security;
drop policy if exists communication_messages_owner_runtime_sel
  on public.communication_messages;
create policy communication_messages_owner_runtime_sel
  on public.communication_messages
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists communication_messages_owner_runtime_ins
  on public.communication_messages;
create policy communication_messages_owner_runtime_ins
  on public.communication_messages
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists communication_messages_owner_upd
  on public.communication_messages;
create policy communication_messages_owner_upd
  on public.communication_messages
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

alter table public.communication_events enable row level security;
drop policy if exists communication_events_owner_runtime_sel
  on public.communication_events;
create policy communication_events_owner_runtime_sel
  on public.communication_events
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists communication_events_owner_runtime_ins
  on public.communication_events;
create policy communication_events_owner_runtime_ins
  on public.communication_events
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists communication_events_owner_upd
  on public.communication_events;
create policy communication_events_owner_upd
  on public.communication_events
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

alter table public.attention_items enable row level security;
drop policy if exists attention_items_owner_runtime_sel
  on public.attention_items;
create policy attention_items_owner_runtime_sel on public.attention_items
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists attention_items_owner_runtime_ins
  on public.attention_items;
create policy attention_items_owner_runtime_ins on public.attention_items
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists attention_items_owner_runtime_upd
  on public.attention_items;
create policy attention_items_owner_runtime_upd on public.attention_items
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- Privilege hardening: strip Supabase default privileges. anon gets
-- nothing; authenticated gets select/insert/update only (no delete).
revoke all on public.mailbox_identities from anon;
revoke all on public.mailbox_identities from authenticated;
grant select, insert, update on public.mailbox_identities to authenticated;

revoke all on public.communication_messages from anon;
revoke all on public.communication_messages from authenticated;
grant select, insert, update on public.communication_messages
  to authenticated;

revoke all on public.communication_events from anon;
revoke all on public.communication_events from authenticated;
grant select, insert, update on public.communication_events
  to authenticated;

revoke all on public.attention_items from anon;
revoke all on public.attention_items from authenticated;
grant select, insert, update on public.attention_items to authenticated;
