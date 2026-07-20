-- ============================================================
-- 0006_phase5g_telegram_updates.sql
-- Phase 5G: durable Telegram replay dedup.
--
-- One row per consumed Telegram update_id. The PRIMARY KEY is the dedup
-- guarantee: store.recordTelegramUpdate() inserts and treats a unique
-- violation as REPLAY, so a captured-and-replayed webhook update can never
-- be consumed twice, across restarts and instances. Written only by the
-- command-insertion activation gate (a later owner gate); the receiver route
-- itself performs no side effect and holds no database credential.
--
-- Additive-safe: new table only; policies and privileges of existing tables
-- are untouched. Owner-scoped RLS like every other runtime table; nothing
-- for anon; append-only (no update/delete privileges).
-- ============================================================

create table if not exists telegram_updates (
  update_id bigint primary key,
  correlation_id text,
  received_at timestamptz not null default now()
);

alter table telegram_updates enable row level security;

create policy telegram_updates_owner_ins on telegram_updates
  for insert to authenticated
  with check (public.is_owner());

create policy telegram_updates_owner_sel on telegram_updates
  for select to authenticated
  using (public.is_owner());

grant select, insert on telegram_updates to authenticated;
revoke update, delete on telegram_updates from authenticated;
