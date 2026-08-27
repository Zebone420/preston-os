# Disposable Clone Proof — Northstar Windows & Doors (Clone Proof Only)

Date: 2026-08-27
Branch: `hardening/audit-repairs-clone-proof`
Gate 1 (hardening): PASS — `reports/HARDENING_GATE1_AUDIT_REPAIRS_20260827.md`, commit `53c010c`
Gate 2 (architecture): commit `6bb5913` — contract `docs/INSTANCE_CONFIGURATION_CONTRACT_v1.md`, runbook `docs/CLONE_REPRODUCIBILITY_RUNBOOK_v1.md`, kit `clone/` + `scripts/clone/`
Production: UNTOUCHED throughout. Nothing pushed, nothing deployed.

## VERDICT: **CLONE PROOF CONDITIONAL**

Every proof executable without creating new external accounts/services was
EXECUTED and REPEATED (not merely documented). The remaining proofs
require new cloud infrastructure and stop at the owner gate below.

## 1. Drill setup

Fictional identity: slug `northstar-wd`, display "Northstar Windows &
Doors - Clone Proof Only", owner `owner@northstar-wd.example`, refs
`northstarclonestag00` / `northstarcloneprod00`, foreign refs = both
origin (Preston) refs. Disposable target: session scratchpad directory.

Clean start, all verified before bootstrap:
- Tree from `git archive` of the branch tip: **no git history, no
  node_modules, no `.env*` files, no credential store, no runtime state,
  no database snapshot**; the two preserved untracked local files are
  untracked and therefore absent from the export.
- No hidden dependency on `C:\dev\preston-os`: the instance ran entirely
  from its own tree; the only origin references anywhere are the two
  refs inside the mandatory foreign DENYLIST (whose sole effect is
  refusal).

## 2. Proof matrix (executed evidence)

| # | Proof | Result | Evidence |
|---|---|---|---|
| 1 | Clean setup | **PASS** | Run 1: toolchain→config→preflight→`npm ci` (506 pkgs, lockfile-integrity, `--ignore-scripts`, 32.8s)→verification 7 suites/163 tests green→marker+report; total ~47s. Missing requirements fail actionable (N5). |
| 2 | Identity isolation | **PASS (local)** | Config/branding carry only the fictional identity; restore-namespace leak scan for `preston.nyc` / `preston-os-*` / `Preston Windows`: **0 findings**; origin identity/branding/domain attempts refused (N3/N4/N6). |
| 3 | Data isolation | **CONDITIONAL** | Architectural: separate Supabase projects = disjoint databases/keys/JWT secrets; runtime refuses any origin-DB URL in every environment (clone-suite dispatcher tests + N1/N2). LIVE cross-read denial needs real clone projects → owner gate. |
| 4 | Credential isolation | **PASS (local)** | The clone contains NO real credential (placeholders only, by construction — nothing was copied); preflight rejects origin identifiers; commit-time secret scan 0; drill logs value-free. Live-token non-reuse is structural (no shared project can mint a cross-valid token) but unverifiable without live projects. |
| 5 | Runtime isolation | **CONDITIONAL** | Leases/jobs/evidence live in the instance DB (disjoint by construction); foreign-ref gate blocks a clone runtime from ever reaching Preston's control plane (proven in-clone). Live "cannot lease" cross-test needs live projects → owner gate. |
| 6 | Approval isolation | **CONDITIONAL** | Approval verification binds owner_identity + environment + action_hash + nonce inside the instance DB (suites ran green in-clone); an origin owner phrase cannot reach a clone DB it has no identity in. Live cross-identity refusal test → owner gate. |
| 7 | Storage isolation | **CONDITIONAL** | Bucket lives inside the instance project (namespace = project); Gate 1 collision-resistant object paths + conflict refusal proven in-clone; signed URLs mint only from the instance's own project keys. Live cross-instance denial test → owner gate. |
| 8 | Deployment isolation | **PASS (local)** | Explicit production-target guards proven: origin prod DB/domain refused (N2/N4), clone staging→own-prod refused (N9), dispatcher gate refuses foreign refs in every environment. Production deployment verified unchanged (no contact made). |
| 9 | Backup/restore | **PASS (synthetic)** | Backup zip sha256 `2837A4AE…A3518` of config+report+synthetic data; restored into a second disposable namespace; **all file hashes match**; origin-data scan of the backup: 0 findings (origin refs appear only inside the foreign denylist, whose function is refusal). Live DB pg_dump/restore → owner-run per runbook §4. |
| 10 | Repeatability | **PASS** | Teardown (marker-scoped) then full second run from the archive: identical outcome (7 suites/163 tests green), 59s wall incl. extraction + fresh `npm ci`. Manual steps: author config (1 file), set env values (8 placeholders for the local drill). Deviations/failures: none. |
| 11 | Negative tests | **PASS 11/11** | N1-N9 all REFUSED (origin staging/prod refs, origin owner domain, origin deployment domain, missing env, origin branding, missing foreign list, ref mismatch, own-prod-from-staging) + teardown REFUSED the real Preston checkout (no marker) + unknown-kind/unsafe-request rejection re-proven inside the clone (composer + orchestration-security suites, part of the 163). |

## 3. What CONDITIONAL means — the exact owner gate

A complete live proof requires NEW external infrastructure (creating any
of it is expressly owner-gated):

1. Two new Supabase projects for the fictional clone (free tier suffices;
   a separate org keeps the origin org untouched). Apply migrations, run
   the runbook §2.1 steps with synthetic data only.
2. One new Vercel project + placeholder domain (hobby tier suffices).
3. One new MCP OAuth client inside the clone's Supabase project.
4. Then execute the live half of the matrix from the clone: cross-read
   denial both directions with normal runtime credentials, anon denial,
   cross-lease denial, cross-approval refusal, cross-signed-URL denial,
   live backup/restore, then delete the disposable projects.

Estimated cost: $0 on free tiers; the gate exists because it creates new
external accounts/services, not because of price. Exact steps: runbook
§2 with the Northstar config; nothing else is missing.

## 4. Commands and artifacts (exact)

- Export: `git archive --format=zip -o platform.zip hardening/audit-repairs-clone-proof`
- Validate: `node scripts/clone/validate_instance_config.mjs instance.config.json` → VALID
- Preflight: `node scripts/clone/preflight.mjs instance.config.json` → CLEAN (and BLOCKED, correctly, for each N-case)
- Bootstrap: `node scripts/clone/bootstrap.mjs instance.config.json --quick` → exit 0 (twice)
- Negatives: drill driver over the clone's own modules → 9/9 refused
- Teardown: `node scripts/clone/teardown.mjs <root> [--confirm]` → dry-run safe; refused unmarked real checkout; removed only marker-carrying instances
- Quick verification suites (in-clone): composer-engine, composer-security,
  dispatcher (incl. clone-isolation pins), hardening-audit-repairs,
  real-executor, artifact-platform, orchestration-security-regressions —
  **163/163**.

## 5. Rollback points and production state

- Repo rollback: branch base = master `6ea49a2` (= production seal
  lineage); Gate commits `53c010c` (hardening), `6bb5913` (clone kit),
  this report's commit. Nothing pushed (H-6 owner gate).
- Production: `preston-os-prod` deployment `4Aup3ibyxG59uxEk8zWEow87qyoN`
  @ master `60b212b` — not contacted, not redeployed, not repinned; no
  production data read or written by any drill step. The drill never
  held a credential capable of reaching it.

## 6. Remaining risks / owner decisions

1. The CONDITIONAL live-isolation half (§3) — owner decision to provision
   the disposable cloud set, or accept the architectural+local proof.
2. Worktree dependency provisioning stays a gated design (Gate 1 §2.6).
3. Origin-identifier preflight list is static (`ORIGIN_IDENTIFIERS` in
   `scripts/clone/preflight.mjs`); extend it when new instances exist.
4. Truncated low-severity audit findings (Gate 1 §3) remain unrecovered.
5. `git archive` export excludes untracked files by construction — an
   operator cloning via `git clone` instead inherits history (fine) but
   should still verify no local uncommitted state rides along.
