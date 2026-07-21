import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 5 test-audit F-structural: pin the simulation-only claim at the
// SOURCE level, not just via behavioral fakes. No runtime-path module may
// reference a process-spawning API. This is the same text-pin idiom the
// migration tests use: if a future change wires real execution into any of
// these files, this test fails before any behavioral test would.

const RUNTIME_FILES = [
  'src/lib/ai-os/worker-service.ts',
  'src/lib/ai-os/hermes-service.ts',
  'src/lib/ai-os/orchestrator.ts',
  'src/lib/ai-os/staging-sim.ts',
  'src/lib/ai-os/runner.ts',
  'src/lib/ai-os/queue.ts',
  'src/lib/ai-os/leases.ts',
  'src/lib/ai-os/candidates.ts',
  'src/lib/ai-os/controlplane.ts',
  'src/lib/ai-os/store.ts',
  'src/os-runtime/dispatcher.ts',
  'src/os-runtime/bin.ts',
  'src/os-runtime/supabase-runtime.ts',
];

// Process-spawning surface: module names and call tokens. 'child' + '_process'
// is split so THIS file does not contain the literal module name it bans.
const BANNED = [
  'child' + '_process',
  'execSync', 'spawnSync', 'execFile', 'fork(',
  'Deno.Command', 'worker_threads',
];

describe('non-execution structural pin - runtime path spawns nothing', () => {
  for (const rel of RUNTIME_FILES) {
    it(rel + ' references no process-spawning API', () => {
      const text = readFileSync(join(__dirname, '..', rel), 'utf8');
      for (const token of BANNED) {
        expect(text.includes(token), rel + ' must not contain ' + token).toBe(false);
      }
    });
  }
});
