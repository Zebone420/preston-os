# GITHUB REPOSITORY AUDIT

Date: 2026-07-21. Read-only. The safety guard treats outbound git
(clone/fetch) as owner-run, so remote inspection used HTTPS
reachability only; deep inspection of the two private repos is
packaged as owner evidence item B.

## 1. Zebone420/preston-os - RETAIN (authoritative)

- Default branch master; latest commit e0609d3 (+ local closeout
  commits this session, unpushed). Active daily. VERIFIED.
- Stack: Next.js 16.2.10 / React 19 / TypeScript 5 / Tailwind 4 /
  vitest 4 / @supabase/ssr; separate tsc CommonJS os-runtime
  build; packages/guards safety library.
- Migrations: supabase/migrations 0001-0009 (0007/0008 authored
  unapplied). Deployment: Vercel (apps/dashboard) + host-agnostic
  deploy/systemd units. CI: none yet (NEXT_GATES backlog).
  Docker: none. Env template: names only (env.template).
- Tests 664; scanners embedded in pre-commit; secret + RED scans
  0 findings (VERIFIED this session).
- External references: Supabase staging URL placeholder names,
  Vercel staging URL in one verify script, Airtable TEST env
  names, Google OAuth env names, Telegram env names. No secrets
  (scan-verified). No production identifiers.

## 2. Zebone420/preston-ai-andersen-graph - INVESTIGATE

- VERIFIED today: HTTP 404 anonymously -> private, renamed, or
  deleted. (Gate 0A recorded it as publicly visible on
  2026-07-03 with an owner action to decide visibility - the 404
  is consistent with that action having been taken. Which of
  private/renamed/deleted is UNKNOWN.)
- Everything else (branch, commits, language, ontology, ingestion
  code, secret exposure) is UNKNOWN pending owner export
  (evidence packet item B).
- Expected content (INFERRED from name + Gate 0A + master plan
  Knowledge Librarian): Andersen product graph/ontology,
  relationship/compatibility modeling, possibly visualization.
- Audit questions for the export: graph schema format; any
  Supabase ref or credential in code/config; ingestion pipeline
  overlap with WF-1; whether the schema is worth porting to the
  future pgvector/graph knowledge layer (master plan reassigned
  Graphify -> Supabase pgvector); commit history for provenance.
- Disposition: after export + review -> ARCHIVE the repo on
  GitHub (archive flag, read-only) and INTEGRATE the schema into
  the knowledge-layer proposal. Not a deletion candidate (repos
  are free; history has provenance value).

## 3. Zebone420/preston-ai-andersen-vault - INVESTIGATE

- VERIFIED today: HTTP 404 anonymously (same reasoning as above).
- Expected content (INFERRED): Andersen source documents, chunk
  outputs, metadata - possibly large binaries.
- Audit questions for the export: does it hold ORIGINAL vendor
  documents (licensing/redistribution restrictions apply -
  Andersen literature is vendor IP; keep the repo PRIVATE
  regardless of outcome); do the same documents exist in Supabase
  preston-ai-andersen (duplication); any committed secrets
  (highest risk of the three repos - data repos accumulate
  credentials in scripts); file sizes vs GitHub limits.
- Disposition: after export + licensing review -> ARCHIVE
  (private, archived). If Supabase holds identical processed
  data, the repo remains the raw-source archive and Supabase
  becomes the deletion candidate after migration - not both.

## 4. Secret-scan requirement for items 2-3

The owner export (packet B) must be scanned locally with the
repo's own scanners before any content is committed into
preston-os. Nothing from either repo is merged automatically;
any import happens through the Andersen knowledge-layer proposal
with provenance metadata.
