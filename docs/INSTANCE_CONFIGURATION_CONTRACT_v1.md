# Instance Configuration Contract v1

Date: 2026-08-27. Companion: `docs/CLONE_REPRODUCIBILITY_RUNBOOK_v1.md`,
`clone/env.instance.template`, `clone/instance.config.example.json`,
`scripts/clone/*` (validate / preflight / bootstrap / teardown).

## 1. Model: physically separate instances

One business = one INSTANCE = its own Supabase projects (staging +
production), its own auth users and RLS-bound identities, its own storage
bucket, its own OAuth clients, its own deployment projects/domains, its
own runtime host + service identity, its own secrets. The platform is NOT
multi-tenant and this contract does not make it so: nothing in any
instance's database, storage, tokens, or evidence is reachable from any
other instance, because they share no project, no key, and no identity.
The repository is the only shared thing, and it carries code + placeholder
templates only.

## 2. Separation inventory

| Layer | Shared platform (repo) | Per-instance |
|---|---|---|
| Application code, migrations, tests, scanners, guards | YES (identical) | - |
| Instance identity (slug, display name, mode) | template only | `instance.config.json` + env |
| Business configuration (branding, owner emails, notification targets) | template only | env + config |
| Infrastructure (Supabase projects, Vercel projects, host) | - | owner-provisioned per instance |
| Secrets/credentials (keys, tokens, OAuth secrets, webhooks) | NEVER in repo | platform secret store + host env, minted new per instance |
| Customer/operational data (goals, jobs, approvals, artifacts, business tables) | - | instance database only |
| OAuth/connector identities (MCP client, GPT client, Google, Telegram) | - | new clients/registrations per instance |
| Worker/runtime identities (`WORKER_AGENT_ID`, service user, token store) | defaults only | per instance |
| Domains/aliases | - | per instance |
| Storage bucket `artifacts` | name convention | per-project bucket (project = namespace) |
| Prompts/policies/safety rules | YES (platform) | only via documented env knobs |

## 3. Instance identity keys (non-secret)

- `instance.slug` - machine name of the business instance.
- `instance.mode` - `origin` (first lineage deployment) or `clone`.
- `environments.staging_project_ref` / `production_project_ref` - the
  instance's OWN Supabase refs; consumed by the runtime as
  `ORCH_STAGING_PROJECT_REF` / `ORCH_PRODUCTION_PROJECT_REF` (defaults =
  the origin's refs, so existing deployments are unchanged).
- `environments.foreign_project_refs` - refs this instance must NEVER
  touch in ANY environment; consumed as `ORCH_FOREIGN_PROJECT_REFS`. A
  clone MUST list every origin ref. The dispatcher's staging gate refuses
  any database URL containing a foreign ref (fail closed, additive-only).

## 4. Isolation requirements (all mechanically enforced or owner-verified)

1. Separate database projects: distinct refs validated by schema +
   preflight; runtime gate refuses foreign refs.
2. Separate auth: new Supabase projects mean new `auth.users`, new owner
   allowlist rows, new `is_owner()` scope. No JWT from one project
   verifies against another (per-project JWT secrets).
3. Separate storage: the `artifacts` bucket lives inside the instance's
   project; storage RLS + project keys scope every object and signed URL.
4. Separate OAuth: new client ids/secrets per instance; tokens are minted
   by the instance's own Supabase Auth server and are invalid elsewhere.
5. Separate deployment: new Vercel (or equivalent) projects + domains;
   preflight refuses origin domains and origin refs in clone config/env.
6. Separate runtime identity: new service user, new refresh token, new
   token store path, new agent ids.
7. Separate secrets/encryption: nothing is copied; the bootstrap only ever
   consumes placeholders and the preflight fails on origin identifiers.
8. Separate approvals/notifications: owner identities and Telegram
   targets are per-instance env; approval verification binds
   owner_identity + environment + project, so an origin owner phrase can
   never authorize a clone action (different DB, different identity,
   different action hash).
9. Separate logs/evidence/jobs/goals/artifacts/backups: all live in the
   instance database/storage; run ids and evidence refs never cross.
10. Separate worktrees/execution: per-host `ORCH_CANONICAL_REPO`,
    `ORCH_WORKTREES_ROOT`, `ORCH_BASE_COMMIT` pins.
11. No shared customer data, no origin branding unless explicitly
    configured, no origin credentials anywhere (preflight-scanned).

## 5. Configuration surfaces

1. `instance.config.json` (non-secret, schema-validated by
   `scripts/clone/validate_instance_config.mjs`).
2. Environment values per `clone/env.instance.template` (a complete
   placeholder-only env contract; the repo's `.env*` guard is why it is
   not literally named `.env.example` - never commit a filled copy).
3. Database schema: the committed migrations `supabase/migrations/`
   applied IN ORDER to the new projects by the owner (same SQL for every
   instance; RLS/owner allowlist bootstrap included).

## 6. Change policy

Platform changes land in the shared repo. Instance differences live ONLY
in the two configuration surfaces above. Anything Preston-specific found
hardcoded in platform code is a defect against this contract (the
project-ref constants were the one instance of this; they are now
env-parameterized with origin defaults).
