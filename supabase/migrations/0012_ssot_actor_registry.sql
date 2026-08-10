-- 0012_ssot_actor_registry.sql
-- Central SSOT B2: per-actor authenticated identity registry.
-- OWNER-APPLIED ONLY. Staging first; never production in this phase.
--
-- Purpose: replace self-declared source strings with authenticated actor
-- identity (docs/PRESTON_CENTRAL_SSOT_DESIGN_v1.md section 4). Each remote
-- actor (chatgpt, claude, codex, hermes, owner_remote) gets one row whose
-- bearer token is stored ONLY as a sha256 hash (0011 idiom). Actors are
-- disabled by default; enabling one is an owner action. This migration
-- grants NO new write capability to any actor: the resolver only answers
-- "which enabled actor presented this token". Read/write surfaces that
-- consume it (SSOT B3+) are separate, disabled-by-default gates.
--
-- Depends on 0001 (pgcrypto in extensions schema), 0002 (is_owner).
-- pgcrypto NOTE: digest() lives in schema extensions on this project;
-- always call extensions.digest(...) (cf62fdb lesson, 2026-08-09).

create table if not exists actor_registry (
  actor_id text primary key
    check (actor_id ~ '^[a-z][a-z0-9_-]{2,40}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 80),
  actor_role text not null
    check (actor_role in
      ('owner_remote', 'chatgpt', 'claude', 'codex', 'hermes')),
  token_hash text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table actor_registry enable row level security;

drop policy if exists actor_registry_owner on actor_registry;
create policy actor_registry_owner on actor_registry
  for all using (public.is_owner()) with check (public.is_owner());

revoke all on actor_registry from anon;
grant select, insert, update on actor_registry to authenticated;
revoke delete on actor_registry from authenticated;

-- --- resolver (SECURITY DEFINER; authentication only, no data access) -----
-- Answers which ENABLED actor presented the token; stamps last_seen_at.
-- Returns forbidden for unknown/disabled/empty-hash rows. Grants callers
-- NOTHING beyond that answer: no table read, no write, no state.

create or replace function public.resolve_ssot_actor(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row actor_registry%rowtype;
begin
  if coalesce(p_token, '') = '' then
    return jsonb_build_object('ok', false, 'status', 'forbidden');
  end if;
  select * into v_row from actor_registry
    where enabled
      and token_hash <> ''
      and token_hash =
        encode(extensions.digest(p_token, 'sha256'), 'hex')
    limit 1;
  if v_row is null then
    return jsonb_build_object('ok', false, 'status', 'forbidden');
  end if;
  update actor_registry set last_seen_at = now()
    where actor_id = v_row.actor_id;
  return jsonb_build_object(
    'ok', true,
    'actor_id', v_row.actor_id,
    'actor_role', v_row.actor_role
  );
end;
$$;

revoke all on function public.resolve_ssot_actor(text) from public;
grant execute on function public.resolve_ssot_actor(text)
  to anon, authenticated;
