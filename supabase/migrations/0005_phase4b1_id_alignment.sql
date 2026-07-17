-- ============================================================
-- 0005_phase4b1_id_alignment.sql
-- Phase 4B.1 audit fix: align append-only log id columns with the
-- runtime's deterministic string ids.
--
-- The runtime supplies DETERMINISTIC, IDEMPOTENT ids and relies on
-- primary-key uniqueness for replay dedup (appendRow treats a unique
-- violation as an idempotent duplicate):
--   job_attempts            id = 'att::<job>::<attempt_no>::<lease_token>'
--   orchestration_decisions id = 'od-<job>'
--   os_events               id = 'ev-od-<job>' (and other 'ev-*' ids)
--   dead_letters / agent_memory / execution_queue adapters likewise
--     REQUIRE a caller-supplied string id (same contract, not yet wired).
--
-- These columns were `uuid`, so every such insert fails 22P02 on a real
-- database (masked in unit tests by the fake client). uuid -> text is
-- non-destructive (existing values preserved via cast). No foreign key
-- references any of these id columns. RLS policies, grants, and the
-- append-only revokes from 0003/0004 are untouched. os_jobs.id and
-- runtime_command_packets.id stay uuid (runtime uses crypto.randomUUID()
-- there, and they are FK targets).
-- Additive-safe: nothing is removed; policies and privileges are untouched.
-- ============================================================

alter table job_attempts alter column id drop default;
alter table job_attempts alter column id type text using id::text;
alter table job_attempts alter column id set default gen_random_uuid()::text;

alter table orchestration_decisions alter column id drop default;
alter table orchestration_decisions alter column id type text using id::text;
alter table orchestration_decisions alter column id set default gen_random_uuid()::text;

alter table os_events alter column id drop default;
alter table os_events alter column id type text using id::text;
alter table os_events alter column id set default gen_random_uuid()::text;

alter table dead_letters alter column id drop default;
alter table dead_letters alter column id type text using id::text;
alter table dead_letters alter column id set default gen_random_uuid()::text;

alter table agent_memory alter column id drop default;
alter table agent_memory alter column id type text using id::text;
alter table agent_memory alter column id set default gen_random_uuid()::text;

alter table execution_queue alter column id drop default;
alter table execution_queue alter column id type text using id::text;
alter table execution_queue alter column id set default gen_random_uuid()::text;
