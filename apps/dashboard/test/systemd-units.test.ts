import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static regression tests for the tracked systemd deployment artifacts.
// Added after a staging deployment defect: ProtectSystem=strict seals /var/lib
// read-only, and the units lacked ReadWritePaths for the token stores, so the
// atomic refresh-token rotation died with EROFS on the host. These tests pin
// the writable-path carve-outs, the never-auto-start property, the hardening
// set, the worker/hermes identity separation, and (Phase 7) the flock
// serialization of every oneshot that shares the worker token store.

const unit = (name: string) =>
  readFileSync(new URL(`../../../deploy/systemd/${name}`, import.meta.url), 'utf8');

const workerSvc = unit('preston-worker.service');
const hermesSvc = unit('preston-hermes-observe.service');
const orchSvc = unit('preston-orchestrator.service');
const workerTimer = unit('preston-worker.timer');
const hermesTimer = unit('preston-hermes-observe.timer');
const orchTimer = unit('preston-orchestrator.timer');

// The flock file every worker-identity oneshot must serialize on: two
// concurrent startups would race the one-time refresh-token rotation and
// could revoke the whole session family (Codex initial-review MAJOR #5).
const LOCK = '/var/lib/preston/worker/.dispatch.lock';

describe('systemd services - token store writable under ProtectSystem=strict', () => {
  it('worker service carves out exactly its own token-store path', () => {
    expect(workerSvc).toMatch(/^ReadWritePaths=\/var\/lib\/preston\/worker$/m);
    expect(workerSvc).not.toMatch(/ReadWritePaths=.*hermes/);
  });
  it('hermes service carves out exactly its own token-store path', () => {
    expect(hermesSvc).toMatch(/^ReadWritePaths=\/var\/lib\/preston\/hermes$/m);
    expect(hermesSvc).not.toMatch(/ReadWritePaths=.*worker/);
  });
  it('orchestrator shares the worker identity carve-out (same token store)', () => {
    expect(orchSvc).toMatch(/^ReadWritePaths=\/var\/lib\/preston\/worker$/m);
    expect(orchSvc).not.toMatch(/ReadWritePaths=.*hermes/);
  });
  it('strict protection stays on in all (the carve-out must not widen)', () => {
    for (const svc of [workerSvc, hermesSvc, orchSvc]) {
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
    expect(orchSvc).not.toMatch(/^\[Install\]/m);
  });
  it('timers install into timers.target and target their service', () => {
    expect(workerTimer).toMatch(/^WantedBy=timers\.target$/m);
    expect(workerTimer).toMatch(/^Unit=preston-worker\.service$/m);
    expect(hermesTimer).toMatch(/^WantedBy=timers\.target$/m);
    expect(hermesTimer).toMatch(/^Unit=preston-hermes-observe\.service$/m);
    expect(orchTimer).toMatch(/^WantedBy=timers\.target$/m);
    expect(orchTimer).toMatch(/^Unit=preston-orchestrator\.service$/m);
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
  it('all services keep the full hardening set', () => {
    for (const svc of [workerSvc, hermesSvc, orchSvc]) {
      for (const rx of REQUIRED) expect(svc).toMatch(rx);
    }
  });
  it('worker and hermes run as separate users with separate env files', () => {
    expect(workerSvc).toMatch(/^User=preston-worker$/m);
    expect(workerSvc).toMatch(/^EnvironmentFile=\/etc\/preston\/worker\.env$/m);
    expect(hermesSvc).toMatch(/^User=preston-hermes$/m);
    expect(hermesSvc).toMatch(/^EnvironmentFile=\/etc\/preston\/hermes\.env$/m);
  });
  it('orchestrator reuses the existing worker runtime identity (no new identity)', () => {
    expect(orchSvc).toMatch(/^User=preston-worker$/m);
    expect(orchSvc).toMatch(/^EnvironmentFile=\/etc\/preston\/worker\.env$/m);
  });
  it('all run the compiled dispatcher with a bounded loop', () => {
    expect(workerSvc).toMatch(
      new RegExp(`^ExecStart=/usr/bin/flock -w 90 ${LOCK} /usr/bin/node dist/os-runtime/bin\\.js worker-loop --max 5$`, 'm'),
    );
    expect(hermesSvc).toMatch(/^ExecStart=\/usr\/bin\/node dist\/os-runtime\/bin\.js hermes-loop --max 5$/m);
    expect(orchSvc).toMatch(
      new RegExp(`^ExecStart=/usr/bin/flock -w 90 ${LOCK} /usr/bin/node dist/os-runtime/bin\\.js orchestrate-once --max 10$`, 'm'),
    );
  });
});

describe('systemd services - shared token-store serialization (Phase 7)', () => {
  it('every worker-identity oneshot serializes on the SAME flock file', () => {
    for (const svc of [workerSvc, orchSvc]) {
      expect(svc).toContain(`/usr/bin/flock -w 90 ${LOCK} `);
    }
    // the lock file lives inside the single writable carve-out
    expect(LOCK.startsWith('/var/lib/preston/worker/')).toBe(true);
  });
  it('hermes (separate identity/store) does not take the worker lock', () => {
    expect(hermesSvc).not.toContain(LOCK);
  });
  it('orchestrator treats the owner halt (75) as success; worker keeps the recorded decision not to', () => {
    expect(orchSvc).toMatch(/^SuccessExitStatus=75$/m);
    expect(workerSvc).not.toMatch(/^SuccessExitStatus=/m);
  });
});
