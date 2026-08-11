\set ON_ERROR_STOP on
insert into actor_registry (actor_id, display_name, actor_role, token_hash, enabled) values ('claude-1', 'Claude', 'claude', '2fc3d85010e14de512805897b95cb4bdadf89707e33cc7a78d6f53e44bf54251', true) on conflict (actor_id) do update set token_hash = excluded.token_hash, enabled = excluded.enabled;
select actor_id, actor_role, enabled, length(token_hash) as hash_len, left(token_hash, 8) as hash_prefix from actor_registry order by actor_id;
select id, enabled, length(token_hash) as hash_len, left(token_hash, 8) as hash_prefix from remote_intake_config;
