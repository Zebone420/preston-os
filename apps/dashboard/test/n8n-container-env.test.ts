// Live defect regression (2026-08-18, n8n gate): the dedicated-host
// cloud-init created the n8n container while /etc/n8n.env was still
// empty, and its comment claimed `docker restart n8n` would load the
// later-added variables. Docker bakes --env-file at CREATE time and
// restart never re-reads it, so N8N_SSOT_TOKEN / N8N_SSOT_ANON_KEY
// were absent from the running container and every $env reference in
// workflow 1 would resolve empty. These pins keep the recreation
// procedure canonical and the artifacts inert.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const cloudInit = readFileSync(
  join(ROOT, 'deploy', 'n8n', 'cloud-init-n8n-host.yaml'), 'utf8');
const recreate = readFileSync(
  join(ROOT, 'deploy', 'n8n', 'recreate-n8n-container.sh'), 'utf8');
const workflow = JSON.parse(readFileSync(
  join(ROOT, 'deploy', 'n8n', 'workflow-1-ssot-intake.json'), 'utf8'));

describe('n8n container env-file procedure', () => {
  it('cloud-init no longer claims a bare restart loads the env file', () => {
    expect(cloudInit).not.toMatch(/docker restart n8n\s*$/m);
    expect(cloudInit).toContain('recreate-n8n-container.sh');
  });
  it('cloud-init still creates the container with the env file', () => {
    expect(cloudInit).toContain('--env-file /etc/n8n.env');
  });
  it('recreation script rebinds localhost-only with env file + volume', () => {
    expect(recreate).toContain('--env-file /etc/n8n.env');
    expect(recreate).toContain('-p 127.0.0.1:5678:5678');
    expect(recreate).toContain('-v /opt/n8n:/home/node/.n8n');
    expect(recreate).toContain('--restart unless-stopped');
  });
  it('recreation script prints env NAMES only, never values', () => {
    // every env listing is piped through cut -d= -f1 before output
    const listings = recreate
      .split('\n')
      .filter((l) => l.includes('.Config.Env'));
    expect(listings.length).toBeGreaterThan(0);
    expect(recreate).toContain("cut -d= -f1");
    expect(recreate).not.toMatch(/echo \$N8N_SSOT/);
  });
  it('recreation script does not activate anything', () => {
    for (const word of ['activate', 'active', 'webhook', 'import']) {
      expect(recreate.toLowerCase()).not.toContain(word);
    }
  });
  it('workflow 1 stays inert and env-credentialed', () => {
    expect(workflow.active).toBe(false);
    const json = JSON.stringify(workflow);
    expect(json).toContain('$env.N8N_SSOT_TOKEN');
    expect(json).toContain('$env.N8N_SSOT_ANON_KEY');
    // no literal bearer/token value embedded (64-hex would be a leak)
    expect(json).not.toMatch(/[0-9a-f]{64}/);
  });
});
