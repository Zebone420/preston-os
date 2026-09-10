import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const strip = (raw: string) =>
  raw.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
const sql = strip(readFileSync(
  join(root, 'supabase', 'migrations', '0038_job_dependencies_natural_key.sql'), 'utf8'));
const rollback = strip(readFileSync(
  join(root, 'reports', 'p2_evidence', 'rollback', 'rollback_0038.sql.txt'), 'utf8'));

describe('migration 0038 - job_dependencies natural key (D2-L1)', () => {
  it('adds exactly one idempotent unique index on the edge triple and nothing else', () => {
    expect(sql).toMatch(
      /create unique index if not exists uq_job_dependencies_edge\s+on public\.job_dependencies \(goal_id, job_id, depends_on_job_id\);/,
    );
    expect(sql.match(/\bcreate\b/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\bupdate\b|\binsert\b|\balter\b/i);
  });

  it('rollback removes only that index', () => {
    expect(rollback.trim()).toBe('drop index if exists public.uq_job_dependencies_edge;');
  });
});
