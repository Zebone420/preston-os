-- 0025_runtime_deployment_service_read.sql
-- OWNER-APPLIED ONLY (staging first, then production). Parity discipline.
--
-- Defect (found by the 0024 production proof, 2026-08-20 ~23:10Z):
--   P-5 p5_env_expect_deployment_env = staging on PRODUCTION.
-- submit_goal_decomposition (0018/0024) is SECURITY INVOKER and reads
-- public.runtime_deployment ('self') to stamp master_goals.environment.
-- runtime_deployment RLS (0017) is owner-only, so the non-owner runtime
-- service identity sees ZERO rows, v_env is null, and the 0018 fallback
-- stamps 'staging' - on production that goal then trips the dispatcher's
-- deployment-equality invariant (fail-closed, but every runtime-composed
-- goal would refuse to run).
--
-- Fix: ONE additional SELECT-only policy admitting is_runtime_service().
--   - owner policy (runtime_deployment_owner, FOR ALL) unchanged
--   - runtime gets SELECT only: no insert/update/delete path (the 0017
--     grant surface is unchanged; policies are permissive-OR so the
--     runtime still has no write policy)
--   - no function, definer, approval, system_controls, 0022/0023 change
-- Rollback: reports/p2_evidence/rollback/rollback_0025.sql.txt

drop policy if exists runtime_deployment_runtime_read
  on public.runtime_deployment;
create policy runtime_deployment_runtime_read on public.runtime_deployment
  for select using (public.is_runtime_service());
