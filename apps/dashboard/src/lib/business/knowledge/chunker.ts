// Deterministic, heading-aware chunker (Andersen knowledge layer plan
// section 6: 500-800 tokens, deterministic, versioned).
//
// Token estimate = ceil(chars / 4). Chunks are contiguous slices of the
// input (text === input.slice(char_start, char_end)) so a citation can
// always be re-derived from the registered source bytes. Markdown '#'
// headings drive heading_path; a heading starts a new chunk once the
// current chunk has reached minTokens.

import { createHash } from 'node:crypto';
import type { KnowledgeChunk } from './types';

export const CHUNKER_VERSION = 'p1c-chunker-v1';

export interface ChunkOptions {
  targetTokens: number;
  minTokens: number;
  maxTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetTokens: 650,
  minTokens: 500,
  maxTokens: 800,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface Block {
  start: number;
  end: number;
  heading: { level: number; title: string } | null;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// Split into paragraph blocks (blank-line separated), keeping offsets.
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /[^\n]*(?:\n(?!\s*\n)[^\n]*)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const start = m.index + lead;
    const end = m.index + raw.length - trail;
    if (end <= start) continue;
    const body = text.slice(start, end);
    const h = body.includes('\n') ? null : HEADING_RE.exec(body);
    blocks.push({
      start,
      end,
      heading: h ? { level: h[1].length, title: h[2] } : null,
    });
  }
  return blocks;
}

// A block longer than maxChars is split at sentence boundaries, falling
// back to a hard split so no piece exceeds maxChars.
function splitOversized(text: string, b: Block, maxChars: number): Block[] {
  if (b.end - b.start <= maxChars) return [b];
  const out: Block[] = [];
  const body = text.slice(b.start, b.end);
  const sentenceRe = /[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g;
  let cursor = b.start;
  let pieceStart = b.start;
  let m: RegExpExecArray | null;
  const pushPiece = (end: number) => {
    if (end > pieceStart) {
      out.push({ start: pieceStart, end, heading: null });
    }
    pieceStart = end;
  };
  while ((m = sentenceRe.exec(body)) !== null) {
    if (m[0].length === 0) {
      sentenceRe.lastIndex += 1;
      continue;
    }
    const sStart = b.start + m.index;
    const sEnd = sStart + m[0].length;
    if (sEnd - pieceStart > maxChars && sStart > pieceStart) {
      pushPiece(sStart);
    }
    // A single sentence longer than maxChars is hard-split.
    while (sEnd - pieceStart > maxChars) {
      pushPiece(pieceStart + maxChars);
    }
    cursor = sEnd;
  }
  pushPiece(Math.max(cursor, b.end));
  // Trim whitespace edges of each piece so text never starts/ends blank.
  return out
    .map((p) => {
      const s = text.slice(p.start, p.end);
      const lead = s.length - s.trimStart().length;
      const trail = s.length - s.trimEnd().length;
      return { start: p.start + lead, end: p.end - trail, heading: null };
    })
    .filter((p) => p.end > p.start);
}

function validateOptions(o: ChunkOptions): void {
  const ints = [o.targetTokens, o.minTokens, o.maxTokens];
  if (!ints.every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error('chunker: token bounds must be positive integers');
  }
  if (!(o.minTokens <= o.targetTokens && o.targetTokens <= o.maxTokens)) {
    throw new Error('chunker: require minTokens <= targetTokens <= maxTokens');
  }
}

export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {},
): KnowledgeChunk[] {
  const opts: ChunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  validateOptions(opts);
  if (typeof text !== 'string' || text.trim() === '') return [];

  const maxChars = opts.maxTokens * 4;
  const minChars = opts.minTokens * 4;
  const targetChars = opts.targetTokens * 4;

  const headingStack: string[] = [];
  const blocks: Block[] = [];
  for (const b of splitBlocks(text)) {
    for (const piece of splitOversized(text, b, maxChars)) blocks.push(piece);
  }

  interface Open {
    start: number;
    end: number;
    heading_path: string[];
  }
  const spans: Open[] = [];
  let open: Open | null = null;

  const flush = () => {
    if (open) spans.push(open);
    open = null;
  };

  for (const b of blocks) {
    if (b.heading) {
      const lvl = b.heading.level;
      headingStack.length = Math.min(headingStack.length, lvl - 1);
      headingStack[lvl - 1] = b.heading.title;
      for (let i = 0; i < lvl - 1; i += 1) {
        if (headingStack[i] === undefined) headingStack[i] = '';
      }
      // A heading opens a new chunk when the current one is big enough.
      if (open && open.end - open.start >= minChars) flush();
    }
    const blockLen = b.end - b.start;
    if (open) {
      const combined = b.end - open.start;
      if (combined > maxChars) {
        flush();
      } else if (open.end - open.start >= targetChars) {
        flush();
      }
    }
    if (!open) {
      open = { start: b.start, end: b.end, heading_path: [...headingStack] };
    } else {
      open.end = b.end;
    }
    if (blockLen >= targetChars) flush();
  }
  flush();

  // A trailing runt merges into its predecessor when the bound allows.
  if (spans.length >= 2) {
    const last = spans[spans.length - 1];
    const prev = spans[spans.length - 2];
    if (last.end - last.start < minChars && last.end - prev.start <= maxChars) {
      prev.end = last.end;
      spans.pop();
    }
  }

  return spans.map((s, i) => {
    const body = text.slice(s.start, s.end);
    return {
      chunk_index: i,
      text: body,
      char_start: s.start,
      char_end: s.end,
      token_estimate: estimateTokens(body),
      sha256: sha256Hex(body),
      heading_path: s.heading_path.filter((h) => h !== ''),
    };
  });
}
