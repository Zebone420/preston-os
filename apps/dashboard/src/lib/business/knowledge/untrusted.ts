// External text boundary. Every document body entering the fabric passes
// through neutralizeUntrusted (packages/guards) BEFORE chunking. The text
// is kept as DATA - instruction-like sentences are stored verbatim, never
// interpreted, and never reach a policy decision (CLAUDE.md rule 12).

import { neutralizeUntrusted } from '../../guards';
import { chunkText, type ChunkOptions } from './chunker';
import type { KnowledgeChunk } from './types';

// Document bodies are far larger than the guard's 2000-char default for
// messages; the cap here bounds memory, not meaning.
export const KNOWLEDGE_TEXT_MAX_LEN = 2_000_000;

export interface PreparedText {
  text: string;
  original_length: number;
  truncated: boolean;
}

export function prepareExternalText(
  raw: unknown,
  maxLen: number = KNOWLEDGE_TEXT_MAX_LEN,
): PreparedText {
  const original_length = typeof raw === 'string' ? raw.length : 0;
  const text = neutralizeUntrusted(raw, maxLen);
  return {
    text,
    original_length,
    truncated: text.endsWith(' [truncated]') && original_length > maxLen,
  };
}

export interface IngestedText extends PreparedText {
  chunks: KnowledgeChunk[];
}

// Neutralize, then chunk. The only path from external bytes to chunks.
export function ingestExternalText(
  raw: unknown,
  options: Partial<ChunkOptions> = {},
  maxLen: number = KNOWLEDGE_TEXT_MAX_LEN,
): IngestedText {
  const prepared = prepareExternalText(raw, maxLen);
  return { ...prepared, chunks: chunkText(prepared.text, options) };
}
