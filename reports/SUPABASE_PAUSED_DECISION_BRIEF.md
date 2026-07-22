# SUPABASE PAUSED PROJECTS - OWNER DECISION BRIEF

Date: 2026-07-21. Decision owner: you. Nothing is unpaused or
exported until you execute the gate below. Claude cannot and will
not perform any step in this brief.

## The facts (owner-verified 2026-07-21)

| Project | Resume deadline | After deadline | Export path |
|---|---|---|---|
| preston-ai-andersen | 28 Sep 2026 (69 days) | "not resumable, but data will still be available for download" | requires unpause |
| preston-ai-pathc-dev | 23 Sep 2026 (64 days) | same wording | requires unpause |

Both Free Plan, $0. Sizes invisible while paused.

## The decision

WHEN to run one controlled resume-and-export session for each
project (they can share a session). Options:

1. SOON (recommended window: by 2026-08-15). Pros: the resume
   path is exercised while unambiguously supported; Session A/B
   evidence (repo clones, WF-1/WF-3 exports) will by then tell us
   what the andersen project should contain, sharpening export
   verification; slack remains if anything misbehaves. Cons:
   none material.
2. LATE (early Sep 2026). Pros: none over option 1. Cons: single
   attempt window if problems arise; vacation/schedule risk.
3. NEVER RESUME - rely on the post-deadline "download" promise.
   Cons: unverified promise wording, unknown format, no second
   chance; REJECTED as the plan of record (acceptable only as
   the fallback if the deadline is missed).

RECOMMENDED DECISION: option 1 - schedule one session before
2026-08-15, after Sessions A+B evidence returns (target: within
2 weeks of that evidence).

## Risk of waiting

The banner promises post-deadline downloads, but that path is
untested, format-unknown, and outside your control. Every week
past mid-August converts a routine export into a deadline event.

## Cost of a controlled temporary resume

Free Plan resume: $0 expected. Compute resumes on the free tier;
no plan change required. Time: ~30-60 min for both projects.

## Export objective and minimum necessary export

- preston-ai-andersen: full database export (schema + data) -
  it may hold the only processed Andersen chunks/embeddings.
  Minimum: complete pg dump equivalent via the dashboard backup/
  download; ALSO list storage buckets and download any objects.
- preston-ai-pathc-dev: full export too (it is small or empty
  with high probability, so "full" is cheap); plus a screenshot-
  level note of the table list so the origin question can close.

## Owner-run steps (when you execute the gate)

1. Dashboard -> project -> Resume. Wait for healthy state.
2. IMMEDIATELY note: table list + row counts (Table Editor
   overview), storage buckets, extensions list (is pgvector
   installed on andersen?), auth users count.
3. Download a full backup/export (Database -> Backups or
   pg_dump via the dashboard's connection info if needed - if
   this requires the connection string, treat it as a
   credential: use it, never paste it anywhere).
4. Save exports to C:\dev\legacy-audit\supabase\<project>\.
5. Verify each export file is non-zero size and opens (a dump
   header is enough); note file sizes.
6. Re-pause: dashboard -> Pause project (Free Plan pauses are
   allowed; if a project cannot be re-paused for any reason,
   just leave it - $0 either way - and note it).
7. Report back: table lists, sizes, pgvector yes/no, export
   paths.

Credential precautions: the connection string is a secret - use
it only in your terminal if needed, never share it, never save it
into the evidence folder. Rollback: none needed - resume/pause is
the platform's supported lifecycle; worst case a project stays
active at $0 until re-paused.

## How Sessions A/B may reduce scope

If the vault repo (Session A) contains all raw documents AND WF-1
(Session B) shows the Supabase content is fully regenerable from
them, the andersen export drops from "irreplaceable rescue" to
"verification corpus" - still worth exporting (cheap), but no
longer deadline-critical. pathc-dev scope cannot shrink (unknown
purpose requires the export regardless).

## Recommended decision date

Decide by: 2026-08-01. Execute by: 2026-08-15.
