-- 0011_phase8_remote_intake.sql
-- Phase 8 Remote Operations V1: durable remote intake gateway.
-- OWNER-APPLIED ONLY. Staging first; never production in this phase.
--
-- Purpose: the Vercel web tier has NO database identity on cookie-less
-- server-to-server calls (the documented ChatGPT connector circularity), so
-- remote goal submission lands here instead: a narrow SECURITY DEFINER
-- gateway that authenticates a caller-presented token against a stored
-- sha256 hash and INSERTS one bounded request row. Nothing else is granted.
-- The staging HOST runtime (owner identity, RLS-bound) consumes pending
-- rows through the proven composer pipeline (validation, risk policy,
-- approval gating) - the gateway itself decides NOTHING and executes
-- NOTHING. Requests are data, never instruction authority.
--
-- Depends on 0001 (pgcrypto), 0002 (is_owner), 0010 (orchestration graph).
-- Does NOT depend on 0007/0008 (both unapplied).

-- --- config (single row, owner-managed; the definer functions read it) ----

create table if not exists remote_intake_config (
  id text primary key default 'global' check (id = 'global'),
  token_hash text not null default '',
  enabled boolean not null default false,
  max_pending integer not null default 10
    check (max_pending >= 1 and max_pending <= 100),
  updated_at timestamptz not null default now()
);

alter table remote_intake_config enable row level security;

drop policy if exists remote_intake_config_owner on remote_intake_config;
create policy remote_intake_config_owner on remote_intake_config
  for all using (public.is_owner()) with check (public.is_owner());

revoke all on remote_intake_config from anon;
grant select, insert, update on remote_intake_config to authenticated;
revoke delete on remote_intake_config from authenticated;

insert into remote_intake_config (id) values ('global')
  on conflict (id) do nothing;

-- --- requests (append + owner-managed consumption; never deleted) ---------

create table if not exists remote_intake_requests (
  request_id text primary key
    check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$'),
  source text not null default 'chatgpt'
    check (source in ('chatgpt', 'phone', 'api')),
  owner_identity text not null
    check (char_length(owner_identity) between 3 and 320),
  raw_request text not null
    check (char_length(raw_request) between 1 and 8000),
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'rejected')),
  reject_reason text,
  goal_ids jsonb not null default '[]',
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter table remote_intake_requests enable row level security;

drop policy if exists remote_intake_requests_owner on remote_intake_requests;
create policy remote_intake_requests_owner on remote_intake_requests
  for all using (public.is_owner()) with check (public.is_owner());

revoke all on remote_intake_requests from anon;
grant select, insert, update on remote_intake_requests to authenticated;
revoke delete on remote_intake_requests from authenticated;

create index if not exists idx_remote_intake_requests_status_created
  on remote_intake_requests (status, created_at);

-- --- submit gateway (SECURITY DEFINER; the ONLY anonymous write path) -----
-- Token never stored or logged: compared as sha256 hex against config.
-- Backpressure: refuses when max_pending pending rows already exist.
-- Idempotent: a duplicate request_id returns duplicate, never two rows.

create or replace function public.submit_remote_intake(
  p_token text,
  p_request_id text,
  p_owner_identity text,
  p_raw_request text,
  p_source text default 'chatgpt'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg remote_intake_config%rowtype;
  v_pending integer;
begin
  select * into v_cfg from remote_intake_config where id = 'global';
  if v_cfg is null or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'status', 'disabled');
  end if;
  if coalesce(v_cfg.token_hash, '') = '' or
     encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
       is distinct from v_cfg.token_hash then
    return jsonb_build_object('ok', false, 'status', 'forbidden');
  end if;
  if p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$' then
    return jsonb_build_object('ok', false, 'status', 'invalid_request_id');
  end if;
  if coalesce(p_raw_request, '') = ''
     or char_length(p_raw_request) > 8000 then
    return jsonb_build_object('ok', false, 'status', 'invalid_request');
  end if;
  if char_length(coalesce(p_owner_identity, '')) not between 3 and 320 then
    return jsonb_build_object('ok', false, 'status', 'invalid_owner');
  end if;
  if p_source not in ('chatgpt', 'phone', 'api') then
    return jsonb_build_object('ok', false, 'status', 'invalid_source');
  end if;

  select count(*) into v_pending
    from remote_intake_requests where status = 'pending';
  if v_pending >= v_cfg.max_pending then
    return jsonb_build_object('ok', false, 'status', 'backpressure');
  end if;

  begin
    insert into remote_intake_requests
      (request_id, source, owner_identity, raw_request)
    values
      (p_request_id, p_source, lower(trim(p_owner_identity)), p_raw_request);
  exception when unique_violation then
    return jsonb_build_object(
      'ok', true, 'status', 'duplicate', 'request_id', p_request_id);
  end;

  return jsonb_build_object(
    'ok', true, 'status', 'accepted', 'request_id', p_request_id);
end;
$$;

revoke all on function public.submit_remote_intake(text, text, text, text, text)
  from public;
grant execute on function public.submit_remote_intake(text, text, text, text, text)
  to anon, authenticated;

-- --- status gateway (SECURITY DEFINER; bounded read-only projection) ------
-- Returns the request row plus a BOUNDED projection of its goals, jobs,
-- evidence refs, and open approvals - everything a remote caller needs to
-- follow progress and know when an owner approval is pending. Never returns
-- secrets, tokens, or unrelated rows.

create or replace function public.read_remote_intake_status(
  p_token text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg remote_intake_config%rowtype;
  v_req remote_intake_requests%rowtype;
  v_goals jsonb := '[]'::jsonb;
begin
  select * into v_cfg from remote_intake_config where id = 'global';
  if v_cfg is null or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'status', 'disabled');
  end if;
  if coalesce(v_cfg.token_hash, '') = '' or
     encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
       is distinct from v_cfg.token_hash then
    return jsonb_build_object('ok', false, 'status', 'forbidden');
  end if;

  select * into v_req from remote_intake_requests
    where request_id = p_request_id;
  if v_req is null then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  select coalesce(jsonb_agg(g_obj order by g_obj->>'goal_id'), '[]'::jsonb)
    into v_goals
  from (
    select jsonb_build_object(
      'goal_id', mg.id,
      'title', left(mg.title, 200),
      'status', mg.status,
      'jobs', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'job_id', gj.id,
          'kind', gj.kind,
          'title', left(gj.title, 200),
          'status', gj.status,
          'attempts', gj.attempts,
          'requires_approval', gj.requires_approval,
          'failure_reason', left(coalesce(gj.failure_reason, ''), 300),
          'evidence_refs', gj.evidence_refs
        ) order by gj.created_at), '[]'::jsonb)
        from (select * from goal_jobs
                where goal_id = mg.id
                order by created_at limit 20) gj
      ),
      'open_approvals', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'approval_id', oa.approval_id,
          'job_id', oa.job_id,
          'status', oa.status,
          'expires_at', oa.expires_at
        ) order by oa.created_at), '[]'::jsonb)
        from (select * from orchestration_approvals
                where goal_id = mg.id and status = 'pending'
                order by created_at limit 10) oa
      )
    ) as g_obj
    from master_goals mg
    where mg.id::text in (
      select jsonb_array_elements_text(v_req.goal_ids)
    )
    limit 5
  ) goals_bounded;

  return jsonb_build_object(
    'ok', true,
    'status', v_req.status,
    'request_id', v_req.request_id,
    'reject_reason', v_req.reject_reason,
    'created_at', v_req.created_at,
    'consumed_at', v_req.consumed_at,
    'goals', v_goals
  );
end;
$$;

revoke all on function public.read_remote_intake_status(text, text)
  from public;
grant execute on function public.read_remote_intake_status(text, text)
  to anon, authenticated;
