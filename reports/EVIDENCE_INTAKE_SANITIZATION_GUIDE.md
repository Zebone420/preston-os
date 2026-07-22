# EVIDENCE INTAKE AND SANITIZATION GUIDE

Date: 2026-07-21. Governs how owner-returned legacy-audit
evidence is handled so nothing sensitive ever enters the tracked
repository.

## Storage model

- RAW evidence lives OUTSIDE the repo: C:\dev\legacy-audit\
  (layout in evidence-intake/README.md). It is never committed,
  never pasted wholesale into reports.
- The in-repo evidence-intake/ directory is git-ignored (only its
  README is tracked) as a backstop if a file must temporarily sit
  near the repo.
- .gitignore additionally blocks evidence-shaped filenames
  (workflow exports, dumps, billing images, HAR captures,
  credential inventories) repo-wide.
- What IS committed: sanitized SUMMARIES in the reports/
  registers (asset register, credential register, cost worksheet,
  backup register), written by Claude after sanitization.

## Sanitization procedure (Claude-run, per intake)

1. Read raw evidence from C:\dev\legacy-audit\ (read-only).
2. Extract only: names, identifiers, dates, counts, sizes,
   states, versions, node types, table names, DNS targets, cost
   amounts.
3. NEVER copy: tokens, keys, passwords, cookies, headers, OAuth
   payloads, connection strings, email bodies, client names/
   addresses/phones (PII), invoice addresses, card fragments.
4. n8n exports: even credential-excluded exports can carry
   sensitive literals inside node parameters (hardcoded emails,
   sheet IDs, API URLs with embedded keys). Scan each JSON for
   secret-shaped strings before quoting ANY node parameter;
   quote node TYPES and connection topology, not raw parameters,
   unless verified clean.
5. Vendor-licensed content (Andersen documents): never copied
   into the repo in any form; summaries reference filenames and
   counts only.
6. After writing any summary into reports/: run both repo
   scanners (secret + RED boundary) before committing; the
   pre-commit hook enforces this again at commit time.
7. If raw evidence itself must be preserved long-term, the owner
   archives it (1Password attachment, private storage) - the repo
   is never the archive for secrets or licensed content.

## PII note

Legacy workflows may embed real client data (deposit detectors,
open-loop coordinators). Execution histories and node parameters
are treated as PII-bearing until proven otherwise; summaries use
counts and patterns ("reads Airtable table X, filters on field
Y"), never client rows.

## Retention

Raw evidence in C:\dev\legacy-audit\ is kept until the retirement
program completes, then owner-archived or deleted at the owner's
discretion (it contains the only export copies until then - do
not clean it up early).
