import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 7 structural pins for the orchestration layer. Text-pin idiom: if a
// future change wires process execution, network, sending, or self-approval
// into the orchestration modules, this fails before any behavioral test.

const ORCH_FILES = [
  'src/lib/ai-os/orchestration/model.ts',
  'src/lib/ai-os/orchestration/agent-contracts.ts',
  'src/lib/ai-os/orchestration/policy.ts',
  'src/lib/ai-os/orchestration/approvals.ts',
  'src/lib/ai-os/orchestration/decomposition.ts',
  'src/lib/ai-os/orchestration/completion-engine.ts',
  'src/lib/ai-os/orchestration/adapters.ts',
  'src/lib/ai-os/orchestration/coordinator.ts',
  'src/lib/ai-os/orchestration/goal-intake.ts',
  'src/lib/ai-os/orchestration/orchestrator-sim.ts',
];

const SPAWN = [
  'child' + '_process', 'execSync', 'spawnSync', 'execFile', 'fork(',
  'Deno.Command', 'worker_threads',
];
const NETWORK_SEND = [
  'fetch(', 'XMLHttpRequest', 'WebSocket', 'nodemailer', 'twilio',
  'sendGmail', 'sendTelegram', 'createTransport',
];
const EXTERNAL = ['airtable.com', 'googleapis', 'quickbooks', 'stripe', 'get.enterprisedb'];

describe('orchestration structural pins - no spawn/network/send/external', () => {
  for (const rel of ORCH_FILES) {
    it(`${rel} has no execution or send surface`, () => {
      const text = readFileSync(join(__dirname, '..', rel), 'utf8');
      for (const t of [...SPAWN, ...NETWORK_SEND, ...EXTERNAL]) {
        expect(text.includes(t), `${rel} must not contain ${t}`).toBe(false);
      }
    });
  }

  it('every agent contract pins can_approve:false and network none', () => {
    const text = readFileSync(
      join(__dirname, '..', 'src/lib/ai-os/orchestration/agent-contracts.ts'),
      'utf8',
    );
    expect(text).toContain('can_approve: false');
    // The type hard-pins can_approve to the literal false.
    expect(text).toContain('can_approve: false;');
    expect(text).not.toContain('can_approve: true');
  });

  it('adapters pin executed:false and simulated:true', () => {
    const text = readFileSync(
      join(__dirname, '..', 'src/lib/ai-os/orchestration/adapters.ts'),
      'utf8',
    );
    expect(text).toContain('executed: false');
    expect(text).not.toContain('executed: true');
    expect(text).toContain("return 'unavailable'"); // real capability gated
  });

  it('model hard-pins staging + simulation_only', () => {
    const text = readFileSync(
      join(__dirname, '..', 'src/lib/ai-os/orchestration/model.ts'),
      'utf8',
    );
    expect(text).toContain("environment: 'staging'");
    expect(text).toContain('simulation_only: true');
  });

  it('coordinator pins can_approve:false and can_execute:false', () => {
    const text = readFileSync(
      join(__dirname, '..', 'src/lib/ai-os/orchestration/coordinator.ts'),
      'utf8',
    );
    expect(text).toContain('can_approve: false');
    expect(text).toContain('can_execute: false');
  });
});
