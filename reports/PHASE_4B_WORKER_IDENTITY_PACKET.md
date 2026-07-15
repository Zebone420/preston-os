# Phase 4B - Worker/Hermes Identity, RLS, Token & Guard Packet

OWNER-RUN packet. Documentation ONLY. The AI did NOT create identities, run SQL,
change RLS, provision tokens, install/enable services, or edit the safety guard.
Everything is owner-run against STAGING; execution/Hermes/runner stay disabled.

## 1. Token bootstrap + durable store (IMPLEMENTED; behavior owner must honor)

Code: src/os-runtime/{supabase-runtime,bin}.ts (resolveWorkerToken + fileTokenStore).
- SERVICE mode (worker-loop / hermes-loop / db-health) REQUIRES
  SUPABASE_RUNTIME_TOKEN_STORE. Static-access-token-only service operation is
  refused. A static token is allowed ONLY with `--diagnostic` (local check).
- Bootstrap: on an empty store, the env SUPABASE_RUNTIME_REFRESH_TOKEN is used
  ONCE, refreshed, and the ROTATED token is persisted to the store. Thereafter
  the store token wins and the env token is IGNORED (a consumed bootstrap token
  is never reused).
- Store security (fileTokenStore): refuses a symlink, refuses group/other
  permissions, single-writer O_EXCL lock, same-filesystem atomic temp+rename,
  0600. read() THROWS on insecure/unreadable -> resolveWorkerToken fails closed
  (never falls back to env). A refresh response without a rotated token fails
  closed.
- Failure / recovery: any of {store unreadable, empty+no bootstrap, refresh
  4xx, no rotated token, write lock held} => non-zero exit + a "reconnect/
  reprovision required" state. Recovery = owner re-seeds SUPABASE_RUNTIME_REFRESH_
  TOKEN (env) once and clears the store file; next run re-bootstraps.
Owner action: provision the initial refresh token into env for the FIRST run,
set SUPABASE_RUNTIME_TOKEN_STORE to a 0600 path in a 0700 dir owned by the
service user; after the first successful run, remove the env refresh token.

## 2. Worker identity + least-privilege RLS (design; owner-run SQL, NOT executed)

Goal: the worker uses its own Supabase authenticated identity - separate from the
owner and from Hermes - with RLS that lets it advance jobs but NOT alter approvals
or owner authorization.

Proposed migration 0005 (owner reviews + runs in STAGING; additive):

    -- runtime role registry (owner-only readable)
    create table if not exists runtime_roles (
      user_id uuid primary key references auth.users (id) on delete cascade,
      role text not null check (role in ('worker','hermes')),
      created_at timestamptz not null default now()
    );
    alter table runtime_roles enable row level security;
    create policy runtime_roles_owner_all on runtime_roles
      for all to authenticated using (public.is_owner()) with check (public.is_owner());

    create or replace function public.runtime_role() returns text
      language sql stable security definer set search_path = public as $$
      select r.role from public.runtime_roles r where r.user_id = auth.uid();
    $$;

    -- WORKER: advance jobs + append attempts/checkpoints/dead_letters; read others.
    grant select, update on os_jobs to authenticated;             -- gated below
    create policy os_jobs_worker_upd on os_jobs
      for update to authenticated
      using (public.is_owner() or public.runtime_role() = 'worker')
      with check (public.is_owner() or public.runtime_role() = 'worker');
    create policy worker_leases_worker_all on worker_leases
      for all to authenticated
      using (public.is_owner() or public.runtime_role() = 'worker')
      with check (public.is_owner() or public.runtime_role() = 'worker');
    create policy job_attempts_worker_ins on job_attempts
      for insert to authenticated
      with check (public.is_owner() or public.runtime_role() = 'worker');
    create policy job_checkpoints_worker_ins on job_checkpoints
      for insert to authenticated
      with check (public.is_owner() or public.runtime_role() = 'worker');

    -- WORKER denied (no policy grants it): approvals, owners, runtime_command_packets
    -- writes, system_controls writes, orchestration_decisions writes.

    -- HERMES: append orchestration_decisions + os_events; read only elsewhere.
    create policy orch_decisions_hermes_ins on orchestration_decisions
      for insert to authenticated
      with check (public.is_owner() or public.runtime_role() = 'hermes');
    create policy os_events_hermes_ins on os_events
      for insert to authenticated
      with check (public.is_owner() or public.runtime_role() = 'hermes');
    -- HERMES denied: os_jobs/worker_leases writes, approvals, system_controls,
    -- runtime_command_packets writes.

Bootstrap the identities (owner, SQL editor, once): create two auth users
(worker@, hermes@ - service mailboxes), then
    insert into runtime_roles (user_id, role)
      select id, 'worker' from auth.users where email = 'worker@...';
    insert into runtime_roles (user_id, role)
      select id, 'hermes' from auth.users where email = 'hermes@...';
Do NOT add these users to `owners`. The service-role key is never used.

Permitted / denied summary:
- worker: UPDATE os_jobs, ALL worker_leases, INSERT job_attempts/job_checkpoints;
  SELECT everything owner-scoped. DENIED: approvals, owners, system_controls,
  runtime_command_packets writes, orchestration_decisions.
- hermes: INSERT orchestration_decisions/os_events; SELECT. DENIED: os_jobs,
  worker_leases, approvals, system_controls, execution enable.

Verification (owner): as each identity, attempt a denied write -> expect RLS
denial; attempt the permitted write -> expect success. Confirm neither can
UPDATE system_controls (execution stays owner-only).

Revocation: `delete from runtime_roles where user_id = '<uuid>';` (immediate) and
disable/rotate that identity's credentials; the worker/Hermes then loses all
write capability but keeps owner-only reads via RLS (effectively inert).

## 3. Hermes isolation (service artifacts UPDATED)

deploy/systemd/preston-worker.service -> User/Group preston-worker,
EnvironmentFile /etc/preston/worker.env. preston-hermes-observe.service ->
User/Group preston-hermes, EnvironmentFile /etc/preston/hermes.env. Separate env
files => separate SUPABASE_RUNTIME_TOKEN_STORE paths => separate identities +
token stores. Hermes remains disabled (timer not enabled; hermes_mode disabled).
Owner creates the two OS users, the two 0700 env dirs, and the two 0600 env
files; the AI created none.

## 4. Authenticated db-health (IMPLEMENTED)

`node dist/os-runtime/bin.js db-health` (service mode): resolves the token
(refresh+store), builds the RLS client, does a read-only probeControls() read,
refuses a production SUPABASE_URL, writes nothing, emits no secret, exits
0 (ok) / 78 (config or prod refused) / 70 (auth/connectivity error).
deploy/preflight-health.sh now runs db-health as the service user with the env
loaded via runuser. Tested (dispatcher.test.ts): pass, prod-refused, probe-error.

## 5. Safety-guard fail-open (DOCUMENTED; do not edit without an owner packet)

Observed in the REAL guard C:\Users\grann\.claude\hooks\preston_safety_guard.ps1
lines 23-27: stdin is parsed as JSON in a try/catch, and on ANY parse failure it
calls `Allow` (exit 0) - i.e. it FAILS OPEN. Intent (comment line 6) is to avoid
bricking all tool use, but a crafted/garbled tool payload that fails JSON parse
would bypass H-1..H-6. This is a defense-in-depth weakness, not an active hole in
normal operation (Claude Code sends well-formed JSON). A unit test is not feasible
from the app test suite (it is a PowerShell PreToolUse hook). RECOMMENDATION
(owner-approved, separately reviewed packet only): change the catch to fail
CLOSED (Deny) for tool calls whose input cannot be parsed, or at least for Bash/
Write/MCP tools, while still allowing an empty stdin. The AI did NOT edit the
guard.

## 6. Non-execution statement

The AI implemented fail-closed code + docs only. No identity/credential creation,
no SQL/RLS execution, no service install/enable, no token provisioning, no guard
edit, no deploy, no activation. Execution, Hermes, and the Remote Runner remain
disabled.
