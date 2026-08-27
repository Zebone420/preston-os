# Preston Build Host Foundation v1 (preston-build)

Status: REPOSITORY-SIDE DESIGN + RUNBOOK. No server is provisioned by this
document - Hetzner provisioning is owner Gate A (see section 10). This is
everything needed so that, once the owner authorizes the host, bring-up is
a mechanical bootstrap and total host loss is a non-event.

Master goal reference: power-station foundation section 4 + section 22
(laptop independence).

## 1. Role separation (authoritative)

```text
preston-agent-prod   production runtime APPLIANCE only (exists)
preston-agent-staging staging runtime appliance (exists)
preston-build        development/build compute (FUTURE, Gate A):
                     Claude CLI + Codex CLI + repo + worktrees +
                     tests + build cache. DISPOSABLE.
```

Authority model - nothing on any host is authoritative:

```text
GitHub          durable source-control history (the only code authority)
Supabase        operational SSOT (goals/jobs/approvals/ledger/artifacts meta)
Artifact bucket durable generated files (Supabase Storage, Gate C)
Build host      disposable working compute - cache + workspace only
Prod host       isolated appliance; never shares credentials with build
```

## 2. Filesystem layout

```text
/srv/preston/
    repo/        canonical clone (origin = GitHub; never the authority)
    worktrees/   per-job isolated git worktrees (bounded, auto-removed)
    cache/       npm cache, build caches (deletable at any time)
    runtime/     compiled dist/ trees pinned to commits
    logs/        bounded service logs (systemd LogsDirectory=preston)
    temp/        scratch (cleaned on boot)
```

Permissions: root owns /srv/preston; each service user owns only its
subtrees. Worktrees and temp are the ONLY writable areas for workers.

## 3. Service users

```text
preston-build    owns repo/ worktrees/ cache/; runs builds + tests
preston-worker   runs bounded agent jobs (as on staging/prod today)
preston-hermes   observe-only (separate env + token store, as today)
root             owns /etc/preston/*.env (640, group service-readable
                 where the runuser preflight requires it)
```

No service user can read another's token store. No production provider
credential EVER exists on the build host; the build host's runtime
identity targets STAGING by default (SUPABASE_RUNTIME_ENV=staging + the
dispatcher's symmetric cross-env URL refusal makes prod targeting
fail-closed even on misconfiguration).

## 4. Package/tool manifest

```text
git >= 2.40         (worktrees)
node 20 LTS + npm >= 11 (lockfile is npm-11 synced as of 4779f14)
bash, coreutils, flock (tick serialization)
claude CLI          (service-user home credential, owner-provisioned)
codex CLI           (service-user home credential, owner-provisioned)
ufw                 (SSH allowlist model identical to staging)
NO docker, NO kubernetes, NO database server (SSOT is Supabase)
```

## 5. Bootstrap runbook (owner-run after Gate A)

1. Provision per Gate A packet (CPX22-class, Ubuntu 24.04, fsn1,
   key-auth only - mirrors preston-agent-staging).
2. Create service users + /srv/preston layout (section 2/3).
3. `git clone` the repo from GitHub into /srv/preston/repo as
   preston-build (deploy key per Gate B - read-only unless Gate B
   grants narrow push).
4. `npm ci && npm run build:os-runtime` in apps/dashboard.
5. Install /etc/preston/*.env from the owner's 1Password values
   (names in env.template; staging identity only).
6. Bootstrap token stores (`--bootstrap` once per identity; store wins
   thereafter - existing 4B.1 procedure).
7. Install the disabled systemd units (deploy/systemd), enable timers
   only after preflight-health passes.
8. Record the build stamp (section 7) in the provisioning evidence.

## 6. Worktree + cache policy

- Worktrees are created per job by the existing provisioner and removed
  on EVERY path (already enforced in real-executor); a reaper cron may
  additionally remove any /srv/preston/worktrees entry older than 24h
  (stale = crashed run; its job lease already recovered).
- cache/ is best-effort: deleting it costs one slow build, nothing else.
- runtime/ keeps at most the last 3 pinned dist trees; older removed.

## 7. Build-stamp verification

Every deployed/compiled tree must be attributable:

```text
stamp = { commit_sha, built_at, node_version, npm_ci_exit }
```

written to runtime/<sha>/BUILD_STAMP.json at build time; preflight-health
compares the running unit's ORCH_BASE_COMMIT to the stamp before any
timer is enabled. (The pattern is already live informally: ORCH_BASE_
COMMIT repins are owner-gated; the stamp makes it verifiable.)

## 8. GitHub branch/push policy (prep for Gate B)

- master and release branches: owner-controlled, protected; never pushed
  from any host.
- Worker branch pushes (future, Gate B): a deploy key scoped to
  `worker/**` branch patterns only, revocable at GitHub, never able to
  touch protected branches. Until Gate B exists, the build host is
  read-only toward GitHub.

## 9. Disaster recovery

Recovery objective: a completely destroyed build host is reconstructable
with NO loss of authoritative code or artifacts, because none live there.

```text
lose build host   -> re-run section 5 bootstrap (target < 1 hour)
lose worktrees    -> nothing: jobs re-lease and reprovision from repo/
lose cache        -> slow next build only
lose token store  -> re-bootstrap identity (existing 4B.1 procedure)
lose prod host    -> unaffected (isolated; separate identity + env)
```

The inverse also holds: build-host compromise cannot reach production
(no prod credentials present; prod DB refuses the staging identity; ufw
model isolates hosts).

## 10. OWNER GATE A - build-host provisioning (exact, bounded)

```text
server type      CPX22 (2 vCPU / 4 GB / 80 GB) - matches staging class
location         fsn1 (Falkenstein) - same as existing estate
est. cost        ~ EUR 8/mo (Hetzner CPX22 list price at last check;
                 confirm current price in console before approving)
firewall         ufw: SSH only, allowlisted from the staging-jump chain
                 (same model as prod ingress; no cloud firewall)
SSH model        key-auth only, existing preston-agent key family,
                 nested ProxyCommand chain as today
runtime isolation staging identity only; no prod credentials; symmetric
                 cross-env refusal active
rollback         decommission = delete server; nothing authoritative on it
confirmation     OWNER AUTHORIZES GATE A: provision preston-build
```

Nothing in this document executes without that phrase.
