// Phase 4 - normalized openings (plan PHASE 4 "NORMALIZED OPENINGS /
// SCOPE"; migration 0033 openings). PURE.
//
// Raw intake / site-visit / final-measure rows are normalized into one
// row shape: inch decimals (3 dp), a fixed unit_type vocabulary, joined
// units single/double/triple, and a source. Rows sourced from an
// estimate or intake form are pricing-estimate ONLY (not_for_po=true);
// only final_measure rows may feed a PO (plan section 19).

export const UNIT_TYPES = [
  'double_hung',
  'single_hung',
  'casement',
  'awning',
  'picture',
  'gliding',
  'bay',
  'bow',
  'specialty',
  'patio_door_gliding',
  'patio_door_hinged',
  'entry_door',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const JOINED_UNITS = ['single', 'double', 'triple'] as const;
export type JoinedUnits = (typeof JOINED_UNITS)[number];

export const OPENING_SOURCES = [
  'estimate',
  'intake_form',
  'site_visit',
  'final_measure',
] as const;
export type OpeningSource = (typeof OPENING_SOURCES)[number];

export const OPENING_CODE_RE = /^[A-Z]{1,3}[0-9]{2,3}$/;

export interface OpeningConfiguration {
  series?: string;
  glass?: string;
  grille?: string;
  hardware?: string;
  color?: string;
  [k: string]: unknown;
}

export interface OpeningRow {
  project_id: string;
  opening_code: string;
  room: string | null;
  location_note: string | null;
  width_in: number;
  height_in: number;
  unit_type: UnitType;
  joined_units: JoinedUnits;
  configuration: OpeningConfiguration;
  source: OpeningSource;
  not_for_po: boolean;
  measured_at: string | null;
  measured_by: string | null;
  version: number;
}

export interface RawOpeningRow {
  code?: unknown;
  room?: unknown;
  location_note?: unknown;
  width?: unknown; // "35 1/2", "35-1/2", "35.5", 35.5
  height?: unknown;
  unit_type?: unknown;
  joined_units?: unknown;
  configuration?: unknown;
  measured_at?: unknown;
  measured_by?: unknown;
}

export interface NormalizeOptions {
  project_id: string;
  source: OpeningSource;
  version: number;
}

export interface OpeningError {
  index: number;
  code: string | null;
  field: string;
  reason: string;
}

export interface NormalizeResult {
  ok: boolean;
  openings: OpeningRow[];
  errors: OpeningError[];
}

const MAX_INCHES = 240;

const UNIT_ALIASES: Readonly<Record<string, UnitType>> = Object.freeze({
  dh: 'double_hung',
  'double hung': 'double_hung',
  double_hung: 'double_hung',
  sh: 'single_hung',
  'single hung': 'single_hung',
  single_hung: 'single_hung',
  casement: 'casement',
  awning: 'awning',
  picture: 'picture',
  fixed: 'picture',
  gliding: 'gliding',
  slider: 'gliding',
  bay: 'bay',
  bow: 'bow',
  specialty: 'specialty',
  'patio door': 'patio_door_gliding',
  'gliding patio door': 'patio_door_gliding',
  patio_door_gliding: 'patio_door_gliding',
  'hinged patio door': 'patio_door_hinged',
  patio_door_hinged: 'patio_door_hinged',
  'french door': 'patio_door_hinged',
  'entry door': 'entry_door',
  entry_door: 'entry_door',
});

// Parse inches from a decimal or a fractional string. Returns a 3dp
// decimal or null (never guesses on malformed input).
export function parseInches(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? round3(value) : null;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/["']|in(ch(es)?)?$/i, '').trim();
  if (s === '') return null;
  const dec = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (dec) return round3(Number(s));
  const frac = /^(\d+)?(?:[\s-]+)?(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const whole = frac[1] ? Number(frac[1]) : 0;
    const num = Number(frac[2]);
    const den = Number(frac[3]);
    if (den === 0 || num >= den) return null;
    return round3(whole + num / den);
  }
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function normalizeUnitType(value: unknown): UnitType | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return UNIT_ALIASES[key] ?? null;
}

export function normalizeJoinedUnits(value: unknown): JoinedUnits | null {
  if (value === undefined || value === null || value === '') return 'single';
  if (typeof value === 'number') {
    return value === 1 ? 'single' : value === 2 ? 'double' : value === 3 ? 'triple' : null;
  }
  if (typeof value !== 'string') return null;
  const k = value.trim().toLowerCase();
  if (k === 'single' || k === '1') return 'single';
  if (k === 'double' || k === 'twin' || k === '2') return 'double';
  if (k === 'triple' || k === '3') return 'triple';
  return null;
}

function optStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

const CONFIG_KEYS = ['series', 'glass', 'grille', 'hardware', 'color'] as const;

function normalizeConfiguration(v: unknown): OpeningConfiguration {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: OpeningConfiguration = {};
  for (const k of CONFIG_KEYS) {
    const s = optStr(src[k]);
    if (s) out[k] = s;
  }
  return out;
}

export function normalizeOpenings(
  rawRows: RawOpeningRow[],
  opts: NormalizeOptions,
): NormalizeResult {
  const errors: OpeningError[] = [];
  const openings: OpeningRow[] = [];
  if (!(OPENING_SOURCES as readonly string[]).includes(opts.source)) {
    return {
      ok: false,
      openings: [],
      errors: [{ index: -1, code: null, field: 'source', reason: 'source_invalid' }],
    };
  }
  if (!Number.isSafeInteger(opts.version) || opts.version < 1) {
    return {
      ok: false,
      openings: [],
      errors: [{ index: -1, code: null, field: 'version', reason: 'version_invalid' }],
    };
  }
  const seen = new Set<string>();
  rawRows.forEach((raw, index) => {
    const code = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : '';
    const errorsBefore = errors.length;
    const err = (field: string, reason: string) =>
      errors.push({ index, code: code || null, field, reason });
    if (!OPENING_CODE_RE.test(code)) err('opening_code', 'code_invalid');
    else if (seen.has(code)) err('opening_code', 'code_duplicate');
    seen.add(code);
    const width = parseInches(raw.width);
    const height = parseInches(raw.height);
    if (width === null) err('width_in', 'width_missing_or_malformed');
    else if (width <= 0 || width > MAX_INCHES) err('width_in', 'width_out_of_range');
    if (height === null) err('height_in', 'height_missing_or_malformed');
    else if (height <= 0 || height > MAX_INCHES) {
      err('height_in', 'height_out_of_range');
    }
    const unitType = normalizeUnitType(raw.unit_type);
    if (!unitType) err('unit_type', 'unit_type_unknown');
    const joined = normalizeJoinedUnits(raw.joined_units);
    if (!joined) err('joined_units', 'joined_units_invalid');
    const measuredAt = optStr(raw.measured_at);
    if (measuredAt && Number.isNaN(Date.parse(measuredAt))) {
      err('measured_at', 'measured_at_invalid');
    }
    if (opts.source === 'final_measure' && !measuredAt) {
      err('measured_at', 'final_measure_requires_measured_at');
    }
    if (opts.source === 'final_measure' && !optStr(raw.measured_by)) {
      err('measured_by', 'final_measure_requires_measured_by');
    }
    // Any recorded error drops the row: no partially valid opening ever
    // reaches the scope builder.
    if (errors.length > errorsBefore) return;
    if (width === null || height === null || !unitType || !joined) return;
    openings.push({
      project_id: opts.project_id,
      opening_code: code,
      room: optStr(raw.room),
      location_note: optStr(raw.location_note),
      width_in: width,
      height_in: height,
      unit_type: unitType,
      joined_units: joined,
      configuration: normalizeConfiguration(raw.configuration),
      source: opts.source,
      // Estimate / intake / site-visit numbers are never PO material.
      not_for_po: opts.source !== 'final_measure',
      measured_at: measuredAt,
      measured_by: optStr(raw.measured_by),
      version: opts.version,
    });
  });
  return { ok: errors.length === 0, openings, errors };
}

export const PO_SOURCES: readonly OpeningSource[] = ['final_measure'];

export function isPoMaterial(o: OpeningRow): boolean {
  return o.source === 'final_measure' && o.not_for_po === false;
}

export interface OpeningChange {
  opening_code: string;
  fields: Record<string, { from: unknown; to: unknown }>;
}

export interface OpeningDiff {
  added: string[];
  removed: string[];
  changed: OpeningChange[];
  material_change: boolean; // size/unit_type/joined change -> change order
}

const DIFF_FIELDS = [
  'width_in',
  'height_in',
  'unit_type',
  'joined_units',
  'room',
  'location_note',
] as const;
const MATERIAL_FIELDS: readonly string[] = [
  'width_in',
  'height_in',
  'unit_type',
  'joined_units',
  'configuration',
];

// Deterministic diff keyed by opening_code. Configuration is compared
// by its canonical (sorted-key) JSON.
export function diffOpenings(a: OpeningRow[], b: OpeningRow[]): OpeningDiff {
  const byCode = (rows: OpeningRow[]) =>
    new Map(rows.map((r) => [r.opening_code, r] as const));
  const ma = byCode(a);
  const mb = byCode(b);
  const added = [...mb.keys()].filter((k) => !ma.has(k)).sort();
  const removed = [...ma.keys()].filter((k) => !mb.has(k)).sort();
  const changed: OpeningChange[] = [];
  let material = added.length > 0 || removed.length > 0;
  for (const code of [...ma.keys()].filter((k) => mb.has(k)).sort()) {
    const ra = ma.get(code)!;
    const rb = mb.get(code)!;
    const fields: OpeningChange['fields'] = {};
    for (const f of DIFF_FIELDS) {
      if (ra[f] !== rb[f]) fields[f] = { from: ra[f], to: rb[f] };
    }
    const ca = canonical(ra.configuration);
    const cb = canonical(rb.configuration);
    if (ca !== cb) fields.configuration = { from: ra.configuration, to: rb.configuration };
    if (Object.keys(fields).length > 0) {
      changed.push({ opening_code: code, fields });
      if (Object.keys(fields).some((f) => MATERIAL_FIELDS.includes(f))) {
        material = true;
      }
    }
  }
  return { added, removed, changed, material_change: material };
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(o[k]))
      .join(',') +
    '}'
  );
}

export function unitCount(joined: JoinedUnits): number {
  return joined === 'single' ? 1 : joined === 'double' ? 2 : 3;
}
