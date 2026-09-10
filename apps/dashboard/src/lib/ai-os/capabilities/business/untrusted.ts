// Runtime-local copy of the canonical Preston untrusted-text primitive.
// The OS runtime compiler intentionally has src/ as its rootDir, so business
// capabilities cannot import the workspace-level packages/guards source.
// A parity test pins this implementation to the canonical shared guard.

export const UNTRUSTED_MAX_LEN = 2000;

export function neutralizeUntrusted(
  text: unknown,
  maxLen: number = UNTRUSTED_MAX_LEN,
): string {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + ' [truncated]';
}
