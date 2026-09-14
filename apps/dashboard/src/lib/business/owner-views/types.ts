// Phase 2 - Owner Operating Interface: shared read-model vocabulary.
//
// Every view in this directory is PURE (no client, no clock beyond the
// injected `now`) and READ-ONLY. Items carry a deep_link that is a PATH
// on the Preston/Next.js action surface - never an external URL - so a
// read surface (ChatGPT, Hermes) can point the owner at the secure
// action page without ever being able to act itself.

export type Row = Record<string, unknown>;

// Mirrors orchestration/read-model.ts so every bucket reports the same
// four states; 'error' and 'migration_absent' are explicit, never empty.
export type ReadState = 'ok' | 'empty' | 'migration_absent' | 'error';

export interface Bucket {
  state: ReadState;
  rows: Row[];
  note?: string;
}

export function emptyBucket(): Bucket {
  return { state: 'empty', rows: [] };
}

export function bucketReadable(b: Bucket | undefined): boolean {
  return b !== undefined && (b.state === 'ok' || b.state === 'empty');
}

export type Severity = 'critical' | 'high' | 'normal';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
};

export interface OwnerItem {
  // Stable key (notification dedup + rate limiting).
  id: string;
  kind: string;
  project_code: string | null;
  title: string;
  due_at: string | null;
  severity: Severity;
  // When the underlying fact was first observed (for "since" filters).
  observed_at: string | null;
  evidence_refs: string[];
  deep_link: string;
}

// --- deep links (paths on the action surface only) -------------------------

const enc = (v: unknown): string => encodeURIComponent(String(v ?? ''));

export const DEEP_LINKS = {
  approval: (approvalId: unknown): string =>
    '/approvals?approval_id=' + enc(approvalId),
  project: (projectRef: unknown): string =>
    '/business/projects?project=' + enc(projectRef),
  attention: (itemId: unknown, projectRef: unknown | null): string =>
    projectRef
      ? '/business/projects?project=' + enc(projectRef) +
        '&attention=' + enc(itemId)
      : '/brief?attention=' + enc(itemId),
  goal: (goalId: unknown): string =>
    '/os/orchestration?goal=' + enc(goalId),
  job: (jobId: unknown): string =>
    '/os/orchestration?job=' + enc(jobId),
  sideEffect: (sideEffectId: unknown): string =>
    '/audit?side_effect=' + enc(sideEffectId),
  incident: (incidentId: unknown): string =>
    '/audit?incident=' + enc(incidentId),
  rejection: (requestId: unknown): string =>
    '/os/orchestration?rejection=' + enc(requestId),
  vendorOrder: (orderId: unknown, projectRef: unknown | null): string =>
    projectRef
      ? '/business/projects?project=' + enc(projectRef) +
        '&order=' + enc(orderId)
      : '/business/projects?order=' + enc(orderId),
} as const;

// A deep link is a same-origin absolute PATH: starts with a single '/',
// carries no scheme, no authority, no control characters.
export function isActionSurfacePath(p: unknown): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 512) return false;
  if (!p.startsWith('/') || p.startsWith('//')) return false;
  if (/[\s\x00-\x1f]/.test(p)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false;
  if (p.includes('://') || p.includes('\\')) return false;
  return true;
}

// --- helpers shared by the views --------------------------------------------

export function str(r: Row | null | undefined, k: string): string {
  return r ? String(r[k] ?? '') : '';
}

export function strOrNull(r: Row | null | undefined, k: string): string | null {
  if (!r) return null;
  const v = r[k];
  return v === null || v === undefined || v === '' ? null : String(v);
}

export function num(r: Row | null | undefined, k: string): number {
  const v = r ? Number(r[k]) : NaN;
  return Number.isFinite(v) ? v : 0;
}

export function bool(r: Row | null | undefined, k: string): boolean {
  return r ? r[k] === true || r[k] === 'true' : false;
}

export function bounded(v: unknown, max = 200): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function stringList(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max)
    .filter((x) => typeof x === 'string' && x.length > 0)
    .map((x) => bounded(x, 300));
}

// Evidence refs from an attention_items.evidence array (kind + ref).
export function attentionEvidenceRefs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const e of v.slice(0, 50)) {
    if (!e || typeof e !== 'object') continue;
    const kind = String((e as Row)['kind'] ?? '');
    const ref = String((e as Row)['ref'] ?? '');
    if (kind && ref) out.push(bounded(kind + ':' + ref, 300));
  }
  return out;
}

// Deterministic ordering: dated items first (earliest due first), then
// severity, then the stable key. Never depends on input order.
export function sortItems<T extends OwnerItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = parseMs(a.due_at);
    const db = parseMs(b.due_at);
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
