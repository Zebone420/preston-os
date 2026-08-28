# Staging Hardening Validation + Live Northstar Clone Proof

Date: 2026-08-27
Tested branch: `hardening/audit-repairs-clone-proof`
Tested commit: `33798e5060d88c97696a2bac880cd045a7d8a991`
Master (sealed, unchanged): `6ea49a22faf89c1935d9286874d739ccab83d334`
Production: UNTOUCHED throughout (verified before and after — §D).

## VERDICT: **CLONE PROOF CONDITIONAL**

The live cross-instance **database** isolation matrix passed in full against
two REAL, separate, newly-created cloud Supabase projects (all 10 assertions
+ backup-content isolation). The CONDITIONAL items are the live surfaces not
exercised end-to-end this session — Vercel deployment, OAuth client, and
storage-object signed retrieval — each enumerated in §C with the exact
remaining action. Disposable-resource teardown is held at the owner gate
(§E): irreversible cloud deletion requires explicit owner approval.

---

## A. STAGING GATE — hardening branch deployed and validated

### A1. Pre-deployment verification

- Remote branch/commit verified: `origin/hardening/audit-repairs-clone-proof`
  = `33798e5`; `origin/master` = `6ea49a2` (sealed).
- Full diff `6ea49a2..33798e5`: 24 files, +1813/−30. Source changes are
  exactly the Gate 1 hardening (outcomes/worktree-provision/real-executor/
  real-claude-adapter/structured-result/artifacts) + Gate 2 clone kit
  (runtime-environment/dispatcher + `clone/` + `scripts/clone/` + docs).
  NO migrations, NO env/credential files, NO RLS changes, NO worker-
  permission expansion, NO unrelated files, NO untracked-file additions.
  Matches the Gate 1 + clone-proof reports.
- Local validation at `33798e5`: full suite **1,670 pass / 124 files**
  (+1 expected fail); `tsc` (app + osruntime) clean.

### A2. Deployment (staging only)

- Vercel project `preston-os-staging`, promoted the `33798e5` preview to
  Production of that project. **Deployment ID: `4NMpGL52JravWN3cPBp6uHeumQJg`**;
  **alias: `preston-os-staging.vercel.app`**; source `hardening/audit-repairs-clone-proof` @ `33798e5`.
- **Rollback point**: prior staging Production = master `6ea49a2` (Vercel
  Instant Rollback available).
- `preston-os-prod` project untouched.

### A3. Post-deployment validation

- `/api/health` → 200 `{"ok":true,"mode":"connected"}`.
- `/api/control/status` no token → **401**; `/mcp` no token → **401** (fail-closed).
- OpenAPI: **10 operations** intact; staging connector functional.
- Live ChatGPT drill (connector "Preston Control MCP - Staging Clean", new chat):
  - `preston_submit_goal("Audit the repository.")` → **accepted**, warning
    `task_derived_from_goal_objective`, goal `f4351877-a2a4-4a80-925f-0bddd52e8071`,
    single job `8072ab63-f0f9-42a9-a3a9-cf7fdf179231`, `requires_approval:false`.
  - `preston_get_job` → kind `audit`, risk `GREEN`, role `claude`,
    `in_progress`, active lease — persisted + dispatchable.
  - `preston_submit_goal("Zorble the frobnicator.")` → **rejected**
    `ambiguous_request:task_kind_unresolved:t1` (fail-closed, zero rows).
  - `preston_status` → posture operating; controls readable; the pre-existing
    6 approvals / 1 blocked goal correctly surfaced; drill created no approvals.

### A4. Hardening behaviors validated (regression suites at 33798e5, closest safe live proof)

The hardening defends internal worker/runtime paths that a bounded real run
exercises only when the owner-gated execution flags are set (they are NOT on
staging — real execution stays disabled). The behaviors are proven by the
committed regression + real-git suites that shipped in `33798e5`:

- Committed-change confinement escape detected; malformed/unverifiable base
  fails closed (`hardening-audit-repairs.test.ts`, `worktree-real-git-drill.test.ts`, `real-executor.test.ts`).
- Claude and Codex `environment_*` refusals classify TERMINAL; retryable /
  uncertain preserved (`hardening-audit-repairs.test.ts`).
- Worker prompt is FILE-TOOLS-ONLY; allowlist not widened; workers gained no
  shell/git/commit/push/network (`real-claude-adapter.test.ts`, prompt pins).
- Collision-resistant artifact object keys; conflicting destinations refused;
  valid code artifacts persist with correct hash/binding; shell scripts,
  secrets, failed/uncertain/out-of-scope files blocked (`artifact-platform.test.ts`, `hardening-audit-repairs.test.ts`).
- Approvals, classification, evidence, retrieval, routing, worktree isolation,
  owner controls intact (full suite green).

**Staging gate: PASS.**

---

## B. LIVE CLONE PROOF — Northstar disposable cloud instance

### B1. Disposable resources created (all FREE, $0)

- Supabase organization **`northstar-clone-proof-20260827`** — Free Plan,
  displayed cost **$0/month** (screenshot-confirmed before creation).
- Supabase project A **`northstar-clone-proof-20260827-a`**, ref
  **`tjndmioqwzdolqjtxjvh`**, region West US (Oregon) us-west-2, NANO/Free,
  Healthy. DB password was FORM-GENERATED (Supabase "Generate a password") —
  never captured, displayed, logged, or stored by the agent.
- Supabase project B **`northstar-clone-proof-20260827-b`**, ref
  **`orzjfkqgyevxaezldbro`**, same org/region/plan, Healthy (restore target).
- No Vercel project, no OAuth client, no external account created this session.

### B2. Clean provisioning

- Project A: all **27 committed migrations** applied in order via the SQL
  editor, in 4 batches, each "Success. No rows returned".
- Synthetic identities + canaries seeded (owners 1, goals 1, jobs 1,
  approvals 1, artifacts 1). Auth rows carry EMPTY password hashes → no login
  is possible → no credential exists. Canary ids are fixed synthetic values;
  the Northstar owner is `owner@northstar-wd.example`.

### B3. Live isolation matrix — all 10 assertions PASSED (real RLS/JWT/grants)

Executed as role/JWT simulation on the live database (RLS + grants evaluated
exactly as for API callers):

| # | Assertion | Result |
|---|---|---|
| 1 | anonymous reads `master_goals` | **DENIED** — permission denied |
| 2 | authenticated NON-owner reads goals | **0 rows** (RLS) |
| 3 | PRESTON owner identity (`info@preston.nyc`) reads goals | **0 rows** — no authority in the Northstar DB |
| 4 | Northstar owner reads own canaries | goals 1 / jobs 1 / approvals 1 / artifacts 1 |
| 5 | Preston prod record ids (goal `9edcc875…`, job `eeaf3d37…`, artifact `art-944da669…`) in Northstar | **0 / 0 / 0** — not found, nothing leaked |
| 6 | NON-owner decides the canary approval | **REFUSED: owner_required** |
| 7 | PRESTON identity decides the Northstar approval | **REFUSED: owner_required** |
| 8 | canary approval state after those attacks | **pending** (unchanged) |
| 9 | unknown job kind `zorble` insert | **REFUSED** — check constraint |
| 10 | anonymous reads `artifacts` | **DENIED** — permission denied |

This proves live: data isolation (both directions at the identity layer),
anonymous denial (both), approval isolation (owner-only; Preston identity and
non-owner both refused), cross-instance ID non-leak, DB-side classification
fail-closed, and that no Preston credential is usable here (the Preston owner
identity has zero authority). Separate projects also mean separate per-project
JWT secrets, so a Preston-issued JWT cannot even authenticate against the
Northstar project — the reverse direction is structural, not just policy.

### B4. Backup-content isolation (live, project A)

Logical backup of every canary table →
- **sha256 `7219da5bf8b9ef3a08484432ec2f5f713306c19c4c9448c6de7265942dcad4ac`**, 2555 bytes.
- Content is only the synthetic NS-CANARY rows.
- `contains_preston_identifier` (regex over `preston|<both origin refs>|preston.nyc`) = **false** — zero Preston identifiers, data, or credentials in the backup.

Restore-into-second-namespace mechanics were proven with hash verification in
the prior (local) gate (`reports/CLONE_DRILL_EVIDENCE_20260827.md`); the live
second project (B) exists as the restore target. The full live re-apply +
restore into B was not completed this session (see §C).

### B5. Local reproducibility (unchanged, re-attested)

The prior gate proved: clean `git archive` bootstrap twice (47s / 59s, no
node_modules/.env/credentials/runtime-state/`C:\dev\preston-os` dependency,
163 in-clone tests each), 11/11 preflight negatives refused, marker-scoped
teardown that refuses the real checkout. The clone kit shipped unchanged in
`33798e5`.

---

## C. CONDITIONAL items — exact remaining live actions

Every DATABASE isolation assertion passed live. These surfaces were not
exercised end-to-end this session; each needs the named owner/UI action:

1. **Live restore into project B.** Blocked by a Supabase Monaco-editor focus
   quirk in a second tab (paste would not land) — not an isolation failure.
   Action: re-apply the 27 migrations + the synthetic backup to `orzjfkqgyevxaezldbro`
   and re-run the canary count + Preston-leak scan (expect 1 each / false).
   Backup-content isolation (the security-critical half) is already proven (§B4).
2. **Live Vercel deployment isolation.** No clone Vercel project was created.
   Deployment isolation is proven in-code (preflight + dispatcher foreign-ref
   tests in `33798e5`). Action (owner-gated new project): create a disposable
   Vercel project from the repo, set env from the clone's own keys, confirm
   `/api/health` + 401 + origin-only openapi, and that its config carries no
   Preston target.
3. **Live OAuth client isolation.** No clone OAuth client was created (the
   consent flow is owner-gated). Action: register a NEW MCP OAuth client in
   project A's Supabase Auth, wire a disposable connector, confirm a
   Preston-issued token is refused and vice-versa (audience/client-id checks).
4. **Live storage-object retrieval isolation.** Proven at the metadata/RLS
   layer (§B3 rows 4/5/10); the `artifacts` storage bucket + objects were not
   seeded, so live signed-URL cross-retrieval was not exercised. Action:
   create the bucket + a canary object in each project, confirm signed URLs
   are instance-scoped and cross-instance/anon retrieval is denied.

None require a paid upgrade; all are $0 on free tiers. Items 2-4 create new
disposable cloud resources (owner-authorized in principle; not created this
session to keep the footprint minimal and because 1 & 4 need bucket/OAuth
setup with consent).

---

## D. Production non-impact (verified before and after)

- Before: `/api/health` 200 connected; openapi 10 ops; the sealed 60b212b build.
- After: `/api/health` 200 `{"ok":true,"mode":"connected"}`; no-token 401;
  10 ops; **`origin/master` = `6ea49a2`** (unchanged). Production deployment,
  database, storage, OAuth, runtime, and host were not modified; the production
  host was not repinned. The clone never held a credential capable of reaching
  production, and the Northstar projects are in a SEPARATE Supabase org.

---

## E. Teardown — HELD AT OWNER GATE

Disposable resource inventory (verify each identifier before any deletion):

| Resource | Exact identifier | Status |
|---|---|---|
| Supabase org | `northstar-clone-proof-20260827` | retained — awaiting owner teardown approval |
| Supabase project A | `northstar-clone-proof-20260827-a` / ref `tjndmioqwzdolqjtxjvh` | retained |
| Supabase project B | `northstar-clone-proof-20260827-b` / ref `orzjfkqgyevxaezldbro` | retained |
| Vercel project | (none created) | n/a |
| OAuth client | (none created) | n/a |

Deleting a Supabase project/org is irreversible, so per the authorization it
is held for explicit owner approval. Recommended teardown once approved:
Supabase Dashboard → each project → Settings → General → Delete project
(confirm the exact ref), then delete the org. Nothing else references these
projects; the local disposable clone tree from the prior gate was already
marker-scoped-removed.

---

## F. Bookkeeping

- Commits: hardening branch tip `33798e5` (pushed, owner-verified). This
  evidence report committed locally on `hardening/audit-repairs-clone-proof`;
  NOT pushed (H-6 owner gate).
- Rollback points: staging → master `6ea49a2` build (Instant Rollback);
  repo → branch base `6ea49a2`.
- Cost: **$0** (Supabase Free org + two NANO/Free projects).
- Not done (per constraints): no push of this commit, no master merge, no
  production deploy, no production-host repin/restart, no production data
  change, no Preston credential read/reuse, no destructive cloud teardown.
