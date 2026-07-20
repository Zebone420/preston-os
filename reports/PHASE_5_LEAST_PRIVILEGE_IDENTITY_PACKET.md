# Phase 5H - Least-Privilege Runtime Identity Packet (owner-run; SEPARATE gate)

OWNER-RUN. Do NOT apply during the Phase 5 staging drills - this is the
identity-hardening gate that comes AFTER the laptop-closed job drill passes on
the owner-allowlisted scheme. The AI authored the migration but did not apply
it or touch any identity.

Goal: replace the owner-equivalent staging service identities with bounded
'worker' and 'hermes' roles. After this gate, a compromised worker token is
limited to the control-plane surface its role needs: it cannot flip execution
on (policy-pinned execution_enabled=false), cannot write system_controls,
cannot touch approvals/owners/audit/business tables, cannot send anything.

SCOPING HONESTY (accepted, documented): the write policies are ROLE-level,
not row-level - a compromised worker identity could update any os_jobs row's
non-execution fields, expire any lease row, or overwrite agents-registry
metadata (there is no auth-user->agent-id binding to scope on). The code-level
CAS fences still hold for legitimate concurrency, execution remains globally
disabled, and this is staging-only. Row-level scoping is a future hardening
item, not part of this gate.

## 1. Apply (Supabase SQL editor, STAGING)

Paste supabase/migrations/0007_phase5h_runtime_roles.sql (additive: one table,
one function, read+write policies for the two roles; existing owner policies
untouched; static tests: apps/dashboard/test/migrations-phase5.test.ts).

## 2. Create the two runtime auth users and register their roles

Dashboard: Authentication -> Users -> create runtime-worker@preston.nyc and
runtime-hermes@preston.nyc (strong passwords, auto-confirm). Then:

    insert into runtime_roles (user_id, role)
      select id, 'worker' from auth.users where email='runtime-worker@preston.nyc'
      on conflict do nothing;
    insert into runtime_roles (user_id, role)
      select id, 'hermes' from auth.users where email='runtime-hermes@preston.nyc'
      on conflict do nothing;

CRITICAL: do NOT insert these users into public.owners. Verify:

    select u.email, r.role, (o.user_id is not null) as is_owner_MUST_BE_FALSE
    from auth.users u
    join runtime_roles r on r.user_id = u.id
    left join public.owners o on o.user_id = u.id;

## 3. Verification SQL (deny/permit matrix)

Run each block impersonating the identity (dashboard SQL editor "run as" is
not available - instead sign in as the identity via the token mint procedure
in PHASE_4B1 packet section C/D pattern, or verify post-cutover from the host
via db-health + one drill job). Minimum owner-verifiable checks now:

    -- role function resolves:
    select public.runtime_role();           -- as owner: null (owner has no runtime role)
    -- policies exist and are select-only on system_controls for runtime roles:
    select policyname, cmd from pg_policies
      where tablename = 'system_controls';
    -- expect: the original owner policy/policies PLUS system_controls_runtime_sel
    -- with cmd = SELECT, and NOTHING granting runtime roles INSERT/UPDATE/ALL

Post-cutover behavioral checks (the real proof):
    - db-health as the worker identity: PASS (system_controls readable).
    - one 5E drill job completes end-to-end under the worker role.
    - as the worker identity, `update system_controls set execution_enabled=true`
      -> 0 rows / RLS denial. (Never run this as the owner.)

## 4. Cutover (host, per service)

1. Mint refresh tokens for the two new identities (PHASE_4B1 packet steps C-E,
   substituting the new emails) into NEW token stores:
   /var/lib/preston/worker/token-lp.json, /var/lib/preston/hermes/token-lp.json.
2. Edit /etc/preston/worker.env + hermes.env: point
   SUPABASE_RUNTIME_TOKEN_STORE at the new store files. Re-bootstrap each
   (`db-health --bootstrap` as the service user), then remove the env refresh
   tokens.
3. `sudo bash deploy/preflight-health.sh` (both identities) -> PASS.
4. Revoke the OLD owner-allowlisted service identities: delete their sessions
   in the dashboard and shred the old token store files.

## 5. Rollback SQL (owner-run, only if the cutover fails)

    drop policy if exists system_controls_runtime_sel on system_controls;
    drop policy if exists os_jobs_runtime_sel on os_jobs;
    drop policy if exists agents_runtime_sel on agents;
    drop policy if exists worker_leases_worker_sel on worker_leases;
    drop policy if exists job_checkpoints_worker_sel on job_checkpoints;
    drop policy if exists runtime_command_packets_hermes_sel on runtime_command_packets;
    drop policy if exists os_jobs_worker_upd on os_jobs;
    drop policy if exists worker_leases_worker_ins on worker_leases;
    drop policy if exists worker_leases_worker_upd on worker_leases;
    drop policy if exists job_attempts_worker_ins on job_attempts;
    drop policy if exists job_checkpoints_worker_ins on job_checkpoints;
    drop policy if exists dead_letters_worker_ins on dead_letters;
    drop policy if exists orchestration_decisions_hermes_ins on orchestration_decisions;
    drop policy if exists os_events_hermes_ins on os_events;
    drop policy if exists agents_runtime_ins on agents;
    drop policy if exists agents_runtime_upd on agents;
    drop function if exists public.runtime_role();
    drop table if exists runtime_roles;

Then point the env files back at the old token stores and re-bootstrap the old
identities. (Owner RLS was never modified, so owner access is unaffected
throughout.)

## 6. Acceptance tests (already in the repo)

- apps/dashboard/test/migrations-phase5.test.ts pins: role check constraint,
  security-definer + pinned search_path, the system_controls READ policy (the
  audited H2 fix), the execution_enabled=false pin on the worker's os_jobs
  update policy, worker/hermes separation, no grants beyond runtime_roles,
  additive-only.
- Post-cutover, the 5F drill suite (D1-D12) must pass unchanged under the new
  identities - that is the acceptance bar for this gate.
