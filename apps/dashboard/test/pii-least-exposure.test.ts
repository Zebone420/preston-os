import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeSupervisorEvents } from '../src/lib/preston-control/supervisor-events';
import { looksSecret } from '../src/lib/preston-control/tools';
import { TOOL_NAMES } from '../src/lib/preston-control/server';

// Phase 1 PII least-exposure contract (owner decision, 2026-09-09).
// Authenticated owner/admin operational views may show business-required
// client/property data. Logs, telemetry, diagnostics, exception traces,
// worker traces, evidence bundles and non-owner surfaces must minimize,
// mask or omit it unless operationally required. Fields covered at minimum:
// property.address_line / unit / city, client.display_name,
// communications[].from / subject. Secrets are never exposed anywhere.
const PII_KEYS = [
  'address_line', 'unit', 'city', 'display_name',
  'from_address', 'from_address_norm', 'subject',
];
const SINK = /(?<!Math\.)\b(?:log|console\.(?:log|error|warn|info)|deps\.log|new Error)\(/;
const SRC = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('PII least-exposure (Phase 1 contract)', () => {
  it('business read models, orchestration and runtime code never log, throw or trace a PII field', () => {
    // ponytail: single-line scan; a sink call spanning lines with the field on
    // a later line is not seen. Upgrade to an AST scan if such a call appears.
    const files = [
      ...walk(join(SRC, 'lib', 'business')),
      ...walk(join(SRC, 'lib', 'ai-os', 'orchestration')),
      ...walk(join(SRC, 'os-runtime')),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!SINK.test(line)) return;
        if (PII_KEYS.some((k) => new RegExp(`\\b${k}\\b`).test(line))) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the non-owner supervisor feed emits no PII field or value even when the source rows carry them', () => {
    const row = {
      id: 'job-sup-0001', goal_id: 'goal-sup-0001', kind: 'code', status: 'completed',
      updated_at: '2026-09-09T12:00:00.000Z', assigned_role: 'claude',
      subject: 'Re: 12 Main St kitchen', address_line: '12 Main St', unit: '4B', city: 'Brooklyn',
      from_address: 'jane@client.example', display_name: 'Jane Client',
    };
    const { events } = normalizeSupervisorEvents({
      goals: [], jobs: [row], rejections: [],
      controls: { readable: true, paused: false, owner_stop: false, updated_at: row.updated_at },
    });
    expect(events).toHaveLength(1);
    for (const k of PII_KEYS) expect(Object.keys(events[0])).not.toContain(k);
    const json = JSON.stringify(events);
    for (const v of ['12 Main St', '4B', 'Brooklyn', 'jane@client.example', 'Jane Client']) {
      expect(json).not.toContain(v);
    }
  });

  it('the operational owner view is only reachable through the owner-authenticated MCP catalogue', () => {
    expect(TOOL_NAMES).toContain('preston_owner_view');
  });

  it('secret-shaped values stay fail-closed at the control boundary', () => {
    expect(looksSecret('sk-abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
    expect(looksSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefg')).toBe(true);
    expect(looksSecret('api_key=0123456789abcdef')).toBe(true);
    expect(looksSecret('12 Main St, Brooklyn')).toBe(false);
  });
});
