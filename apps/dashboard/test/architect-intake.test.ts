import { describe, expect, it } from 'vitest';
import {
  validateArchitectRequest,
  type ArchitectRequest,
} from '../src/lib/ai-os/architect/intake';

function validRequest(): ArchitectRequest {
  return {
    repo: 'Zebone420/preston-os',
    base_branch: 'feature/hermes-native',
    objective: 'Add repository allowlist enforcement.',
    correlation_id: 'corr-architect-0001',
    requested_by: 'owner',
    source_goal_job_id: 'goal-job-0001',
    environment: 'staging',
  };
}

describe('validateArchitectRequest', () => {
  it('accepts a fully-populated request', () => {
    expect(validateArchitectRequest(validRequest(), 'staging')).toEqual({
      ok: true, request: validRequest(),
    });
  });

  it('rejects a missing repo', () => {
    const r = { ...validRequest(), repo: '' };
    expect(validateArchitectRequest(r, 'staging')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['repo_required']),
    });
  });

  it('rejects a missing base_branch', () => {
    const r = { ...validRequest(), base_branch: '   ' };
    expect(validateArchitectRequest(r, 'staging')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['base_branch_required']),
    });
  });

  it('rejects a missing objective', () => {
    const r = { ...validRequest(), objective: '' };
    expect(validateArchitectRequest(r, 'staging')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['objective_required']),
    });
  });

  it('rejects a malformed correlation_id', () => {
    const r = { ...validRequest(), correlation_id: 'x' };
    expect(validateArchitectRequest(r, 'staging')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['correlation_id_invalid']),
    });
  });

  it('rejects a missing requested_by', () => {
    const r = { ...validRequest(), requested_by: '' };
    expect(validateArchitectRequest(r, 'staging')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['requested_by_required']),
    });
  });

  it('rejects a malformed source_goal_job_id', () => {
    const r = { ...validRequest(), source_goal_job_id: '!' };
    expect(validateArchitectRequest(r, 'staging')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['source_goal_job_id_invalid']),
    });
  });

  it('rejects an environment that does not match the deployment pin', () => {
    const r = { ...validRequest(), environment: 'staging' as const };
    expect(validateArchitectRequest(r, 'production')).toMatchObject({
      ok: false, errors: expect.arrayContaining(['environment_mismatch']),
    });
  });

  it('reports every violated field at once, not just the first', () => {
    const r = { ...validRequest(), repo: '', requested_by: '' };
    const result = validateArchitectRequest(r, 'staging');
    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining([
      'repo_required', 'requested_by_required',
    ]) });
  });

  it('fails closed for arbitrary raw inputs without throwing', () => {
    for (const raw of [null, undefined, [], 'request', 1]) {
      const result = validateArchitectRequest(raw, 'staging');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBe(7);
    }
  });
});
