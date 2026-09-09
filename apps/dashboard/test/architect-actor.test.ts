import { describe, expect, it } from 'vitest';
import { requireAttribution } from '../src/lib/ai-os/architect/actor';

const VALID = {
  requested_by: 'owner-0001', proposer: 'architect-0001', approver: 'owner-0001',
  executor: 'claude', correlation_id: 'corr-architect-0005', run_id: 'run-00000005',
};

describe('AG-5 actor attribution', () => {
  it('accepts a complete, separated, capable attribution', () => {
    expect(requireAttribution(VALID)).toEqual({ ok: true, attribution: VALID });
    expect(requireAttribution({ ...VALID, approver: null, run_id: null }).ok).toBe(true);
  });

  it('rejects every missing mandatory field without throwing', () => {
    for (const field of Object.keys(VALID)) {
      const candidate = { ...VALID } as Record<string, unknown>;
      delete candidate[field];
      const result = requireAttribution(candidate);
      expect(result.ok, field).toBe(false);
    }
    expect(requireAttribution(null).ok).toBe(false);
  });

  it('rejects proposer self-approval', () => {
    const result = requireAttribution({ ...VALID, approver: VALID.proposer });
    expect(result).toMatchObject({
      ok: false, errors: expect.arrayContaining(['self_approval_denied']),
    });
  });

  it('rejects ChatGPT as executor', () => {
    expect(requireAttribution({ ...VALID, executor: 'chatgpt' })).toMatchObject({
      ok: false, errors: expect.arrayContaining(['executor_invalid']),
    });
  });

  it('rejects an executor that lacks propose_github_change capability', () => {
    for (const executor of ['hermes', 'audit']) {
      expect(requireAttribution({ ...VALID, executor })).toMatchObject({
        ok: false, errors: expect.arrayContaining(['executor_capability_denied']),
      });
    }
  });

  it('requires every non-null identity to match the shared runtime ID format', () => {
    for (const [field, value] of [
      ['requested_by', 'x'], ['proposer', 'x'], ['approver', 'x'],
      ['correlation_id', 'x'], ['run_id', 'x'],
    ]) {
      expect(requireAttribution({ ...VALID, [field]: value }).ok, field).toBe(false);
    }
  });
});
