import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Dashboard Letta isolation', () => {
  const dashPkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

  it('no @preston/brain-bridge dependency', () => {
    const allDeps = { ...dashPkg.dependencies, ...dashPkg.devDependencies };
    expect(allDeps).not.toHaveProperty('@preston/brain-bridge');
  });

  it('no @letta-ai/letta-agent-sdk dependency', () => {
    const allDeps = { ...dashPkg.dependencies, ...dashPkg.devDependencies };
    expect(allDeps).not.toHaveProperty('@letta-ai/letta-agent-sdk');
  });

  it('no @letta-ai/letta-code dependency', () => {
    const allDeps = { ...dashPkg.dependencies, ...dashPkg.devDependencies };
    expect(allDeps).not.toHaveProperty('@letta-ai/letta-code');
  });

  it('no sharp dependency', () => {
    const allDeps = { ...dashPkg.dependencies, ...dashPkg.devDependencies };
    expect(allDeps).not.toHaveProperty('sharp');
  });

  it('sdk-letta-turn-client has no Letta SDK imports', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'brain', 'sdk-letta-turn-client.ts'),
      'utf8',
    );
    // No import/export line should reference Letta or brain-bridge packages
    const codeLines = src.split('\n').filter((l: string) => !l.trimStart().startsWith('//'));
    for (const line of codeLines) {
      if (line.includes('from') || line.includes('require')) {
        expect(line).not.toContain('@letta-ai');
        expect(line).not.toMatch(/brain-bridge/);
      }
    }
  });
});
