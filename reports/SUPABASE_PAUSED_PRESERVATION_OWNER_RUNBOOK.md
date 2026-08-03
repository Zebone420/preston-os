# SUPABASE PAUSED-PROJECT PRESERVATION - OWNER RUNBOOK (2026-08-02)

STATUS: the decision brief's recommended decide-by date (2026-08-01)
has PASSED. Execution window: complete resume -> export -> verify ->
re-pause by 2026-08-15. HARD DEADLINES: 2026-09-23 and 2026-09-28
(after these, recovery of the paused projects is no longer assured).
Nothing in this runbook is executed by the build agent: every step
needs owner dashboard login and/or the database password. No
production system of record is touched; these are legacy projects.

## 0. Inventory (from Gate 0 evidence, 2026-07-22, in-browser)

Org: "info@preston.nyc's Org" (Free plan, sole member = owner).
Projects (3):
  1) preston-os-staging - ACTIVE. Not part of this runbook.
  2) preston-ai-andersen - PAUSED. HOLDS THE ANDERSEN KNOWLEDGE DATA.
     EXPORT PRIORITY 1 (time-sensitive; feeds the knowledge-layer
     plan; parity gate G6 later governs any deletion - NOT now).
  3) preston-ai-pathc-dev - PAUSED. Likely a typo'd dev project;
     strongest delete candidate, but STILL EXPORT IT first (cheap
     insurance; deletion only via the retirement audit, never here).
Project refs/IDs: keep OUT of committed docs (they appear in public
URLs); record them in the private evidence register copy only.

Precondition recommended first (LA-11): enable MFA on the Supabase
account before resuming anything.

## 1. Per-project procedure (run for andersen FIRST, then pathc-dev)

### 1.1 Resume (owner, dashboard)
- Dashboard -> project -> Restore/Resume. Wait until status = Active
  (can take minutes). Record UTC timestamp.
- If the old database password is unknown: Settings -> Database ->
  Reset database password (this is a LEGACY project; nothing depends
  on the old password). Store in 1Password. Never in chat/files.

### 1.2 Export database (owner, PowerShell on ZPC26)
Use the SESSION POOLER host/port shown on the project's connect page
(direct db.<ref> host is IPv6-only; ZPC26 has no global IPv6 - proven
2026-07-27). Let pg_dump prompt for the password interactively (the
ratified no-env-var method).

```powershell
New-Item -ItemType Directory -Force C:\dev\backups\legacy | Out-Null
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" `
  -h <SESSION_POOLER_HOST> -p 5432 -U <POOLER_USER> -d postgres `
  -Fc -f C:\dev\backups\legacy\<project>-2026-08-XX.dump
$LASTEXITCODE   # EXPECT 0
```

Then capture toc + hash (EXPECT exit 0; nonzero = re-dump):

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -l `
  C:\dev\backups\legacy\<project>-2026-08-XX.dump `
  > C:\dev\backups\legacy\<project>-2026-08-XX.toc.txt
$LASTEXITCODE
Get-FileHash -Algorithm SHA256 `
  C:\dev\backups\legacy\<project>-2026-08-XX.dump
Get-Item C:\dev\backups\legacy\<project>-2026-08-XX.dump |
  Select-Object Length, LastWriteTime
```

Sanity: the andersen dump should be NON-TRIVIAL in size (it holds
knowledge data). A 0-byte or few-KB file = FAIL: check pooler host,
IPv6 note, password; re-run. Record size + SHA-256 + toc line count.

### 1.3 Export storage + other assets (owner, dashboard)
- Storage: check Storage -> buckets. If any bucket exists, download
  all objects (per-bucket) into
  C:\dev\backups\legacy\<project>-storage\. Staging had 0 buckets;
  the legacy projects are UNKNOWN - check, do not assume.
- Auth users: SQL editor, read-only:
  `select count(*) from auth.users;` and if nonzero, export via
  CSV download of `select * from auth.users;` (contains hashes -
  same confidentiality as the dump).
- Edge functions / custom schemas: pg_dump -Fc already covers all
  schemas it can read as the connecting role; note any dashboard-only
  config (custom domains, secrets NAMES only) in the evidence file.

### 1.4 Verify before re-pausing (owner)
PASS criteria per project - ALL required:
- pg_dump exit 0 AND pg_restore -l exit 0
- SHA-256 recorded; size sane (andersen: expect clearly > 1 MB;
  pathc-dev: any consistent size, even small, is acceptable if toc
  lists the expected schemas)
- storage objects downloaded (or "0 buckets" recorded as evidence)
- files land under C:\dev\backups\legacy\ AND get an off-host copy
  per the LA-10 packet procedure (same hash-copy-hash-readback steps)
DO NOT re-pause until PASS.

### 1.5 Re-pause (owner, dashboard)
- Dashboard -> project -> Pause. Record UTC timestamp + status.
- Free-plan note: an idle restored project may also auto-pause after
  ~7 days; the explicit pause is still the recorded evidence.

## 2. Evidence to record (private register copy; no refs/secrets in
committed files)

Per project: resume timestamp, dump filename/size/SHA-256, toc line
count, storage bucket count + object count, auth user count, off-host
copy hash match, re-pause timestamp. Then update:
- EXTERNAL_ASSET_EVIDENCE_REGISTER (Supabase section)
- FINAL_DISPOSITION_REGISTER: andersen = data preserved (deletion
  still gated on knowledge-layer parity G6); pathc-dev = data
  preserved (delete candidate advances to the retirement audit)
- EVIDENCE_GAP_REGISTER: close the paused-project export gap

## 3. Timeline

- NOW -> 2026-08-15: execute this runbook (both projects).
- 2026-09-23 / 2026-09-28: HARD Supabase deadlines - if the runbook
  has not run by ~2026-09-15, treat it as an emergency task.
- Deletion of either project: NEVER via this runbook; only via the
  adversarial retirement audit with its own owner approval.
