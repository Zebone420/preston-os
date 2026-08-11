-- 0016_actor_role_n8n.sql
-- DRAFT - OWNER-APPLIED ONLY at the n8n activation gate (not P1).
-- Adds 'n8n' to the actor_registry role CHECK so the n8n-1 integration
-- identity can exist. Grants NOTHING: enabling n8n-1, minting its token,
-- and any workflow surface remain separate owner gates. Also widens the
-- tasks.requested_by parity note: tasks already allows 'n8n' (0001).
--
-- Re-run-safe: drops and recreates the named CHECK constraint only.

alter table actor_registry
  drop constraint if exists actor_registry_actor_role_check;
alter table actor_registry
  add constraint actor_registry_actor_role_check
    check (actor_role in
      ('owner_remote', 'chatgpt', 'claude', 'codex', 'hermes', 'n8n'));
