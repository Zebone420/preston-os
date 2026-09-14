// Preston AI OS - M8 ConnectorPassport and freshness contract.
//
// A connector name on an agent or capability is not evidence that the
// connector is usable.  The trusted executor requires a recent, scoped,
// environment-bound passport before it reaches the side-effect ledger or a
// provider adapter.  Passports contain no credential material.

import type { RuntimeClient } from '../store';
import type { RuntimeEnvironment } from '../runtime-environment';

export const CONNECTOR_MODES = [
  'sandbox_only', 'read_only', 'read_write',
] as const;
export type ConnectorMode = (typeof CONNECTOR_MODES)[number];

export const CONNECTOR_HEALTH = [
  'ready', 'degraded', 'offline', 'revoked',
] as const;
export type ConnectorHealth = (typeof CONNECTOR_HEALTH)[number];

export interface ConnectorPassport {
  connector_id: string;
  provider: string;
  environment: RuntimeEnvironment;
  mode: ConnectorMode;
  health: ConnectorHealth;
  account_ref: string;
  allowed_capabilities: string[];
  scope_hash: string;
  observed_at: string;
  data_as_of: string;
  max_age_seconds: number;
  expires_at: string | null;
  evidence_ref: string;
  revision: number;
}

export interface ConnectorRequirement {
  provider: string;
  capability: string;
  operation_kind: 'read' | 'write';
  environment: RuntimeEnvironment;
  required_mode: ConnectorMode;
  now_ms: number;
  max_future_skew_ms?: number;
}

export type ConnectorPassportCheck =
  | {
      ok: true;
      age_seconds: number;
      observed_age_seconds: number;
      mode: ConnectorMode;
      evidence_ref: string;
    }
  | { ok: false; reason: string };

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{1,119}$/i;

function finiteTime(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Pure, static-reason fail-closed evaluator.  Freshness is checked against
// both the connector observation and the data watermark: a fresh heartbeat
// may not disguise stale provider data.
export function evaluateConnectorPassport(
  passport: ConnectorPassport | null | undefined,
  requirement: ConnectorRequirement,
): ConnectorPassportCheck {
  if (!passport) return { ok: false, reason: 'passport_missing' };
  if (!Number.isFinite(requirement.now_ms)) {
    return { ok: false, reason: 'clock_invalid' };
  }
  if (!ID.test(passport.connector_id)) {
    return { ok: false, reason: 'connector_id_invalid' };
  }
  if (passport.provider !== requirement.provider) {
    return { ok: false, reason: 'provider_mismatch' };
  }
  if (passport.environment !== requirement.environment) {
    return { ok: false, reason: 'environment_mismatch' };
  }
  if (passport.mode !== requirement.required_mode) {
    return { ok: false, reason: 'mode_mismatch' };
  }
  if (requirement.operation_kind === 'write' && passport.mode === 'read_only') {
    return { ok: false, reason: 'write_scope_absent' };
  }
  if (passport.health !== 'ready') {
    return { ok: false, reason: `health_${passport.health}` };
  }
  if (!passport.account_ref.trim()) {
    return { ok: false, reason: 'account_ref_missing' };
  }
  if (!SHA256.test(passport.scope_hash)) {
    return { ok: false, reason: 'scope_hash_invalid' };
  }
  if (!passport.allowed_capabilities.includes(requirement.capability)) {
    return { ok: false, reason: 'capability_scope_absent' };
  }
  if (!passport.evidence_ref.trim()) {
    return { ok: false, reason: 'evidence_ref_missing' };
  }
  if (!Number.isInteger(passport.revision) || passport.revision < 1) {
    return { ok: false, reason: 'revision_invalid' };
  }
  if (!Number.isInteger(passport.max_age_seconds) ||
      passport.max_age_seconds < 1 || passport.max_age_seconds > 86_400) {
    return { ok: false, reason: 'max_age_invalid' };
  }

  const observed = finiteTime(passport.observed_at);
  const dataAsOf = finiteTime(passport.data_as_of);
  if (observed === null) return { ok: false, reason: 'observed_at_invalid' };
  if (dataAsOf === null) return { ok: false, reason: 'data_as_of_invalid' };
  const skew = Math.max(0, Math.min(
    300_000, requirement.max_future_skew_ms ?? 30_000,
  ));
  if (observed > requirement.now_ms + skew) {
    return { ok: false, reason: 'observed_at_future' };
  }
  if (dataAsOf > requirement.now_ms + skew) {
    return { ok: false, reason: 'data_as_of_future' };
  }
  const expires = passport.expires_at === null
    ? null : finiteTime(passport.expires_at);
  if (passport.expires_at !== null && expires === null) {
    return { ok: false, reason: 'expires_at_invalid' };
  }
  if (expires !== null && requirement.now_ms >= expires) {
    return { ok: false, reason: 'passport_expired' };
  }
  const maxAgeMs = passport.max_age_seconds * 1000;
  const observedAge = Math.max(0, requirement.now_ms - observed);
  const dataAge = Math.max(0, requirement.now_ms - dataAsOf);
  if (observedAge > maxAgeMs) {
    return { ok: false, reason: 'observation_stale' };
  }
  if (dataAge > maxAgeMs) return { ok: false, reason: 'data_stale' };
  return {
    ok: true,
    age_seconds: Math.floor(dataAge / 1000),
    observed_age_seconds: Math.floor(observedAge / 1000),
    mode: passport.mode,
    evidence_ref: passport.evidence_ref,
  };
}

export function makeSandboxConnectorPassport(args: {
  provider: string;
  capabilities: string[];
  environment: RuntimeEnvironment;
  now_ms: number;
}): ConnectorPassport {
  const now = new Date(args.now_ms).toISOString();
  return {
    connector_id: `sandbox:${args.provider}`,
    provider: args.provider,
    environment: args.environment,
    mode: 'sandbox_only',
    health: 'ready',
    account_ref: 'sandbox:no-external-account',
    allowed_capabilities: [...new Set(args.capabilities)].sort(),
    scope_hash: '0'.repeat(64),
    observed_at: now,
    data_as_of: now,
    max_age_seconds: 300,
    expires_at: new Date(args.now_ms + 300_000).toISOString(),
    evidence_ref: 'sandbox:no-external-connector',
    revision: 1,
  };
}

function asPassport(row: Record<string, unknown>): ConnectorPassport | undefined {
  if (!Array.isArray(row.allowed_capabilities)) return undefined;
  return {
    connector_id: String(row.connector_id ?? ''),
    provider: String(row.provider ?? ''),
    environment: String(row.environment ?? '') as RuntimeEnvironment,
    mode: String(row.mode ?? '') as ConnectorMode,
    health: String(row.health ?? '') as ConnectorHealth,
    account_ref: String(row.account_ref ?? ''),
    allowed_capabilities: row.allowed_capabilities.map(String),
    scope_hash: String(row.scope_hash ?? ''),
    observed_at: String(row.observed_at ?? ''),
    data_as_of: String(row.data_as_of ?? ''),
    max_age_seconds: Number(row.max_age_seconds),
    expires_at: row.expires_at == null ? null : String(row.expires_at),
    evidence_ref: String(row.evidence_ref ?? ''),
    revision: Number(row.revision),
  };
}

// Read the newest passport for one provider/environment.  Errors and malformed
// rows collapse to undefined so the caller always refuses safely.
export async function readConnectorPassport(
  client: RuntimeClient,
  provider: string,
  environment: RuntimeEnvironment,
): Promise<ConnectorPassport | undefined> {
  try {
    const q = await client.from('connector_passports').select('*')
      .eq('provider', provider).eq('environment', environment)
      .order('observed_at', { ascending: false }).limit(1);
    const row = (q.data as Record<string, unknown>[] | null)?.[0];
    return row ? asPassport(row) : undefined;
  } catch {
    return undefined;
  }
}
