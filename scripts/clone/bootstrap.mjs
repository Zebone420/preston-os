#!/usr/bin/env node
// Instance bootstrap (Gate 2). Idempotent, fail-closed, local-only: it
// never creates cloud resources, never deploys, and never handles a real
// secret. It takes a CLEAN checkout of the platform plus an instance
// config to a VERIFIED, testable local instance, and tells the operator
// exactly which owner-run cloud steps remain (see
// docs/CLONE_REPRODUCIBILITY_RUNBOOK_v1.md).
//
//   node scripts/clone/bootstrap.mjs <instance.config.json> [--quick] [--skip-install]
//
// Steps (each recorded in clone-bootstrap-report.json):
//   1. toolchain check (node >= 20, npm present)
//   2. instance config schema validation
//   3. preflight (origin-value / reuse / production-target denial)
//   4. dependency install: npm ci in apps/dashboard (lockfile-verified;
//      skipped when node_modules exists unless --fresh)
//   5. verification: vitest suite (--quick runs the core safety suites)
//   6. write the disposable-instance marker + bootstrap report
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadInstanceConfig } from './validate_instance_config.mjs';
import { preflight } from './preflight.mjs';

const t0 = Date.now();
const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith('--'));
const QUICK = args.includes('--quick');
const SKIP_INSTALL = args.includes('--skip-install');
const FRESH = args.includes('--fresh');

const repoRoot = resolve(join(import.meta.dirname ?? '.', '..', '..'));
const appDir = join(repoRoot, 'apps', 'dashboard');
const report = { schema_version: 1, started_at: new Date().toISOString(), steps: [], ok: false };

function step(name, fn) {
  const s = Date.now();
  try {
    const detail = fn() ?? null;
    report.steps.push({ name, ok: true, ms: Date.now() - s, detail });
    console.log(`[bootstrap] ${name}: ok (${Date.now() - s}ms)`);
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - s, detail: String(e?.message ?? e) });
    console.error(`[bootstrap] ${name}: FAILED - ${e?.message ?? e}`);
    finish(1);
  }
}

function finish(code) {
  report.ok = code === 0;
  report.finished_at = new Date().toISOString();
  report.total_ms = Date.now() - t0;
  try {
    writeFileSync(join(repoRoot, 'clone-bootstrap-report.json'),
      JSON.stringify(report, null, 2));
  } catch { /* report best-effort */ }
  process.exit(code);
}

if (!configPath) {
  console.error('usage: node scripts/clone/bootstrap.mjs <instance.config.json> [--quick] [--skip-install] [--fresh]');
  process.exit(1);
}

let cfg = null;

step('toolchain', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`node >= 20 required (found ${process.versions.node}); install Node 20 LTS or newer`);
  }
  const npmv = execSync('npm --version', { encoding: 'utf8', cwd: repoRoot }).trim();
  return { node: process.versions.node, npm: npmv };
});

step('instance-config', () => {
  const loaded = loadInstanceConfig(resolve(configPath));
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  cfg = loaded.config;
  return { slug: cfg.instance.slug, mode: cfg.instance.mode };
});

step('preflight', () => {
  const r = preflight(cfg, process.env);
  if (!r.ok) throw new Error(r.blocks.join('; '));
  return { checks: 'clean' };
});

step('dependencies', () => {
  if (SKIP_INSTALL) return { skipped: true };
  const present = existsSync(join(appDir, 'node_modules'));
  if (present && !FRESH) return { reused: true };
  // npm ci verifies every package against the committed lockfile's
  // integrity hashes and refuses drift - the lockfile IS the dependency
  // contract. --ignore-scripts: no package lifecycle script executes.
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });
  return { installed: true };
});

step('verification', () => {
  const quickSuites = [
    'test/composer-engine.test.ts', 'test/composer-security.test.ts',
    'test/dispatcher.test.ts', 'test/hardening-audit-repairs.test.ts',
    'test/real-executor.test.ts', 'test/artifact-platform.test.ts',
    'test/orchestration-security-regressions.test.ts',
  ];
  const argv = QUICK
    ? ['vitest', 'run', ...quickSuites]
    : ['vitest', 'run', '--exclude', 'test/worktree-prep.test.ts'];
  execFileSync('npx', argv,
    { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });
  return { mode: QUICK ? 'quick' : 'full' };
});

step('marker', () => {
  // The disposable-instance marker scopes teardown.mjs: it refuses to act
  // on any directory that does not carry this exact marker.
  writeFileSync(join(repoRoot, '.clone-instance-marker.json'), JSON.stringify({
    marker: 'preston-platform-disposable-instance',
    slug: cfg.instance.slug, mode: cfg.instance.mode,
    created_at: new Date().toISOString(),
  }, null, 2));
  return { marker: true };
});

console.log('[bootstrap] COMPLETE. Owner-run cloud steps (if going live) are in docs/CLONE_REPRODUCIBILITY_RUNBOOK_v1.md');
finish(0);
