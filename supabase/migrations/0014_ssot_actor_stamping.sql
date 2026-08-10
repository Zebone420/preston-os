-- 0014_ssot_actor_stamping.sql
-- Central SSOT B4: authenticated actor attribution on remote intake.
-- OWNER-APPLIED ONLY. Staging first; never production in this phase.
-- Apply ORDER: 0012 -> 0013 -> 0014 (this depends on resolve_ssot_actor).
--
-- Purpose (design docs/PRESTON_CENTRAL_SSOT_DESIGN_v1.md section 4):
-- identity must be AUTHENTICATED, never self-declared. This migration
-- (1) adds a nullable actor_id column to remote_intake_requests and
-- (2) replaces submit_remote_intake so a caller whose bearer token
-- resolves to an ENABLED actor_registry row is accepted and STAMPED
-- with that actor_id. The legacy global REMOTE_INTAKE_TOKEN path is
-- preserved byte-for-byte (its rows stamp actor_id null). The caller-
-- supplied p_source stays a HINT bounded by its CHECK; actor_id is the
-- authoritative identity whenever present.
--
-- NON-ACTIVATING: every actor row starts disabled with an empty hash
-- (0012), so until SSOT B5 mints and enables a token, resolution always
-- returns forbidden and behavior is IDENTICAL to 0011. No RLS change,
-- no grant change, no read-path change.

alter table remote_intake_requests
  add column if not exists actor_id text;

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
  v_actor jsonb;
  v_actor_id text := null;
  v_global_ok boolean := false;
begin
  select * into v_cfg from remote_intake_config where id = 'global';
  if v_cfg is null or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'status', 'disabled');
  end if;

  -- Auth leg 1: legacy global token (0011 semantics, unchanged).
  v_global_ok :=
    coalesce(v_cfg.token_hash, '') <> ''
    and encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      = v_cfg.token_hash;

  -- Auth leg 2: per-actor token (0012 resolver; single hashing path).
  if not v_global_ok then
    v_actor := public.resolve_ssot_actor(p_token);
    if coalesce((v_actor->>'ok')::boolean, false) then
      v_actor_id := v_actor->>'actor_id';
    end if;
  end if;

  if not v_global_ok and v_actor_id is null then
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
      (request_id, source, owner_identity, raw_request, actor_id)
    values
      (p_request_id, p_source, lower(trim(p_owner_identity)),
       p_raw_request, v_actor_id);
  exception when unique_violation then
    return jsonb_build_object(
      'ok', true, 'status', 'duplicate', 'request_id', p_request_id);
  end;

  return jsonb_build_object(
    'ok', true, 'status', 'accepted', 'request_id', p_request_id,
    'actor_id', v_actor_id);
end;
$$;

revoke all on function public.submit_remote_intake(text, text, text, text, text)
  from public;
grant execute on function public.submit_remote_intake(text, text, text, text, text)
  to anon, authenticated;
