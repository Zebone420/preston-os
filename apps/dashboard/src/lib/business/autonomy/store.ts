// Preston AI OS - Phase 7 autonomy store adapters. Server-side, RLS-bound,
// REUSING the existing RuntimeClient / WriteOutcome idiom (ai-os/store.ts)
// exactly like the side-effect ledger adapters. Fail-closed throughout:
// a read error or a malformed row is 'undefined' (callers then treat the
// class as CODED); every write validates its shape before touching the
// client; the ONLY class mutation is a compare-and-set on the current rung;
// nothing is ever deleted (the tables carry no delete grant).
//
// Rung moves are recorded elsewhere first: a promotion is an
// autonomy_grants row, a demotion an autonomy_anomalies row. This module
// executes nothing.

import type { RuntimeClient, WriteOutcome } from '../../ai-os/store';
import { isRung, nextRung, rungIndex } from './ladder';
import type {
  AnomalyKind,
  AnomalySeverity,
  ApprovalClass,
  AutonomyAnomalyRow,
  AutonomyClassRow,
  AutonomyGrantRow,
  AutonomyOutcomeRow,
  ClassKind,
  OutcomeKind,
  Rung,
} from './types';

export const AUTONOMY_CLASSES_TABLE = 'autonomy_classes';
export const AUTONOMY_GRANTS_TABLE = 'autonomy_grants';
export const AUTONOMY_OUTCOMES_TABLE = 'autonomy_outcomes';
export const AUTONOMY_ANOMALIES_TABLE = 'autonomy_anomalies';

const KINDS: readonly ClassKind[] = ['model', 'deterministic'];
const APPROVAL_CLASSES: readonly ApprovalClass[] = ['INTERNAL', 'EXTERNAL', 'STEP_UP'];
const OUTCOMES: readonly OutcomeKind[] = ['success', 'failure', 'vetoed', 'anomaly'];
const SEVERITIES: readonly AnomalySeverity[] = ['critical', 'major', 'minor'];
const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'duplicate_side_effect', 'contact_leak', 'stale_approval_execution',
  'wrong_project', 'kill_switch', 'budget_breach', 'other',
];

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_LIST_LIMIT = 500;

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, set: readonly T[]): v is T {
  return typeof v === 'string' && (set as readonly string[]).includes(v);
}

function fail(error: string): WriteOutcome {
  return { ok: false, error };
}

// ---- row parsers (fail closed: any doubt -> undefined) ------------------

export function parseClassRow(raw: unknown): AutonomyClassRow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const class_id = str(raw.class_id);
  if (!class_id || !ID_RE.test(class_id)) return undefined;
  if (!oneOf(raw.kind, KINDS)) return undefined;
  if (!oneOf(raw.approval_class, APPROVAL_CLASSES)) return undefined;
  if (!isRung(raw.rung) || !isRung(raw.max_rung)) return undefined;
  const caps = Array.isArray(raw.capability_ids) ? raw.capability_ids : [];
  if (!caps.every((c) => typeof c === 'string')) return undefined;
  return {
    class_id,
    description: str(raw.description) ?? '',
    kind: raw.kind,
    approval_class: raw.approval_class,
    capability_ids: caps as string[],
    rung: raw.rung,
    max_rung: raw.max_rung,
    updated_at: str(raw.updated_at) ?? '',
  };
}

export function parseGrantRow(raw: unknown): AutonomyGrantRow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const id = str(raw.id); const class_id = str(raw.class_id);
  const granted_by = str(raw.granted_by); const granted_at = str(raw.granted_at);
  if (!id || !class_id || !granted_by || !granted_at) return undefined;
  if (!isRung(raw.from_rung) || !isRung(raw.to_rung)) return undefined;
  if (!isPlainObject(raw.evidence)) return undefined;
  const expires_at = strOrNull(raw.expires_at);
  const revoked_at = strOrNull(raw.revoked_at);
  const revoked_reason = strOrNull(raw.revoked_reason);
  if (expires_at === undefined || revoked_at === undefined ||
      revoked_reason === undefined) return undefined;
  return {
    id, class_id, from_rung: raw.from_rung, to_rung: raw.to_rung, granted_by,
    granted_at, evidence: raw.evidence, expires_at, revoked_at, revoked_reason,
  };
}

export function parseOutcomeRow(raw: unknown): AutonomyOutcomeRow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const id = str(raw.id); const class_id = str(raw.class_id);
  const capability_id = str(raw.capability_id); const recorded_at = str(raw.recorded_at);
  if (!id || !class_id || !capability_id || !recorded_at) return undefined;
  if (!oneOf(raw.outcome, OUTCOMES) || !isRung(raw.mode_at_time)) return undefined;
  const side_effect_id = strOrNull(raw.side_effect_id);
  const evidence_ref = strOrNull(raw.evidence_ref);
  if (side_effect_id === undefined || evidence_ref === undefined) return undefined;
  return {
    id, class_id, capability_id, side_effect_id, outcome: raw.outcome,
    mode_at_time: raw.mode_at_time, recorded_at, evidence_ref,
  };
}

export function parseAnomalyRow(raw: unknown): AutonomyAnomalyRow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const id = str(raw.id); const class_id = str(raw.class_id);
  const detected_at = str(raw.detected_at);
  if (!id || !class_id || !detected_at) return undefined;
  if (!oneOf(raw.severity, SEVERITIES) || !oneOf(raw.kind, ANOMALY_KINDS)) return undefined;
  if (!isPlainObject(raw.evidence)) return undefined;
  const demoted_to = raw.demoted_to === null || raw.demoted_to === undefined
    ? null : (isRung(raw.demoted_to) ? raw.demoted_to : undefined);
  const acknowledged_by = strOrNull(raw.acknowledged_by);
  const acknowledged_at = strOrNull(raw.acknowledged_at);
  if (demoted_to === undefined || acknowledged_by === undefined ||
      acknowledged_at === undefined) return undefined;
  return {
    id, class_id, severity: raw.severity, kind: raw.kind, evidence: raw.evidence,
    detected_at, demoted_to, acknowledged_by, acknowledged_at,
  };
}

// ---- reads ---------------------------------------------------------------

export async function readClass(
  client: RuntimeClient, classId: string,
): Promise<AutonomyClassRow | undefined> {
  if (typeof classId !== 'string' || !ID_RE.test(classId)) return undefined;
  try {
    const res = await client.from(AUTONOMY_CLASSES_TABLE)
      .select('*').eq('class_id', classId).limit(1);
    if (res.error || !res.data || res.data.length === 0) return undefined;
    return parseClassRow(res.data[0]);
  } catch {
    return undefined;
  }
}

async function listFor(
  client: RuntimeClient, table: string, classId: string, orderCol: string, limit: number,
): Promise<Record<string, unknown>[] | undefined> {
  if (typeof classId !== 'string' || !ID_RE.test(classId)) return undefined;
  try {
    const res = await client.from(table).select('*').eq('class_id', classId)
      .order(orderCol, { ascending: true }).limit(limit);
    if (res.error || !res.data) return undefined;
    return res.data;
  } catch {
    return undefined;
  }
}

// A malformed grant row is dropped (ignoring a grant can only LOWER the
// effective rung - safe). A read error is undefined (caller: CODED).
export async function listGrants(
  client: RuntimeClient, classId: string, limit = DEFAULT_LIST_LIMIT,
): Promise<AutonomyGrantRow[] | undefined> {
  const rows = await listFor(client, AUTONOMY_GRANTS_TABLE, classId, 'granted_at', limit);
  if (!rows) return undefined;
  const out: AutonomyGrantRow[] = [];
  for (const r of rows) { const g = parseGrantRow(r); if (g) out.push(g); }
  return out;
}

// A malformed anomaly row poisons the whole read (ignoring an anomaly could
// RAISE the effective rung - never safe): undefined -> caller treats CODED.
export async function listAnomalies(
  client: RuntimeClient, classId: string, limit = DEFAULT_LIST_LIMIT,
): Promise<AutonomyAnomalyRow[] | undefined> {
  const rows = await listFor(client, AUTONOMY_ANOMALIES_TABLE, classId, 'detected_at', limit);
  if (!rows) return undefined;
  const out: AutonomyAnomalyRow[] = [];
  for (const r of rows) {
    const a = parseAnomalyRow(r);
    if (!a) return undefined;
    out.push(a);
  }
  return out;
}

// Malformed outcome rows are dropped (less evidence never promotes).
export async function listOutcomes(
  client: RuntimeClient, classId: string, limit = 2000,
): Promise<AutonomyOutcomeRow[] | undefined> {
  const rows = await listFor(client, AUTONOMY_OUTCOMES_TABLE, classId, 'recorded_at', limit);
  if (!rows) return undefined;
  const out: AutonomyOutcomeRow[] = [];
  for (const r of rows) { const o = parseOutcomeRow(r); if (o) out.push(o); }
  return out;
}

// ---- writes (append-only; validated; unique violation = duplicate) -------

async function insertRow(
  client: RuntimeClient, table: string, row: Record<string, unknown>, id: string,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(table).insert(row).select('id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) return { ok: true, duplicate: true, id };
      return fail(`${table} insert failed: ${res.error.message}`);
    }
    return { ok: true, id };
  } catch (e) {
    return fail(e instanceof Error ? e.message : `${table} insert failed`);
  }
}

export interface GrantInput {
  id: string;
  class_id: string;
  from_rung: Rung;
  to_rung: Rung;
  granted_by: string; // owner identity
  evidence: Record<string, unknown>;
  expires_at?: string | null;
}

// A grant is an OWNER promotion of exactly one rung. Evidence is mandatory.
export async function insertGrant(
  client: RuntimeClient, grant: GrantInput, nowIso: string,
): Promise<WriteOutcome> {
  if (!ID_RE.test(String(grant.id ?? ''))) return fail('invalid_grant_id');
  if (!ID_RE.test(String(grant.class_id ?? ''))) return fail('invalid_class_id');
  if (!isRung(grant.from_rung) || !isRung(grant.to_rung)) return fail('invalid_rung');
  if (nextRung(grant.from_rung) !== grant.to_rung) return fail('grant_not_one_rung_up');
  if (!String(grant.granted_by ?? '').trim()) return fail('missing_granted_by');
  if (!isPlainObject(grant.evidence) || Object.keys(grant.evidence).length === 0) {
    return fail('missing_evidence');
  }
  const expires_at = grant.expires_at ?? null;
  if (expires_at !== null && !Number.isFinite(Date.parse(expires_at))) {
    return fail('invalid_expires_at');
  }
  return insertRow(client, AUTONOMY_GRANTS_TABLE, {
    id: grant.id, class_id: grant.class_id, from_rung: grant.from_rung,
    to_rung: grant.to_rung, granted_by: grant.granted_by.trim(), granted_at: nowIso,
    evidence: grant.evidence, expires_at, revoked_at: null, revoked_reason: null,
  }, grant.id);
}

export interface OutcomeInput {
  id: string;
  class_id: string;
  capability_id: string;
  side_effect_id?: string | null;
  outcome: OutcomeKind;
  mode_at_time: Rung;
  evidence_ref?: string | null;
}

export async function insertOutcome(
  client: RuntimeClient, outcome: OutcomeInput, nowIso: string,
): Promise<WriteOutcome> {
  if (!ID_RE.test(String(outcome.id ?? ''))) return fail('invalid_outcome_id');
  if (!ID_RE.test(String(outcome.class_id ?? ''))) return fail('invalid_class_id');
  if (!String(outcome.capability_id ?? '').trim()) return fail('missing_capability_id');
  if (!oneOf(outcome.outcome, OUTCOMES)) return fail('invalid_outcome');
  if (!isRung(outcome.mode_at_time)) return fail('invalid_mode_at_time');
  return insertRow(client, AUTONOMY_OUTCOMES_TABLE, {
    id: outcome.id, class_id: outcome.class_id, capability_id: outcome.capability_id,
    side_effect_id: outcome.side_effect_id ?? null, outcome: outcome.outcome,
    mode_at_time: outcome.mode_at_time, recorded_at: nowIso,
    evidence_ref: outcome.evidence_ref ?? null,
  }, outcome.id);
}

export interface AnomalyInput {
  id: string;
  class_id: string;
  severity: AnomalySeverity;
  kind: AnomalyKind;
  evidence: Record<string, unknown>;
  demoted_to?: Rung | null;
}

export async function insertAnomaly(
  client: RuntimeClient, anomaly: AnomalyInput, nowIso: string,
): Promise<WriteOutcome> {
  if (!ID_RE.test(String(anomaly.id ?? ''))) return fail('invalid_anomaly_id');
  if (!ID_RE.test(String(anomaly.class_id ?? ''))) return fail('invalid_class_id');
  if (!oneOf(anomaly.severity, SEVERITIES)) return fail('invalid_severity');
  if (!oneOf(anomaly.kind, ANOMALY_KINDS)) return fail('invalid_kind');
  if (!isPlainObject(anomaly.evidence) || Object.keys(anomaly.evidence).length === 0) {
    return fail('missing_evidence');
  }
  const demoted_to = anomaly.demoted_to ?? null;
  if (demoted_to !== null && !isRung(demoted_to)) return fail('invalid_demoted_to');
  return insertRow(client, AUTONOMY_ANOMALIES_TABLE, {
    id: anomaly.id, class_id: anomaly.class_id, severity: anomaly.severity,
    kind: anomaly.kind, evidence: anomaly.evidence, detected_at: nowIso,
    demoted_to, acknowledged_by: null, acknowledged_at: null,
  }, anomaly.id);
}

// ---- the single class mutation: CAS on the current rung -----------------

// Promotions move exactly one rung UP (backed by a grant row); demotions
// may skip rungs DOWN (backed by an anomaly row). A lost CAS is a refusal.
export async function updateClassRung(
  client: RuntimeClient, classId: string, fromRung: Rung, toRung: Rung, nowIso: string,
): Promise<WriteOutcome> {
  if (!ID_RE.test(String(classId ?? ''))) return fail('invalid_class_id');
  if (!isRung(fromRung) || !isRung(toRung)) return fail('invalid_rung');
  if (fromRung === toRung) return fail('rung_unchanged');
  if (rungIndex(toRung) > rungIndex(fromRung) && nextRung(fromRung) !== toRung) {
    return fail('promotion_not_one_rung');
  }
  try {
    const res = await client.from(AUTONOMY_CLASSES_TABLE)
      .update({ rung: toRung, updated_at: nowIso })
      .eq('class_id', classId)
      .eq('rung', fromRung)
      .select('class_id');
    if (res.error) return fail(res.error.message);
    if (!res.data || res.data.length === 0) return fail('rung_changed_elsewhere');
    return { ok: true, id: classId };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'rung update failed');
  }
}

// Owner acknowledgement unpins a demoted rung (effective-mode.ts). Read
// first so a repeat acknowledgement is an idempotent duplicate.
export async function acknowledgeAnomaly(
  client: RuntimeClient, anomalyId: string, actor: string, nowIso: string,
): Promise<WriteOutcome> {
  if (!ID_RE.test(String(anomalyId ?? ''))) return fail('invalid_anomaly_id');
  const who = String(actor ?? '').trim();
  if (!who) return fail('missing_actor');
  try {
    const cur = await client.from(AUTONOMY_ANOMALIES_TABLE)
      .select('*').eq('id', anomalyId).limit(1);
    if (cur.error) return fail(cur.error.message);
    const row = parseAnomalyRow(cur.data?.[0]);
    if (!row) return fail('anomaly_not_found');
    if (row.acknowledged_by) return { ok: true, duplicate: true, id: anomalyId };
    const res = await client.from(AUTONOMY_ANOMALIES_TABLE)
      .update({ acknowledged_by: who, acknowledged_at: nowIso })
      .eq('id', anomalyId)
      .select('id');
    if (res.error) return fail(res.error.message);
    if (!res.data || res.data.length === 0) return fail('anomaly_changed_elsewhere');
    return { ok: true, id: anomalyId };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'acknowledge failed');
  }
}

// Owner revocation of a grant: the effective rung falls back to the last
// unbroken chain (never raised). Idempotent on an already-revoked grant.
export async function revokeGrant(
  client: RuntimeClient, grantId: string, reason: string, nowIso: string,
): Promise<WriteOutcome> {
  if (!ID_RE.test(String(grantId ?? ''))) return fail('invalid_grant_id');
  const why = String(reason ?? '').trim();
  if (!why) return fail('missing_reason');
  try {
    const cur = await client.from(AUTONOMY_GRANTS_TABLE)
      .select('*').eq('id', grantId).limit(1);
    if (cur.error) return fail(cur.error.message);
    const row = parseGrantRow(cur.data?.[0]);
    if (!row) return fail('grant_not_found');
    if (row.revoked_at) return { ok: true, duplicate: true, id: grantId };
    const res = await client.from(AUTONOMY_GRANTS_TABLE)
      .update({ revoked_at: nowIso, revoked_reason: why })
      .eq('id', grantId)
      .select('id');
    if (res.error) return fail(res.error.message);
    if (!res.data || res.data.length === 0) return fail('grant_changed_elsewhere');
    return { ok: true, id: grantId };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'revoke failed');
  }
}
