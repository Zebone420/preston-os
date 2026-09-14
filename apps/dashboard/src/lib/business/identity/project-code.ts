// Phase 1 Lane A - human Project ID (plan section 4.2).
//
// Format: P<YY>-<NNNN>, e.g. P26-0001. Codes are minted ONLY by the
// database function public.mint_project_code (migration 0028); they are
// unique, permanent, never reused and never AI-generated. Everything in
// this module is pure and deterministic: format checks, parsing, text
// scanning, and a preview-only "next code" calculation that tests and
// previews use to mirror the DB counter. Nothing here writes anything.

export const PROJECT_CODE_RE = /^P([0-9]{2})-([0-9]{4})$/;

export const PROJECT_CODE_MAX_SEQ = 9999;

export interface ProjectCodeParts {
  yy: string;
  seq: number;
}

export function isProjectCode(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_CODE_RE.test(value);
}

export function parseProjectCode(value: string): ProjectCodeParts | null {
  const m = PROJECT_CODE_RE.exec(value);
  if (!m) return null;
  const seq = Number(m[2]);
  if (seq < 1) return null; // 0000 is never minted
  return { yy: m[1], seq };
}

export function isYearYY(yy: string): boolean {
  return /^[0-9]{2}$/.test(yy);
}

export function formatProjectCode(yy: string, seq: number): string {
  if (!isYearYY(yy)) {
    throw new RangeError(`project code year must be two digits: ${yy}`);
  }
  if (
    !Number.isInteger(seq) ||
    seq < 1 ||
    seq > PROJECT_CODE_MAX_SEQ
  ) {
    throw new RangeError(`project code sequence out of range: ${seq}`);
  }
  return `P${yy}-${String(seq).padStart(4, '0')}`;
}

// Two-digit year for a date, matching Postgres to_char(now(), 'YY').
// Uses the UTC calendar year; callers minting for a local year should
// pass the year explicitly.
export function yearYYOf(date: Date): string {
  return String(date.getUTCFullYear() % 100).padStart(2, '0');
}

// Preview-only successor calculation. The DB counter is the minter;
// this mirrors its rule: the first code of a new year is 0001, the
// counter never goes backwards, and 9999 is the hard ceiling (no
// wraparound - codes are never reused).
export function nextProjectCode(
  current: string | null,
  yy: string,
): string {
  if (!isYearYY(yy)) {
    throw new RangeError(`project code year must be two digits: ${yy}`);
  }
  if (current === null) return formatProjectCode(yy, 1);
  const parts = parseProjectCode(current);
  if (!parts) {
    throw new RangeError(`not a project code: ${current}`);
  }
  if (parts.yy !== yy) return formatProjectCode(yy, 1);
  if (parts.seq >= PROJECT_CODE_MAX_SEQ) {
    throw new RangeError(`project code sequence exhausted for ${yy}`);
  }
  return formatProjectCode(yy, parts.seq + 1);
}

// Finds project codes inside free text (email subjects, filenames,
// vendor notes). Tolerates lowercase and an underscore or en dash as
// the separator, and returns canonical codes in first-seen order
// without duplicates. Word boundaries keep "XP26-0001" or
// "P26-00012" from matching.
// Separator: hyphen, underscore, or en dash (U+2013, escaped to keep
// this file ASCII).
const IN_TEXT_RE =
  /(^|[^A-Za-z0-9])[Pp]([0-9]{2})[-_\u2013]([0-9]{4})(?![0-9])/g;

export function normalizeProjectCodeInText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(IN_TEXT_RE)) {
    const seq = Number(m[3]);
    if (seq < 1) continue;
    const code = `P${m[2]}-${m[3]}`;
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
