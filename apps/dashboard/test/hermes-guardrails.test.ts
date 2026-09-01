import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as adapter from '../src/lib/hermes/adapter';

// Hermes Supervisor Dashboard v0 - HARD GUARDRAILS (Phase 10 of the
// integration slice). Hermes is a dashboard ABOVE Preston Control, never
// a second control plane. These pins prove, at the SOURCE level (same
// idiom as non-execution-pin.test.ts), that no Hermes module can:
//   - call Claude or Codex directly
//   - write (or even directly query) protected SSOT tables
//   - decide approvals, cancel goals, or submit/follow-up goals
//   - compose an owner_confirmation phrase
//   - bypass Preston Control or grow an orchestration engine
// If a future change wires any of that into src/lib/hermes, src/app/hermes
// or src/app/api/hermes, this suite fails before any behavioral test.

const ROOT = join(__dirname, '..');
const HERMES_DIRS = [
  'src/lib/hermes',
  'src/app/hermes',
  'src/app/api/hermes',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function hermesFiles(): Array<{ rel: string; text: string }> {
  const files: Array<{ rel: string; text: string }> = [];
  for (const d of HERMES_DIRS) {
    for (const p of walk(join(ROOT, d))) {
      files.push({
        rel: p.slice(ROOT.length + 1).replace(/\\/g, '/'),
        text: readFileSync(p, 'utf8'),
      });
    }
  }
  return files;
}

// The exact read surface Hermes is allowed to consume from the sealed
// Preston Control service layer.
const ALLOWED_TOOL_IMPORTS = new Set([
  'prestonGetArtifact',
  'prestonGetEvidence',
  'prestonGetGoal',
  'prestonGetJob',
  'prestonListApprovals',
  'prestonPollEvents',
  'prestonStatus',
  'ToolContext',
]);

// Consequential / write operations of the tool layer: referencing ANY of
// these names anywhere in Hermes code is a guardrail breach.
const BANNED_TOOL_NAMES = [
  'prestonSubmitGoal',
  'prestonFollowUpGoal',
  'prestonDecideApproval',
  'prestonCancelGoal',
  'decide_orchestration_approval',
  'evaluateOwnerConfirmation',
  'evaluateCancelConfirmation',
  'owner' + '_confirmation',
];

// Direct agent adapters and the orchestration engine itself: Hermes may
// not import any execution or coordination module (module-specifier
// substrings, checked against import lines only).
const BANNED_IMPORT_SPECIFIERS = [
  'real-claude-adapter',
  'real-codex-adapter',
  'orchestration/adapters',
  'orchestration/driver',
  'orchestration/completion-engine',
  'orchestration/coordinator',
  'orchestration/composer',
  'ai-os/orchestrator',
  'ai-os/worker-service',
  'ai-os/hermes-service',
  'ai-os/runner',
  'ai-os/staging-sim',
  'os-runtime/',
  '/actions',
];

// Direct DB surface and process spawning.
const BANNED_TOKENS = [
  '.rpc(',
  '.insert(',
  '.upsert(',
  '.delete(',
  'child' + '_process',
  'execSync',
  'spawnSync',
  'execFile',
  "'use server'",
  '"use server"',
];

const DIRECT_TABLE_QUERY = /\.from\(\s*['"`]/;
const FORM_TAG = /<form[\s>]/i;

describe('hermes guardrails - no second control plane', () => {
  const files = hermesFiles();

  it('covers the hermes source set', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const f of hermesFiles()) {
    it(`${f.rel} stays inside the read-only boundary`, () => {
      for (const name of BANNED_TOOL_NAMES) {
        expect(
          f.text.includes(name),
          `${f.rel} must not reference ${name}`,
        ).toBe(false);
      }
      for (const token of BANNED_TOKENS) {
        expect(
          f.text.includes(token),
          `${f.rel} must not contain ${token}`,
        ).toBe(false);
      }
      expect(
        DIRECT_TABLE_QUERY.test(f.text),
        `${f.rel} must not query a table directly (.from('...'))`,
      ).toBe(false);
      const importLines = f.text
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*from\s+['"]/.test(l) ||
          /from\s+['"][^'"]+['"];?\s*$/.test(l));
      for (const line of importLines) {
        for (const spec of BANNED_IMPORT_SPECIFIERS) {
          // The type-only ComposerClient import carries no runtime
          // authority and is the documented ToolContext client type.
          if (line.startsWith('import type')) continue;
          expect(
            line.includes(spec),
            `${f.rel} must not import ${spec} (line: ${line.trim()})`,
          ).toBe(false);
        }
      }
    });
  }

  it('UI surfaces are display-only: no forms, no mutating fetch', () => {
    for (const f of files) {
      if (!f.rel.endsWith('.tsx')) continue;
      expect(
        FORM_TAG.test(f.text),
        `${f.rel} must not render a <form>`,
      ).toBe(false);
    }
    for (const f of files) {
      const fetches = f.text.match(/fetch\(\s*[`'"][^`'"]*/g) ?? [];
      for (const call of fetches) {
        expect(
          /fetch\(\s*[`'"]\/api\/hermes\//.test(call),
          `${f.rel} fetch must target /api/hermes/* only (${call})`,
        ).toBe(true);
      }
      expect(f.text.includes("method:"), // no POST/PUT/PATCH/DELETE
        `${f.rel} must not issue non-GET requests`).toBe(false);
    }
  });

  it('adapter imports ONLY the supported read operations from tools', () => {
    const text = readFileSync(
      join(ROOT, 'src/lib/hermes/adapter.ts'),
      'utf8',
    );
    const m = /import\s*\{([\s\S]*?)\}\s*from\s*'@\/lib\/preston-control\/tools'/.exec(
      text,
    );
    expect(m, 'adapter must import from the tools layer').toBeTruthy();
    const names = m![1]
      .split(',')
      .map((s) => s.replace(/\btype\b/g, '').trim())
      .filter((s) => s.length > 0);
    expect(names.length).toBe(ALLOWED_TOOL_IMPORTS.size);
    for (const n of names) {
      expect(
        ALLOWED_TOOL_IMPORTS.has(n),
        `adapter imports unsupported tool member: ${n}`,
      ).toBe(true);
    }
  });

  it('adapter export surface is exactly the 7 reads + context builder', () => {
    const exported = Object.keys(adapter).sort();
    expect(exported).toEqual([
      'getPrestonArtifact',
      'getPrestonEvidence',
      'getPrestonGoal',
      'getPrestonJob',
      'getPrestonStatus',
      'hermesToolContext',
      'listPrestonApprovals',
      'pollPrestonEvents',
    ]);
  });

  it('only the adapter touches the preston-control module tree', () => {
    for (const f of files) {
      if (f.rel === 'src/lib/hermes/adapter.ts') continue;
      expect(
        f.text.includes('preston-control'),
        `${f.rel} must reach Preston Control through the adapter only`,
      ).toBe(false);
    }
  });
});
