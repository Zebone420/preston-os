// Preston AI OS - fast-track Phase B: versioned, machine-parseable worker
// result contract. PURE (no I/O). Workers are asked (via the adapter prompt)
// to end their report with ONE fenced machine block:
//
//   BEGIN_PRESTON_RESULT
//   { "schema_version": 1, "summary": "...", ... }
//   END_PRESTON_RESULT
//
// This module extracts and validates that block from the (already sanitized)
// result text. Fail-closed rules:
//   - No block / malformed JSON / wrong schema_version / invalid field types
//     => { ok: false, error } and callers persist structured:null with the
//     error code. A parse failure NEVER fabricates structured output.
//   - Every string field is secret-scanned (the same span patterns the
//     process-text sanitizer uses) and bounded; arrays are clamped.
//   - The block is advisory worker output - it never overrides the
//     authoritative execution evidence (exit code, worktree audit, provider
//     attribution), which the executor derives itself.

export const STRUCTURED_RESULT_SCHEMA_VERSION = 1;

export const BEGIN_MARKER = 'BEGIN_PRESTON_RESULT';
export const END_MARKER = 'END_PRESTON_RESULT';

export interface StructuredResult {
  schema_version: 1;
  summary: string; // <= 400 chars
  files_touched: string[]; // <= 50 relative paths
  tests_run: string[]; // <= 50 suite/command names
  tests_passed: string[]; // <= 50
  tests_failed: string[]; // <= 50
  commit_sha: string | null; // 7-40 hex when the worker made a LOCAL commit
  artifacts: string[]; // <= 20 artifact names/relative paths
  limitations: string[]; // <= 20 short notes
  recommended_next_action: string | null; // <= 300 chars
}

export type StructuredParse =
  | { ok: true; value: StructuredResult }
  | { ok: false; error: string };

const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const MAX_BLOCK_CHARS = 8_000;

// Span-level secret shapes (mirrors the adapter's process-text patterns).
const SECRET_SPANS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /\b((?:api[_-]?key|key|token|secret|password|credential|bearer|pat)\s*[=:]\s*)[^\s"']+/gi,
];

function scrub(s: string, max: number): string {
  let t = String(s ?? '');
  t = t.replace(SECRET_SPANS[0], '[REDACTED]');
  t = t.replace(SECRET_SPANS[1], '[REDACTED]');
  t = t.replace(SECRET_SPANS[2], '$1[REDACTED]');
  return t.slice(0, max);
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v.slice(0, maxItems)) {
    if (typeof item !== 'string') return null;
    out.push(scrub(item, maxLen));
  }
  return out;
}

// Extract the LAST machine block from the text (the worker's final word wins
// if it emitted more than one) and validate it.
export function parseStructuredResult(text: string | null | undefined): StructuredParse {
  const t = String(text ?? '');
  if (!t.includes(BEGIN_MARKER)) return { ok: false, error: 'no_structured_block' };
  const begin = t.lastIndexOf(BEGIN_MARKER);
  const end = t.indexOf(END_MARKER, begin);
  if (end < 0) return { ok: false, error: 'unterminated_structured_block' };
  const raw = t.slice(begin + BEGIN_MARKER.length, end).trim();
  if (!raw || raw.length > MAX_BLOCK_CHARS) {
    return { ok: false, error: raw ? 'structured_block_too_large' : 'empty_structured_block' };
  }
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'structured_block_not_json' };
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return { ok: false, error: 'structured_block_not_object' };
  }
  const o = j as Record<string, unknown>;
  if (o.schema_version !== STRUCTURED_RESULT_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported_schema_version' };
  }
  if (typeof o.summary !== 'string' || !o.summary.trim()) {
    return { ok: false, error: 'summary_missing' };
  }
  const files_touched = strList(o.files_touched, 50, 300);
  const tests_run = strList(o.tests_run, 50, 200);
  const tests_passed = strList(o.tests_passed, 50, 200);
  const tests_failed = strList(o.tests_failed, 50, 200);
  const artifacts = strList(o.artifacts, 20, 300);
  const limitations = strList(o.limitations, 20, 300);
  if (!files_touched || !tests_run || !tests_passed || !tests_failed ||
      !artifacts || !limitations) {
    return { ok: false, error: 'list_field_invalid' };
  }
  let commit_sha: string | null = null;
  if (o.commit_sha !== undefined && o.commit_sha !== null) {
    if (typeof o.commit_sha !== 'string' || !COMMIT_RE.test(o.commit_sha)) {
      return { ok: false, error: 'commit_sha_invalid' };
    }
    commit_sha = o.commit_sha.toLowerCase();
  }
  let recommended: string | null = null;
  if (o.recommended_next_action !== undefined && o.recommended_next_action !== null) {
    if (typeof o.recommended_next_action !== 'string') {
      return { ok: false, error: 'recommended_next_action_invalid' };
    }
    recommended = scrub(o.recommended_next_action, 300);
  }
  return {
    ok: true,
    value: {
      schema_version: STRUCTURED_RESULT_SCHEMA_VERSION,
      summary: scrub(o.summary.trim(), 400),
      files_touched, tests_run, tests_passed, tests_failed,
      commit_sha, artifacts, limitations,
      recommended_next_action: recommended,
    },
  };
}

// The prompt clause both real adapters append so every provider is asked for
// the SAME contract (provider-neutral wording).
export function structuredResultPromptClause(): string {
  return [
    '== MACHINE RESULT BLOCK (required) ==',
    '- End your report with exactly one machine-parseable block:',
    `  ${BEGIN_MARKER}`,
    '  {"schema_version": 1, "summary": "<=400 chars>",',
    '   "files_touched": [], "tests_run": [], "tests_passed": [],',
    '   "tests_failed": [], "commit_sha": null, "artifacts": [],',
    '   "limitations": [], "recommended_next_action": null}',
    `  ${END_MARKER}`,
    '- commit_sha: the LOCAL commit hash if you committed, else null.',
    '- Plain JSON only inside the block; never place secrets in it.',
  ].join('\n');
}
