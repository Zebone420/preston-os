# Phase 2 Stage 10 - AI-OS Core Migration Owner-Run Packet

Status: OWNER-RUN packet. Documentation ONLY. The AI did NOT execute any SQL,
did not connect to Supabase, and did not change any database. This packet
applies migration 0003_phase2_ai_os_core.sql (the distributed operating-state
schema) to STAGING. Non-executing: creating these tables activates no worker,
no Hermes, no execution.

## 0. Hard-stop safety rules

- STAGING only. Never production.
- Do NOT disable RLS. Do NOT grant to anon. Do NOT add the service-role key to
  the app.
- Do NOT re-run 0001/0002. This migration is additive (new tables only) and
  depends on 0002's public.is_owner().
- Keep agent_memory and os_events append-only (the migration revokes
  update/delete on them - leave that).

## 1. What it creates

Owner-only (RLS via public.is_owner()) tables:
- agents (AI registry), locks (distributed locks), execution_queue (pipeline)
  - mutable, owner-all.
- agent_memory (shared memory), os_events (event log) - append-only
  (insert+select; update/delete revoked).
Nothing is granted to anon. execution_queue.execution_enabled defaults false
(fail-closed).

## 2. Preflight (read-only)

Confirm 0002 is applied (is_owner exists) and these tables do not yet exist:

    select proname from pg_proc where proname = 'is_owner';
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('agents','agent_memory','locks','execution_queue','os_events')
    order by table_name;

Expect: is_owner present; the five tables ABSENT (first run).

## 3. Apply

- [ ] Supabase SQL editor (STAGING): paste the full contents of
      supabase/migrations/0003_phase2_ai_os_core.sql and run once.
- [ ] Expect success, no errors.

## 4. Verify

    -- tables + RLS on
    select relname, relrowsecurity from pg_class
    where relname in ('agents','agent_memory','locks','execution_queue','os_events');
    -- policies owner-only
    select tablename, policyname, cmd from pg_policies
    where schemaname='public'
      and tablename in ('agents','agent_memory','locks','execution_queue','os_events')
    order by tablename;
    -- append-only: no update/delete grant for authenticated on these
    select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee='authenticated'
      and table_name in ('agent_memory','os_events') order by table_name, privilege_type;

Expect: rls on for all five; owner-only policies; agent_memory/os_events show
only SELECT + INSERT for authenticated (no UPDATE/DELETE).

## 5. Optional - seed the agent registry (owner-run)

    insert into agents (id, display_name, provider, model, capabilities, allowed_connectors, owner)
    values
      ('claude-code','Claude Code','anthropic','claude-opus-4-8',
        array['code','review','docs'], array['github'], 'info@preston.nyc'),
      ('chatgpt','ChatGPT','openai','gpt','{}', '{}', 'info@preston.nyc'),
      ('hermes','Hermes','preston','orchestrator','{}', '{}', 'info@preston.nyc')
    on conflict (id) do nothing;

(Adjust capabilities/connectors per least privilege. Hermes stays disabled -
seeding a registry row does not activate anything.)

## 6. Rollback

Additive and safe to drop (staging holds no business data here yet):

    drop table if exists os_events, execution_queue, locks, agent_memory, agents cascade;

No effect on existing Phase 0-1 tables.

## 7. Statement of non-execution

The AI did NOT run this SQL, connect to Supabase, or change any database. All
steps are owner-run against STAGING. Applying the schema activates no worker,
no Hermes, and no execution; execution_enabled defaults false and the code
pipeline is fail-closed.
