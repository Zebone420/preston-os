# Clone Reproducibility Runbook v1

Date: 2026-08-27. For a qualified operator standing up the platform for a
NEW business from a clean machine or server, with strict isolation from
every existing instance. Contract: `docs/INSTANCE_CONFIGURATION_CONTRACT_v1.md`.

## 0. Prerequisites (all failures are actionable)

- Git; Node.js >= 20 (LTS); npm (ships with Node).
- The platform repository (clone of the shared repo, or a `git archive`
  export of the pinned commit - no origin git history required).
- NO `.env` file, NO credential store, NO `node_modules`, NO runtime
  state, NO database snapshot from any existing instance.
- For live deployment only (owner-run, external accounts): a Supabase
  account, a Vercel (or equivalent) account, a runtime host.

## 1. Local instance bring-up (no cloud, no secrets)

1. Export/clone the repo at the pinned platform commit into a fresh
   directory (the instance root).
2. Author `instance.config.json` from
   `clone/instance.config.example.json` (fictional/synthetic values are
   fine for a drill; real non-secret values for a live instance).
3. Provide the environment per `clone/env.instance.template` (placeholders
   for a drill; the preflight enforces presence + non-reuse, not realness).
4. Run the bootstrap (idempotent; re-running reuses installed deps):

       node scripts/clone/bootstrap.mjs instance.config.json [--quick]

   Steps: toolchain check -> config schema validation -> preflight
   (origin-value/reuse/production-target denial) -> `npm ci`
   (lockfile-integrity-verified, `--ignore-scripts`) -> vitest
   verification -> disposable-instance marker + `clone-bootstrap-report.json`.

## 2. Owner-run cloud provisioning (live instance only - OWNER GATE)

Each numbered step is per NEW business, with NEW credentials; never copy
a value from another instance.

1. Supabase: create TWO new projects (staging, production). Record the
   refs into `instance.config.json` + env. Apply `supabase/migrations/`
   in order via the SQL editor; run each migration's verification SQL.
   Create the owner auth user; insert the owners allowlist row; create
   the private `artifacts` bucket + its 3 storage policies (see
   the staging activation packet pattern in reports/).
2. Vercel: create a NEW project from the instance's repo; set Root
   Directory `apps/dashboard`; enable "Include files outside Root
   Directory"; set env per the template; assign the instance domains.
3. Runtime host: provision the service user, canonical checkout, worktree
   root, token store, systemd units from `deploy/systemd/` (disabled by
   default), and the service identity's refresh token.
4. OAuth: register NEW MCP + GPT OAuth clients in the instance's Supabase
   project; configure the connector in the business's OWN ChatGPT
   workspace. Telegram/Google: new bot/new OAuth app if used.
5. Verification: `/api/health` 200; unauthenticated `/api/control/status`
   -> 401; `openapi.json` shows the instance origin only; dispatcher
   `db-health` passes on the instance DB and REFUSES any foreign ref.

## 3. Preflight (rerunnable any time)

    node scripts/clone/preflight.mjs instance.config.json

Fails closed on: any origin identifier (project refs, domains, branding)
in a clone's config/env; missing required env values; declared refs that
do not match the env; a clone pointing at any origin database or domain.

## 4. Backup and restore

- Instance database: owner-run `pg_dump -Fc` against the INSTANCE
  project (5432, session mode), per the pattern in
  `reports/STAGING_FIRST_BACKUP_OWNER_PACKET.md`; verify with
  `pg_restore --list` + SHA256; restore ONLY into a scratch project or
  disposable namespace, never in place.
- Instance files/config: archive `instance.config.json`,
  `clone-bootstrap-report.json`, and the env NAMES manifest (never
  values); verify by SHA256 on write and on restore.
- A backup contains ONLY the instance's own data by construction (its
  project holds no other instance's rows). Verify after restore: row
  counts match, no foreign project ref appears anywhere in the dump
  (scan the `pg_restore --list` TOC + a grep of the restored config).

## 5. Rollback and teardown

- Local/disposable instance: `node scripts/clone/teardown.mjs
  <instance-root> [--confirm]` - dry-run by default, acts ONLY on a
  directory carrying the bootstrap's disposable-instance marker, refuses
  everything else (the real origin checkout never carries the marker).
- Live instance rollback: Vercel Instant Rollback to the prior
  deployment; database rollback = owner-run restore of the last verified
  backup into a scratch project, then owner decision; host rollback =
  re-pin `ORCH_BASE_COMMIT` and rebuild os-runtime (owner-run).
- Decommission (owner-run): pause/delete the instance's Supabase
  projects, delete the Vercel project, revoke its OAuth clients and
  tokens, retire the host service. Nothing shared means nothing else is
  affected.

## 6. New-business onboarding checklist

- [ ] Instance slug + display name chosen (no origin branding)
- [ ] `instance.config.json` authored and schema-valid
- [ ] Owner email/identity created (new, business-owned)
- [ ] Two new Supabase projects; refs recorded; migrations applied +
      verified; owners row + artifacts bucket + policies in place
- [ ] Env populated from `clone/env.instance.template` (new secrets only)
- [ ] `ORCH_FOREIGN_PROJECT_REFS` lists every other known instance's refs
- [ ] Preflight CLEAN
- [ ] Bootstrap verification suite green
- [ ] New deployment project + domains; health + fail-closed checks pass
- [ ] New OAuth clients registered; connector configured in the
      business's own ChatGPT workspace; 10-op catalog verified
- [ ] Runtime host provisioned; `db-health` passes; foreign refs refused
- [ ] First backup taken + restore-verified in scratch
- [ ] Kill switches tested (owner_stop; emergency SQL)

## 7. Drill mode (disposable clone proof)

The same flow with a fictional identity, placeholder credentials, and
synthetic data, entirely local: see
`reports/CLONE_DRILL_EVIDENCE_20260827.md` for the executed proof and
`scripts/clone/teardown.mjs` for scoped cleanup. No cloud account, no
paid service, no deployment is required for the local proof; the live
isolation checks that require real cloud projects are enumerated there
as the owner-gated remainder.
