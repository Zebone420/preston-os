import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Backup/restore proof (P0 exit item, prepared 2026-09-08). The owner-run
// restore drill script is the written restore procedure the evidence
// template demands ("a backup nobody can restore is not a backup"). These
// pins keep its safety envelope fixed: it can only restore INTO a fresh
// scratch database on a server the owner names, never into the staging or
// production Supabase projects, and it records evidence.

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'scripts', 'p0', 'p0_restore_drill.ps1');
const BACKUP = resolve(REPO_ROOT, 'scripts', 'p0', 'p0_bootstrap_backup.ps1');

describe('p0_restore_drill.ps1 - owner-run restore drill (static pins)', () => {
  const src = readFileSync(SCRIPT, 'utf8');

  it('refuses both Supabase project refs and any Supabase endpoint as a target', () => {
    expect(src).toMatch(/vcqtlmlaxxankxyezlul/); // staging ref (same guard the backup script uses)
    expect(src).toMatch(/hiqsymsiwonmvrbbqhhe/); // production ref
    expect(src).toMatch(/supabase\\\.co\|supabase\\\.com\|pooler\\\.supabase/);
  });

  it('only ever restores into a preston_restore_drill_* database that does not exist yet', () => {
    expect(src).toMatch(/preston_restore_drill_\[a-z0-9_\]\+\$/);
    expect(src).toMatch(/already exists - choose a new name/);
  });

  it('restores with pg_restore --no-owner --no-privileges --exit-on-error and verifies against the TOC', () => {
    expect(src).toMatch(/pg_restore/);
    expect(src).toMatch(/--no-owner --no-privileges --exit-on-error/);
    expect(src).toMatch(/pg_restore -l failed/);
    expect(src).toMatch(/restored_public_tables/);
    expect(src).toMatch(/verdict: \$verdict/);
  });

  it('writes evidence under reports/p0_evidence and fails loudly on a bad verdict', () => {
    expect(src).toMatch(/restore_drill_evidence_/);
    expect(src).toMatch(/Restore drill FAILED/);
  });

  it('is pure ASCII (owner-terminal safe)', () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(src)).toBe(true);
  });

  it('the backup script it pairs with still produces the -Fc dump it expects', () => {
    const b = readFileSync(BACKUP, 'utf8');
    expect(b).toMatch(/pg_dump\b/);
    expect(b).toMatch(/-Fc/);
  });
});
