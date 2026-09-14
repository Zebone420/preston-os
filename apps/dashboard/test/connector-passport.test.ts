import { describe, expect, it } from 'vitest';
import {
  evaluateConnectorPassport,
  makeSandboxConnectorPassport,
  type ConnectorPassport,
  type ConnectorRequirement,
} from '../src/lib/ai-os/connectors/passport';
import { executeCapability } from '../src/lib/ai-os/capabilities/executor';
import {
  makeFakeDb,
  makeHarness,
  proposalParams,
  request,
} from './business-capability-harness.test';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const requirement: ConnectorRequirement = {
  provider: 'gmail',
  capability: 'gmail.message.draft',
  operation_kind: 'write',
  environment: 'staging',
  required_mode: 'sandbox_only',
  now_ms: NOW,
};

function passport(over: Partial<ConnectorPassport> = {}): ConnectorPassport {
  return {
    ...makeSandboxConnectorPassport({
      provider: 'gmail', capabilities: ['gmail.message.draft'],
      environment: 'staging', now_ms: NOW,
    }),
    ...over,
  };
}

describe('M8 ConnectorPassport freshness contract', () => {
  it('accepts an exact, fresh, scoped, environment-bound sandbox passport', () => {
    expect(evaluateConnectorPassport(passport(), requirement)).toMatchObject({
      ok: true, age_seconds: 0, mode: 'sandbox_only',
    });
  });

  it.each([
    [undefined, 'passport_missing'],
    [passport({ provider: 'drive' }), 'provider_mismatch'],
    [passport({ environment: 'production' }), 'environment_mismatch'],
    [passport({ mode: 'read_only' }), 'mode_mismatch'],
    [passport({ health: 'offline' }), 'health_offline'],
    [passport({ allowed_capabilities: [] }), 'capability_scope_absent'],
    [passport({ scope_hash: 'bad' }), 'scope_hash_invalid'],
    [passport({ evidence_ref: '' }), 'evidence_ref_missing'],
  ] as const)('fails closed for %s -> %s', (value, reason) => {
    expect(evaluateConnectorPassport(value, requirement))
      .toEqual({ ok: false, reason });
  });

  it('rejects stale data even when the connector observation is fresh', () => {
    const stale = passport({
      observed_at: new Date(NOW).toISOString(),
      data_as_of: new Date(NOW - 301_000).toISOString(),
    });
    expect(evaluateConnectorPassport(stale, requirement))
      .toEqual({ ok: false, reason: 'data_stale' });
  });

  it('rejects stale observations, future timestamps, and expiry at the boundary', () => {
    expect(evaluateConnectorPassport(passport({
      observed_at: new Date(NOW - 301_000).toISOString(),
    }), requirement)).toEqual({ ok: false, reason: 'observation_stale' });
    expect(evaluateConnectorPassport(passport({
      data_as_of: new Date(NOW + 31_000).toISOString(),
    }), requirement)).toEqual({ ok: false, reason: 'data_as_of_future' });
    expect(evaluateConnectorPassport(passport({
      expires_at: new Date(NOW).toISOString(),
    }), requirement)).toEqual({ ok: false, reason: 'passport_expired' });
  });

  it('a read-only passport can never authorize a write requirement', () => {
    const check = evaluateConnectorPassport(passport({ mode: 'read_only' }), {
      ...requirement, required_mode: 'read_only',
    });
    expect(check).toEqual({ ok: false, reason: 'write_scope_absent' });
  });

  it('the trusted executor refuses a stale passport before ledger or adapter access', async () => {
    const db = makeFakeDb();
    const h = makeHarness(db, {
      readConnectorPassport: async () => passport({
        provider: 'preston.business',
        allowed_capabilities: ['proposal.document.render'],
        data_as_of: new Date(NOW - 301_000).toISOString(),
      }),
    });
    const result = await executeCapability(
      h.deps,
      request('proposal.document.render', proposalParams()),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      error_class: 'retryable',
      reason: 'connector_not_ready:data_stale',
    });
    expect(h.calls()).toBe(0);
    expect(db.rowsOf('side_effects')).toEqual([]);
  });
});
