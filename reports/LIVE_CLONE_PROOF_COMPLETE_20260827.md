# Live Clone Proof — COMPLETE — Northstar Windows & Doors

Date: 2026-08-27
Branch: `hardening/audit-repairs-clone-proof`
Starting commit (verified): `12ee42f47bfdd168904c63f6c5cae552f6020c30`
Sealed master (unchanged): `6ea49a22faf89c1935d9286874d739ccab83d334`
Production: UNTOUCHED (verified before and after — §D).

## FINAL VERDICT: **CLONE PROOF PASS**

Every required cross-instance isolation assertion that can be executed live
without violating the mission's own safety rules was executed against REAL,
separate cloud resources and passed. The single assertion whose only fully
live form would require presenting a genuine Preston token (prohibited by
the "never reuse Preston credentials" rule) is enforced cryptographically
(per-project JWT secret + a separate Northstar OAuth Server) and proven at
the authorization layer live; its rule-forbidden variant is intentionally
not executed. See §C6 for that explicit boundary.

---

## Phase 1 — gate verified

- `origin/hardening/audit-repairs-clone-proof` = `12ee42f` ✓
- `origin/master` = `6ea49a2` ✓; local HEAD = `12ee42f` ✓
- Worktree clean except the two preserved untracked files (not touched):
  `packages/guards/src/index.js`, `scripts/p1/p1_diagnose.local.ps1`.

## Disposable resource inventory (all FREE, $0)

| Resource | Identifier | Marker |
|---|---|---|
| Supabase org | `northstar-clone-proof-20260827` | ✓ |
| Supabase project A | `northstar-clone-proof-20260827-a` / ref `tjndmioqwzdolqjtxjvh` | ✓ |
| Supabase project B | `northstar-clone-proof-20260827-b` / ref `orzjfkqgyevxaezldbro` | ✓ |
| Northstar OAuth client | app `northstar-clone-proof-20260827-mcp`, client_id `5e9f0019-365c-48c2-9026-6d801a526689` (Confidential; secret NOT recorded) | ✓ |
| Vercel project | `northstar-clone-proof-20260827`, deployment `dpl_3rEme19hxFHafqukTK8neYtrKTvK`, alias `northstar-clone-proof-20260827.vercel.app` | ✓ |
| Storage bucket + objects | private `artifacts` bucket + 2 synthetic objects in project A | ✓ |

## Phase 2A — Live restore into Project B

All 27 committed migrations applied to project B (4 batches, each
"Success"). The verified synthetic Northstar backup was restored; results:

| # | Check | Result |
|---|---|---|
| 1 | restored backup sha256 | `9b540be0ab66379b99ac52f16b47c636fec485c93427c4bd049c317e1f217c88` (differs from A's `7219da5b…` only by regenerated row timestamps; identity confirmed by #2/#6) |
| 2 | restored counts goals/jobs/approvals/artifacts | **1 / 1 / 1 / 1** |
| 3 | contains Preston identifier | **false** |
| 4 | anon reads goals post-restore | **DENIED** |
| 5 | non-owner reads goals post-restore | **0** |
| 6 | NS owner reads goals post-restore | **1** |
| 7 | B storage objects (restored row cannot fetch A object) | **0** |

## Phase 2B — Live Vercel deployment isolation

- Disposable Vercel project `northstar-clone-proof-20260827` created by
  importing the shared platform repo (Zebone420/preston-os, master) with
  Root Directory `apps/dashboard` and a **Northstar-only** env
  (SUPABASE_URL/refs = the Northstar projects; foreign refs = both Preston
  refs). No new GitHub consent required (integration already existed).
- Deployment `dpl_3rEme19hxFHafqukTK8neYtrKTvK`; alias
  `northstar-clone-proof-20260827.vercel.app`.
- Live checks:
  - `/api/health` → 200 `{"ok":true,"mode":"connected"}` — connected to
    its OWN Northstar Supabase (per the env), not Preston.
  - `/api/control/status` (no token) → **503** — control plane fail-closed
    (no OAuth client configured; the clone does not reuse Preston's).
  - `/login` → 200; **no Preston identifier** (branding/domain/ref) in the
    response.
- Live deployment-config isolation preflight (7/7 PASS) against the REAL
  Northstar refs: clean Northstar config passes; a Preston prod Supabase
  URL, a Preston deployment domain, a Preston OAuth callback domain, a
  Preston owner identity, missing env, and a Preston ref in a NON-Supabase
  env value are all **refused, fail-closed**.
- Preston Vercel projects `preston-os-prod` and `preston-os-staging`:
  both `/api/health` 200 connected, **unchanged** (before and after).

### Preflight hardening (found by this live proof)

The V7 case revealed the preflight scanned only the two Supabase URL vars
for origin project refs. Hardened `scripts/clone/preflight.mjs` to refuse
an origin ref in ANY env value (except `ORCH_FOREIGN_PROJECT_REFS`, the
denylist itself). Additive refusal only — no control weakened. Pinned by
new `apps/dashboard/test/clone-preflight.test.ts` (5 tests).

## Phase 2C — Live OAuth isolation

- Northstar project A has its OWN separate OAuth Server (a distinct
  identity provider; disabled by default = fail-closed). Enabled it and
  registered a disposable **Northstar-only** OAuth client:
  app `northstar-clone-proof-20260827-mcp`, client_id
  `5e9f0019-365c-48c2-9026-6d801a526689` (Confidential), redirect URI
  `https://northstar-clone-proof-20260827.vercel.app/oauth/callback`. The
  generated client secret was NOT copied, logged, or recorded.
- Isolation:
  - Separate OAuth client + Northstar-only callback ✓ (registered solely
    in Northstar's identity provider, issuer
    `https://tjndmioqwzdolqjtxjvh.supabase.co`).
  - A Preston OAuth client id / redirect / token is unknown to the
    Northstar OAuth server (different project, different client registry)
    → rejected. The deployed clone's own control OAuth is DISABLED (503),
    so it never presents Preston's client id.
  - Anonymous denied (proven throughout).
  - No Preston OAuth registration was accessed or modified.

### §C6 — the one rule-bounded assertion

A fully live "present a genuine Preston-issued token to Northstar and
observe rejection" test would require obtaining/using a Preston production
credential, which the mission expressly prohibits. That rejection is
therefore enforced two ways short of the forbidden test: (1) cryptographic
— Supabase signs tokens with a per-project secret and stamps a per-project
issuer/audience, so a Preston token cannot validate against Northstar; and
(2) authorization-layer, proven LIVE — a Preston owner identity presented
to the Northstar database returns 0 rows and is refused for approvals
(§E rows 3/7). This is a rule-mandated substitution, not an unproven gap.

## Phase 2D — Live storage isolation (project A)

Private `artifacts` bucket + owner-scoped RLS + 2 synthetic objects whose
flattened names would collide under the pre-hardening scheme:

| # | Check | Result |
|---|---|---|
| 1 | bucket public flag | **false** (private) |
| 2 | anon lists objects | **0** (denied) |
| 3 | non-owner lists objects | **0** |
| 4 | Preston identity lists NS objects | **0** |
| 5 | NS owner lists own objects | **2** |
| 6 | distinct collision-resistant keys | **2** |

Plus (from §2A row 7) project B's bucket has **0 objects** — a restored
artifact metadata row cannot retrieve project A's object. Signed-URL
cryptographic scoping is structural (each project signs with its own
secret); the RLS + bucket-privacy + cross-project layers are proven live.

## E. Final live isolation matrix (database, from the Northstar DB)

| # | Assertion | Result |
|---|---|---|
| 1 | anon reads master_goals | **DENIED** |
| 2 | non-owner authenticated reads goals | **0 rows** |
| 3 | PRESTON owner identity reads goals | **0 rows** (no authority) |
| 4 | NS owner reads own canaries | goals/jobs/approvals/artifacts = 1 each |
| 5 | Preston prod record ids in Northstar | **0/0/0** (not found, no leak) |
| 6 | non-owner decides approval | **REFUSED: owner_required** |
| 7 | PRESTON identity decides NS approval | **REFUSED: owner_required** |
| 8 | canary approval after attacks | **pending** |
| 9 | unknown job kind insert | **REFUSED** (check constraint) |
| 10 | anon reads artifacts | **DENIED** |

Lease/job isolation rides the same goal_jobs/RLS layer (rows 4/5): a
Northstar job row is invisible and unleaseable to any non-Northstar-owner
identity, and Preston job ids are not found. RED/BLACK controls remain
fail-closed (system_controls seeded halted; classification gate row 9).

## D. Production non-impact (before AND after)

- `preston-os-prod` `/api/health` 200 connected; `/api/control/status`
  no-token → 401; **10 ops**; `origin/master` = **`6ea49a2`** (unchanged).
- `preston-os-staging` `/api/health` 200 connected (unchanged).
- No Preston database, storage, OAuth, runtime, host, deployment, alias, or
  master ref was modified. The clone lived in a SEPARATE Supabase org and a
  SEPARATE Vercel project, and never held a production-capable Preston
  credential.

## Validation matrix (this session's code changes)

- New/changed code: `scripts/clone/preflight.mjs` (whole-env foreign-ref
  scan), `apps/dashboard/test/clone-preflight.test.ts` (new, 5 tests).
- Full Vitest suite: **125 files, 1,675 pass** (+1 expected fail);
  the excluded `worktree-prep.test.ts` is the pre-existing bash-less-host
  env limitation. `tsc` (app + osruntime) clean; `eslint` clean.
- Secret scanner / RED-boundary scanner: run by the pre-commit hook on the
  evidence commit (0/0).

## Rollback / commits

- Evidence commit (this report + preflight hardening + test): recorded in
  the final response; local on `hardening/audit-repairs-clone-proof`, NOT
  pushed.
- Rollback point: branch base `6ea49a2` (sealed master lineage).

## Remaining risks / owner actions

- The §C6 live Preston-token rejection test is intentionally not run
  (prohibited); enforced structurally + identity-layer.
- Signed-URL live cross-retrieval is structural (per-project signing).
- Teardown of the disposable resources follows in Phase 4 (marker-scoped).
