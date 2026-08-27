# Preston Artifact Durability — Design v1 (fast-track Phase I)

Status: DESIGN + OWNER GATE PREP. Nothing here is activated; no bucket,
migration, secret, or config exists yet. This document is the exact bounded
proposal the owner approves before any storage infrastructure is created.

## Problem

SSOT (Supabase) holds results and evidence refs; the actual work product of a
run — a diff, a generated document, a report file — survives only as long as
the host worktree/branch does (worktrees are removed after every run; only
the bounded result_excerpt and structured block survive). Business automation
(quotes, proposals, drawings, exports) needs durable, access-controlled,
provenance-linked artifacts.

## Design (smallest useful)

### 1. Artifact metadata table (`artifacts`, migration 00XX — owner-applied)

| column | type | note |
|---|---|---|
| artifact_id | text pk | `art-<uuid>` |
| goal_id / job_id / run_id | text | provenance chain (FK goal_jobs where applicable) |
| type | text | `diff` / `document` / `pdf` / `image` / `export` / `report` |
| name | text | bounded display name |
| content_sha256 | text | integrity hash, computed at write |
| storage_ref | text | `supabase://artifacts/<goal_id>/<job_id>/<artifact_id>` |
| source | text | `worker_generated` / `owner_uploaded` |
| provider / commit_sha | text null | worker attribution + local commit when code |
| created_at | timestamptz | |
| retention_state | text | `active` / `expired` / `deleted` (default active) |

RLS: owner-only, same idiom as every 0010-series table; anon fully revoked;
insert restricted to owner + runtime identity; no delete grant (retention via
state column; physical deletion is an owner action).

### 2. Object storage

Supabase Storage bucket `artifacts` in the SAME project as the SSOT (staging
first, then production) — managed, access-controlled (owner-only policies,
no public access), no new vendor, no new secret (the runtime identity's
existing JWT authorizes through storage RLS policies).

Write path: the run-owned terminal transition already owns the moment a
result is final. A post-run `persistArtifacts` step (os-runtime, bounded:
max 10 files, 10 MB each, allowlisted extensions, secret-scanned text types)
uploads from the worktree BEFORE `releaseWorktree`, computes sha256, inserts
metadata, and appends `artifact:<id>` evidence refs to the job row.

Read path: Preston Control gains `preston_get_artifact` (read-only, owner,
signed URL with short TTL) — a later gate; v1 can expose metadata through the
existing evidence surface first.

## Why not the worker VM as a file server

Host disk is not durable (rebuilt at every promotion), not access-controlled
for remote reads, and unreachable when the host is down. Managed storage is
the boring correct answer; no new service is introduced (Supabase already
holds the SSOT).

## OWNER GATE (exact, bounded — nothing proceeds without it)

1. **Action**: create Supabase Storage bucket `artifacts` (private) in
   staging project + apply migration `00XX_artifacts.sql` (table + RLS +
   storage policies) to staging.
2. **Why consequential**: new storage infrastructure + a DB migration + RLS
   policy addition.
3. **Environment**: STAGING first; production only after a staging drill
   passes and a separate SHA-bound production authorization.
4. **Change**: exactly the migration file + bucket creation; no code path
   activates until `ORCH_ARTIFACTS_ENABLED=true` is also set (a further env
   gate the owner controls).
5. **Rollback**: drop policies + table (migration down), delete bucket
   (empty); the runtime ignores artifacts entirely with the env gate unset.
6. **Confirmation phrase**:
   `OWNER AUTHORIZES ARTIFACT STORAGE: staging bucket + migration 00XX`

## Deferred (explicitly out of v1)

Signed-URL tool surface, retention sweeps, owner uploads, artifact diffing,
cross-artifact search.
