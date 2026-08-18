// Live defect regression (2026-08-18, n8n gate): the provisioning
// script's static actor registry lacked n8n-1, so
// `-OnlyActor n8n-1` threw "Unknown actor id" AFTER migration 0016
// had widened the role CHECK. This pins registry/migration parity:
// every role the 0016 CHECK allows has a provisionable actor entry,
// and the integration actors start disabled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const script = readFileSync(
  join(ROOT, 'scripts', 'p1', 'p1_actor_provision.ps1'), 'utf8');
const mig0016 = readFileSync(
  join(ROOT, 'supabase', 'migrations', '0016_actor_role_n8n.sql'), 'utf8');

describe('actor provisioning registry parity', () => {
  it('0016 role CHECK includes n8n', () => {
    expect(mig0016).toMatch(/'n8n'\s*\)/);
  });
  it('script registry contains every provisionable actor', () => {
    for (const id of ['owner-remote-1', 'chatgpt-1', 'claude-1',
      'codex-1', 'hermes-1', 'n8n-1']) {
      expect(script).toContain(`'${id}'`);
    }
  });
  it('integration actors start disabled', () => {
    for (const id of ['codex-1', 'hermes-1', 'n8n-1']) {
      const line = script.split('\n').find((l) => l.includes(`'${id}'`));
      expect(line, id).toBeDefined();
      expect(line).toContain(`enabled = 'false'`);
    }
  });
  it('n8n-1 uses the n8n role from the 0016 CHECK', () => {
    const line = script.split('\n').find((l) => l.includes(`'n8n-1'`));
    expect(line).toContain(`role = 'n8n'`);
  });
});
