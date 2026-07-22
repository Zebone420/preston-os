import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 6F structural pins for the business layer. Same text-pin idiom
// as non-execution-pin.test.ts: if a future change wires sending,
// process execution, or external business-system calls into any
// business module, this fails before any behavioral test would.

const BUSINESS_FILES = [
  'src/lib/business/types.ts',
  'src/lib/business/quote-engine.ts',
  'src/lib/business/quote-agent.ts',
  'src/lib/business/business-store.ts',
  'src/lib/business/business-forms.ts',
  'src/lib/business/read-models.ts',
  'src/lib/business/recommendations.ts',
  'src/lib/business/fixtures.ts',
  'src/lib/business/page-data.ts',
  'src/app/business/actions.ts',
  'src/app/business/quotes/quote-form.tsx',
  'src/lib/sign-out.ts',
];

// Process-spawning surface ('child' + '_process' split so this file
// does not contain the literal token it bans).
const SPAWN_TOKENS = [
  'child' + '_process',
  'execSync',
  'spawnSync',
  'execFile',
  'fork(',
  'Deno.Command',
  'worker_threads',
];

// Outbound/sending surface: the business layer must never reach the
// network or any messaging adapter. (The UI reads via the RLS-bound
// Supabase client only, which is injected - never constructed here.)
const SEND_TOKENS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'sendGmail',
  'sendMessage',
  'sendTelegram',
  'nodemailer',
  'twilio',
  'telnyx',
  'smtp',
  'createTransport',
];

// External business systems the agent must never touch.
const EXTERNAL_TOKENS = [
  'airtable.com',
  'api.airtable',
  'AIRTABLE_TEST_PAT',
  'googleapis',
  'quickbooks',
  'stripe',
];

describe('business layer structural pins - no spawn, no network, no external systems', () => {
  for (const rel of BUSINESS_FILES) {
    it(rel + ' has no execution or send surface', () => {
      const text = readFileSync(join(__dirname, '..', rel), 'utf8');
      for (const token of [
        ...SPAWN_TOKENS,
        ...SEND_TOKENS,
        ...EXTERNAL_TOKENS,
      ]) {
        expect(
          text.includes(token),
          rel + ' must not contain ' + token,
        ).toBe(false);
      }
    });
  }

  it('quote agent forces simulation flags on every run row', () => {
    const text = readFileSync(
      join(__dirname, '..', 'src/lib/business/quote-agent.ts'),
      'utf8',
    );
    expect(text).toContain('simulation_only: true');
    expect(text).toContain('execution_eligible: false');
  });

  it('the runtime remote-runner allowlist is not imported by business code', () => {
    for (const rel of BUSINESS_FILES) {
      const text = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(text.includes("from '../ai-os/runner'")).toBe(false);
      expect(text.includes("from '@/lib/ai-os/runner'")).toBe(false);
      expect(text.includes('remote_runner')).toBe(false);
    }
  });

  it('no vendor price knowledge exists to invent from (Andersen pin)', () => {
    // Acceptance criterion 18: the agent must never infer Andersen
    // (or any vendor) product pricing or configuration. Structural
    // pin: business code contains no vendor price tables or vendor
    // name references - every price is an explicit owner input.
    for (const rel of BUSINESS_FILES) {
      const text = readFileSync(
        join(__dirname, '..', rel),
        'utf8',
      ).toLowerCase();
      expect(text.includes('andersen'), rel).toBe(false);
      expect(text.includes('price_list'), rel).toBe(false);
      expect(text.includes('catalog'), rel).toBe(false);
    }
  });

  it('approval decisions cannot trigger execution for business kinds', () => {
    // decideApprovalRow records decisions; evaluateExecution blocks all
    // live action types. The business layer adds no execution path: no
    // business module imports executeApproved or evaluateExecution.
    for (const rel of BUSINESS_FILES) {
      const text = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(text.includes('executeApproved')).toBe(false);
      expect(text.includes('evaluateExecution')).toBe(false);
    }
  });
});
