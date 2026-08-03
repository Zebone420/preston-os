# LA-10 OFF-HOST BACKUP COPY - OWNER PACKET (2026-08-02)

Goal: place a verified copy of the 2026-07-27 staging pg_dump in at
least one location that is NOT this PC (ZPC26), closing the LA-10
single-copy risk. Read-only with respect to Supabase; nothing touches
the database. No secrets are involved: the dump file itself contains
business data - treat the DESTINATION as confidential storage.

## 0. Source facts (verified fresh on 2026-08-02 by direct read)

- Source: C:\dev\backups\preston-os-staging-2026-07-27-1936.dump
- Size: 573,705 bytes; last write 2026-07-27 19:36:26
- SHA-256 (recomputed 2026-08-02, MATCHES the gate-close record):
  169277328C65576E794271144B88EA4CFC01AABDB937EC53C3B93327D8EF97BF
- Companion toc listing: preston-os-staging-2026-07-27-1936.dump.toc.txt
  (129,492 bytes) - copy it alongside the dump.
- Also present in C:\dev\backups: six 0-byte failed attempts (7/23 x5,
  7/27 19:31) and one partial 573,648-byte file (7/27 19:35). These are
  NOT the backup. Optional owner cleanup AFTER the off-host copy
  passes; never before.

## 1. Owner decision required: destination

Pick at least one OFF-HOST destination (placeholder <DEST> below):
  a) External USB drive kept separately (simplest, no cloud egress)
  b) Owner-controlled cloud drive (Google Drive of info@preston.nyc)
  c) Both (recommended: one offline + one cloud)
Rule: the destination must be owner-controlled and access-restricted.
Do not use shared/public folders.

## 2. Copy procedure (PowerShell, run as owner on ZPC26)

```powershell
# 2.1 pre-copy: confirm source facts match section 0
Get-Item C:\dev\backups\preston-os-staging-2026-07-27-1936.dump |
  Select-Object Length, LastWriteTime
Get-FileHash -Algorithm SHA256 `
  C:\dev\backups\preston-os-staging-2026-07-27-1936.dump

# 2.2 copy dump + toc (replace <DEST> with the real path)
Copy-Item C:\dev\backups\preston-os-staging-2026-07-27-1936.dump <DEST>
Copy-Item C:\dev\backups\preston-os-staging-2026-07-27-1936.dump.toc.txt `
  <DEST>

# 2.3 post-copy: hash the COPY
Get-FileHash -Algorithm SHA256 `
  <DEST>\preston-os-staging-2026-07-27-1936.dump
```

For a cloud destination: upload via the browser, then re-download to a
scratch folder and hash the re-downloaded file (a hash of the local
sync cache does not prove the cloud copy).

## 3. Readability verification of the copy (proves it is a restorable
archive, not just identical bytes)

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -l `
  <DEST>\preston-os-staging-2026-07-27-1936.dump > $env:TEMP\la10-toc.txt
$LASTEXITCODE
(Get-Content $env:TEMP\la10-toc.txt | Measure-Object -Line).Lines
```

EXPECT: exit code 0 and a toc line count consistent with the recorded
862 toc entries. This reads the archive only - it restores nothing.

## 4. PASS / FAIL criteria

PASS requires ALL of:
- 2.1 size = 573,705 and SHA-256 = 169277328C...D8EF97BF (full match)
- 2.3 copy SHA-256 IDENTICAL to 2.1
- 3 pg_restore -l exit 0 on the COPY, toc count matches
- destination is off-host and owner-controlled
FAIL on any mismatch: delete the bad copy, re-copy, re-verify. Never
overwrite the source. The source stays in C:\dev\backups regardless.

## 5. Evidence to record at close

Destination type (not the full private path if sensitive), copy date,
both hashes, pg_restore exit code + toc count. Record in
EXTERNAL_ASSET_EVIDENCE_REGISTER (backup section) and mark LA-10
CLOSED in the retirement-audit docs. Note: this dump covers the
staging DB at 2026-07-27 - migrations 0010+ applied later are NOT in
it; the next backup gate (post-0010 pg_dump) stays on the roadmap.
