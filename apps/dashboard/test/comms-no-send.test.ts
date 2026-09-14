// Static pin: the comms lane is READ-ONLY. No send/reply/draft-create call,
// no sendGmail import, no network client, no LLM client anywhere under
// src/lib/business/comms. The source text is the contract under test.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', 'src', 'lib', 'business', 'comms');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const sources = files.map((f) => ({ f, text: readFileSync(f, 'utf8') }));
const code = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('comms lane - no send path (static pin)', () => {
  it('covers the expected modules', () => {
    const names = files.map((f) => f.replace(ROOT, '').replace(/\\/g, '/'));
    for (const n of ['/classify.ts', '/alias-registry.ts', '/linker.ts', '/detectors.ts',
      '/importer.ts', '/store.ts', '/contact-leak.ts', '/parsers/andersen-lead.ts',
      '/parsers/home-depot.ts', '/parsers/docusign.ts', '/parsers/google-voice.ts',
      '/parsers/bounce.ts', '/parsers/vendor-quote.ts', '/parsers/commitments.ts']) {
      expect(names).toContain(n);
    }
  });
  it('never imports sendGmail or the google adapter', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/sendGmail/);
      expect(text, f).not.toMatch(/from ['"][^'"]*\/google['"]/);
    }
  });
  it('contains no send / reply / draft-create / message-write call', () => {
    const banned = [
      /\.send\s*\(/, /sendMessage/, /\.reply\s*\(/, /createDraft/, /drafts\.create/,
      /messages\.send/, /users\.messages\.(send|insert|modify|trash|delete)/,
      /gmail\.modify/, /gmail\.compose/, /gmail\.send/, /nodemailer/, /smtp/i,
    ];
    for (const { f, text } of sources) {
      const body = code(text);
      for (const re of banned) expect(body, `${f} matches ${re}`).not.toMatch(re);
    }
  });
  it('makes no network call and uses no LLM client', () => {
    // A bare/global fetch( is banned; the injected opts.fetch() is the only
    // read path and is pinned separately below.
    const banned = [/(^|[^.\w])fetch\s*\(/m, /XMLHttpRequest/, /https?:\/\//, /@anthropic-ai/,
      /openai/i, /anthropic/i, /completions/, /messages\.create/];
    for (const { f, text } of sources) {
      const body = code(text);
      for (const re of banned) expect(body, `${f} matches ${re}`).not.toMatch(re);
    }
  });
  it('the importer only consumes the injected fetch (opts.fetch) and never a global one', () => {
    const importer = sources.find((s) => s.f.endsWith('importer.ts'))?.text ?? '';
    expect(importer).toMatch(/opts\.fetch\(\)/);
    expect(code(importer)).not.toMatch(/[^.\w]fetch\s*\(/);
  });
});
