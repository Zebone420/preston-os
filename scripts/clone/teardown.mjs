#!/usr/bin/env node
// Disposable-instance teardown (Gate 2/3). SAFE-SCOPED: acts ONLY on a
// directory that carries the exact disposable-instance marker written by
// bootstrap.mjs, refuses everything else (including the real Preston
// checkout, which never carries the marker), and refuses well-known
// system roots outright. Local filesystem only - it never touches any
// cloud resource, database, or deployment.
//
//   node scripts/clone/teardown.mjs <instance-root-dir> [--confirm]
//
// Without --confirm it only REPORTS what would be removed (dry run).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const CONFIRM = args.includes('--confirm');

if (!target) {
  console.error('usage: node scripts/clone/teardown.mjs <instance-root-dir> [--confirm]');
  process.exit(1);
}
const root = resolve(target);

// Refuse obviously-wrong targets before any marker check.
const parts = root.split(sep).filter(Boolean);
if (parts.length < 3) {
  console.error(`REFUSED: '${root}' is too close to a filesystem root`);
  process.exit(1);
}

const markerPath = resolve(root, '.clone-instance-marker.json');
if (!existsSync(markerPath)) {
  console.error(`REFUSED: '${root}' carries no disposable-instance marker - not a bootstrap-created instance`);
  process.exit(1);
}
let marker;
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf8'));
} catch {
  console.error('REFUSED: marker unreadable');
  process.exit(1);
}
if (marker?.marker !== 'preston-platform-disposable-instance') {
  console.error('REFUSED: marker mismatch - not a disposable instance');
  process.exit(1);
}

if (!CONFIRM) {
  console.log(`DRY RUN: would remove disposable instance '${marker.slug}' at ${root}`);
  console.log('re-run with --confirm to remove it');
  process.exit(0);
}

rmSync(root, { recursive: true, force: true, maxRetries: 3 });
console.log(`removed disposable instance '${marker.slug}' at ${root}`);
process.exit(0);
