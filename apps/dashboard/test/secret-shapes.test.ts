import { describe, expect, it } from 'vitest';
import { hasSecretShape, SECRET_SHAPE_PATTERNS } from '../src/lib/ai-os/secret-shapes';
import { scrubOutboundMessage } from '../src/lib/guards';

// The runtime-side secret-shape screen (worker patches) mirrors the outbound
// message scrubber in packages/guards. This suite pins both to the same
// verdicts on synthetic, test-time-assembled samples so the two rule sets
// cannot drift apart silently. No sample below is a real credential.

function scrubberFlags(text: string): boolean {
  try { scrubOutboundMessage(text); return false; } catch { return true; }
}

const SHAPED: Array<[string, string]> = [
  ['private key block', '-----BEGIN' + ' RSA PRIVATE KEY-----'],
  ['jwt', 'eyJ' + 'a'.repeat(20) + '.eyJ' + 'b'.repeat(10)],
  ['openai-style', 'sk-' + 'A'.repeat(24)],
  ['github pat', 'ghp_' + 'A'.repeat(36)],
  ['github fine pat', 'github_pat_' + 'A'.repeat(24)],
  ['slack', 'xoxb-' + '1'.repeat(12)],
  ['aws', 'AKIA' + 'A'.repeat(16)],
  ['airtable pat', 'pat' + 'A'.repeat(14) + '.' + 'b'.repeat(24)],
  ['telegram', '1'.repeat(9) + ':AA' + 'A'.repeat(32)],
];

const PLAIN: Array<[string, string]> = [
  ['source that mentions the word secret', 'const clientSecretName = process.env.NAME;'],
  ['ordinary diff', 'diff --git a/x.ts b/x.ts\n+export const a = 1;\n'],
  ['short token-like prefix', 'ghp_short'],
  ['empty', ''],
];

describe('secret-shape screen mirrors the guards scrubber', () => {
  it('has one pattern per scrubber family', () => {
    expect(SECRET_SHAPE_PATTERNS).toHaveLength(9);
  });
  for (const [name, sample] of SHAPED) {
    it(`flags ${name} in both screens`, () => {
      expect(hasSecretShape(`prefix ${sample} suffix`)).toBe(true);
      expect(scrubberFlags(`prefix ${sample} suffix`)).toBe(true);
    });
  }
  for (const [name, sample] of PLAIN) {
    it(`passes ${name} in both screens`, () => {
      expect(hasSecretShape(sample)).toBe(false);
      expect(scrubberFlags(sample)).toBe(false);
    });
  }
});
