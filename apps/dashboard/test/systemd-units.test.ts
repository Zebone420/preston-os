import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static regression tests for the tracked systemd deployment artifacts.
// Added after a staging deployment defect: ProtectSystem=strict seals /var/lib
// read-only, and the units lacked ReadWritePaths for the token stores, so the
// atomic refresh-token rotation died with EROFS on the host. These tests pin
// the writable-path carve-outs, the never-auto-start property, the hardening
// set, and the worker/hermes identity separation.

const unit = (name: string) =>
  readFileSync(new URL(`../../../deploy/systemd/${name}`, import.meta.url), 'utf8');

const workerSvc = unit('preston-worker.service');
const hermesSvc = unit('preston-hermes-observe.service');
const workerTimer = unit('preston-worker.timer');
const hermesTimer = unit('preston-hermes-observe.timer');

describe('systemd services - token store writable under ProtectSystem=strict', () => {
  it('worker service carves out exactly its own token-store path', () => {
    expect(workerSvc).toMatch(/^ReadWritePaths=\/var\/lib\/preston\/worker$/m);
    expect(workerSvc).not.toMatch(/ReadWritePaths=.*hermes/);
  });
  it('hermes service carves out exactly its own token-store path', () => {
    expect(hermesSvc).toMatch(/^ReadWritePaths=\/var\/lib\/preston\/hermes$/m);
    expect(hermesSvc).not.toMatch(/ReadWritePaths=.*worker/);
  });
  it('strict protection stays on in both (the carve-out must not widen)', () => {
    for (const svc of [workerSvc, hermesSvc]) {
      expect(svc).toMatch(/^ProtectSystem=strict$/m);
      // Only ONE ReadWritePaths line each - no accumulating extra writable paths.
      expect(svc.match(/^ReadWritePaths=/gm)?.length).toBe(1);
      // Never a broad carve-out.
      expect(svc).not.toMatch(/ReadWritePaths=\/var\/lib\/preston$/m);
      expect(svc).not.toMatch(/ReadWritePaths=\/(var)?$/m);
    }
  });
});

describe('systemd services - can never auto-start', () => {
  it('service units have NO [Install] section (only owner-enabled timers fire them)', () => {
    expect(workerSvc).not.toMatch(/^\[Install\]/m);
    expect(hermesSvc).not.toMatch(/^\[Install\]/m);
  });
  it('timers install into timers.target and target their service', () => {
    expect(workerTimer).toMatch(/^WantedBy=timers\.target$/m);
    expect(workerTimer).toMatch(/^Unit=preston-worker\.service$/m);
    expect(hermesTimer).toMatch(/^WantedBy=timers\.target$/m);
    expect(hermesTimer).toMatch(/^Unit=preston-hermes-observe\.service$/m);
  });
});

describe('systemd services - hardening and identity separation', () => {
  const REQUIRED = [
    /^Type=oneshot$/m,
    /^Restart=no$/m,
    /^NoNewPrivileges=true$/m,
    /^PrivateTmp=true$/m,
    /^ProtectHome=true$/m,
    /^RuntimeMaxSec=300$/m,
    /^TimeoutStartSec=120$/m,
    /^LogsDirectory=preston$/m,
  ];
  it('both services keep the full hardening set', () => {
    for (const svc of [workerSvc, hermesSvc]) for (const rx of REQUIRED) expect(svc).toMatch(rx);
  });
  it('worker and hermes run as separate users with separate env files', () => {
    expect(workerSvc).toMatch(/^User=preston-worker$/m);
    expect(workerSvc).toMatch(/^EnvironmentFile=\/etc\/preston\/worker\.env$/m);
    expect(hermesSvc).toMatch(/^User=preston-hermes$/m);
    expect(hermesSvc).toMatch(/^EnvironmentFile=\/etc\/preston\/hermes\.env$/m);
  });
  it('both run the compiled dispatcher with a bounded loop', () => {
    expect(workerSvc).toMatch(/^ExecStart=\/usr\/bin\/node dist\/os-runtime\/bin\.js worker-loop --max 5$/m);
    expect(hermesSvc).toMatch(/^ExecStart=\/usr\/bin\/node dist\/os-runtime\/bin\.js hermes-loop --max 5$/m);
  });
});
