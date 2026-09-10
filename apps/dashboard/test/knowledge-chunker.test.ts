// Deterministic chunker pins: bounds, stability, contiguity, headings.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  chunkText,
  DEFAULT_CHUNK_OPTIONS,
  estimateTokens,
} from '../src/lib/business/knowledge/chunker';

// Synthetic corpus: numbered sentences so every chunk is distinct.
function paragraph(n: number, sentences = 6): string {
  const out: string[] = [];
  for (let i = 0; i < sentences; i += 1) {
    out.push(`Paragraph ${n} sentence ${i} describes a synthetic fixture item.`);
  }
  return out.join(' ');
}

function body(paragraphs: number): string {
  const parts: string[] = [];
  for (let p = 0; p < paragraphs; p += 1) parts.push(paragraph(p));
  return parts.join('\n\n');
}

describe('chunkText', () => {
  it('returns nothing for empty input and validates bounds', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
    expect(() => chunkText('x', { minTokens: 900 })).toThrow(/minTokens/);
    expect(() => chunkText('x', { maxTokens: 0 })).toThrow(/positive/);
  });

  it('keeps every chunk inside [minTokens, maxTokens] on a long body', () => {
    const text = body(60);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    const { minTokens, maxTokens } = DEFAULT_CHUNK_OPTIONS;
    chunks.forEach((c, i) => {
      expect(c.token_estimate).toBeLessThanOrEqual(maxTokens);
      expect(c.token_estimate).toBeGreaterThan(0);
      if (i < chunks.length - 1) {
        expect(c.token_estimate).toBeGreaterThanOrEqual(minTokens);
      }
    });
    // The final chunk may be a short tail only when it could not be
    // merged into its predecessor without breaking maxTokens.
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.token_estimate < minTokens) {
      expect(estimateTokens(text.slice(prev.char_start, last.char_end)))
        .toBeGreaterThan(maxTokens);
    }
  });

  it('chunks are contiguous slices with stable indices and hashes', () => {
    const text = body(30);
    const a = chunkText(text);
    const b = chunkText(text);
    expect(a).toEqual(b);
    a.forEach((c, i) => {
      expect(c.chunk_index).toBe(i);
      expect(text.slice(c.char_start, c.char_end)).toBe(c.text);
      expect(c.token_estimate).toBe(estimateTokens(c.text));
      expect(c.sha256).toBe(
        createHash('sha256').update(c.text, 'utf8').digest('hex'),
      );
      if (i > 0) expect(c.char_start).toBeGreaterThanOrEqual(a[i - 1].char_end);
    });
    // Coverage: no paragraph text is lost between chunks.
    const joined = a.map((c) => c.text).join('\n\n');
    expect(joined.replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('a change at the end never renumbers earlier chunks', () => {
    const base = body(40);
    const a = chunkText(base);
    const b = chunkText(base + '\n\n' + paragraph(99));
    for (let i = 0; i < a.length - 1; i += 1) {
      expect(b[i]).toEqual(a[i]);
    }
  });

  it('tracks markdown heading paths and splits on headings once big enough', () => {
    const text = [
      '# Installation Guide',
      '',
      body(8),
      '',
      '## Flashing',
      '',
      body(8),
      '',
      '### Sill pan',
      '',
      paragraph(70),
      '',
      '## Fasteners',
      '',
      body(8),
    ].join('\n');
    const chunks = chunkText(text);
    expect(chunks[0].heading_path).toEqual(['Installation Guide']);
    const flashing = chunks.find((c) => c.heading_path[1] === 'Flashing');
    expect(flashing).toBeDefined();
    expect(flashing?.heading_path).toEqual(['Installation Guide', 'Flashing']);
    const sill = chunks.find((c) => c.heading_path[2] === 'Sill pan');
    expect(sill?.heading_path).toEqual(['Installation Guide', 'Flashing', 'Sill pan']);
    const fasteners = chunks.find((c) => c.heading_path[1] === 'Fasteners');
    expect(fasteners?.heading_path).toEqual(['Installation Guide', 'Fasteners']);
    // A heading line starts its chunk (it never trails a previous chunk).
    for (const c of chunks) {
      const lines = c.text.split('\n');
      const lastLine = lines[lines.length - 1];
      expect(/^#{1,6}\s/.test(lastLine)).toBe(false);
    }
  });

  it('splits a single oversized paragraph at sentence boundaries', () => {
    const huge = paragraph(1, 400); // one paragraph, far above maxTokens
    const chunks = chunkText(huge);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.token_estimate).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxTokens);
      expect(huge.slice(c.char_start, c.char_end)).toBe(c.text);
      expect(c.text.endsWith('.')).toBe(true);
    }
  });

  it('a hard-split unbroken string still respects maxTokens', () => {
    const wall = 'x'.repeat(10_000);
    const chunks = chunkText(wall);
    expect(chunks.reduce((s, c) => s + c.text.length, 0)).toBe(10_000);
    for (const c of chunks) {
      expect(c.token_estimate).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxTokens);
    }
  });

  it('a short document is a single chunk below minTokens', () => {
    const chunks = chunkText('Just one short line.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading_path).toEqual([]);
    expect(chunks[0].char_start).toBe(0);
  });
});
