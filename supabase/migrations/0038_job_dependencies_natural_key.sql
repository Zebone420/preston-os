-- 0038: natural key for job_dependencies (D2-L1).
--
-- A same-state re-persist used to duplicate dependency edges because the
-- table has a random-uuid primary key and no natural key. The application
-- skips edges already present since e6bcefe; this index makes the database
-- refuse a duplicate edge outright, so idempotency no longer depends on a
-- single writer. Additive and idempotent. It fails loudly if duplicate edges
-- already exist (none expected: the duplicating path was unreachable from
-- the form) - resolve such rows by hand with evidence before re-running,
-- never by silent dedupe inside a migration.

create unique index if not exists uq_job_dependencies_edge
  on public.job_dependencies (goal_id, job_id, depends_on_job_id);
