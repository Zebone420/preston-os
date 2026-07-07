import { describe, expect, it } from 'vitest';
import {
  createApprovalRequest,
  createCommandPacket,
  decide,
  evaluateExecution,
  executeApproved,
  listPendingApprovals,
  resolveStatus,
  MOCK_APPROVALS,
  type ActionType,
  type RiskClass,
} from '../src/lib/approvals';

const NOW = '2026-07-06T12:30:00.000Z'; // within the seed window (expires 14:00)

// Shutoff flags explicitly cleared, so only the Phase 2 rules (not the
// fail-closed default) decide. Absence of these = blocked by default.
const CLEAR = {
  DISABLE_ALL_AI_WRITES: 'false',
  DISABLE_CLIENT_MESSAGES: 'false',
  DISABLE_EMAIL_SEND: 'false',
  DISABLE_CALENDAR_WRITES: 'false',
  DISABLE_AIRTABLE_PROD_WRITES: 'false',
  DISABLE_N8N_ACTIVATION: 'false',
  DISABLE_REMOTE_RUNNER: 'false',
  DISABLE_PRODUCTION_DEPLOY: 'false',
};

function makeRequest(
  action_type: ActionType,
  risk_class: RiskClass,
  opts?: { approve?: boolean; now?: string; ttlMinutes?: number },
) {
  const now = opts?.now ?? NOW;
  const packet = createCommandPacket({
    task_id: `t-${action_type}-${risk_class}`,
    action_type,
    risk_class,
    summary: 'MOCK - test packet',
    now,
  });
  let req = createApprovalRequest(packet, { now, ttlMinutes: opts?.ttlMinutes ?? 60 });
  if (opts?.approve) req = decide(req, { decision: 'approved', now });
  return req;
}

describe('Approval Center - command packets and model', () => {
  it('creates a command packet locally (requires approval, summary neutralized)', () => {
    const packet = createCommandPacket({
      task_id: 't1',
      action_type: 'draft_email',
      risk_class: 'GREEN',
      summary: 'clean\x00 summary\x07',
      now: NOW,
    });
    expect(packet.requires_owner_approval).toBe(true);
    expect(packet.summary).toBe('clean summary'); // control chars stripped
    expect(packet.created_at).toBe(NOW);
  });

  it('lists pending approvals from the mock seed', () => {
    const pending = listPendingApprovals(MOCK_APPROVALS, NOW);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((r) => r.packet.task_id === 'draft-lead-reply')).toBe(true);
    // the BLACK remote_command is seeded 'blocked', never pending
    expect(pending.some((r) => r.packet.task_id === 'remote-deploy')).toBe(false);
  });

  it('a fresh approval request starts pending', () => {
    const req = makeRequest('draft_email', 'GREEN');
    expect(resolveStatus(req, NOW)).toBe('pending');
  });
});

describe('Approval Center - fail-closed execution guard', () => {
  it('happy path: approved GREEN draft may execute as MOCK only', () => {
    const req = makeRequest('draft_email', 'GREEN', { approve: true });
    const d = evaluateExecution(req, { env: CLEAR, now: NOW });
    expect(d.allowed).toBe(true);
    expect(d.audit.event).toBe('executed_mock');
    expect(d.audit.production_touched).toBe(false);
    expect(d.audit.write_actions_performed).toBe(false);
  });

  it('missing approval blocks execution', () => {
    const req = makeRequest('draft_email', 'GREEN'); // not approved
    const d = evaluateExecution(req, { env: CLEAR, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('no owner approval');
  });

  it('rejected approval blocks execution', () => {
    let req = makeRequest('draft_email', 'GREEN');
    req = decide(req, { decision: 'rejected', now: NOW });
    const d = evaluateExecution(req, { env: CLEAR, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('no owner approval');
  });

  it('expired approval blocks execution', () => {
    const req = makeRequest('draft_email', 'GREEN', { approve: true, ttlMinutes: 60 });
    const later = '2026-07-06T15:00:00.000Z'; // past 13:30 expiry
    const d = evaluateExecution(req, { env: CLEAR, now: later });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('expired');
  });

  it('RED action blocks execution even when approved', () => {
    const req = makeRequest('draft_email', 'RED', { approve: true });
    const d = evaluateExecution(req, { env: CLEAR, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('RED');
  });

  it('send_email blocks execution (no live send path in Phase 2)', () => {
    const req = makeRequest('send_email', 'GREEN', { approve: true });
    const d = evaluateExecution(req, { env: CLEAR, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('send_email');
  });

  it('every live action type is blocked from execution', () => {
    const live: ActionType[] = [
      'send_email',
      'calendar_write',
      'airtable_write',
      'supabase_write',
      'n8n_action',
      'remote_command',
    ];
    for (const a of live) {
      const req = makeRequest(a, 'GREEN', { approve: true });
      expect(evaluateExecution(req, { env: CLEAR, now: NOW }).allowed).toBe(false);
    }
  });

  it('emergency shutoff blocks execution (master kill engaged)', () => {
    const req = makeRequest('draft_email', 'GREEN', { approve: true });
    // env {} => DISABLE_ALL_AI_WRITES missing => fail-closed blocked
    const d = evaluateExecution(req, { env: {}, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('DISABLE_ALL_AI_WRITES');
  });

  it('production environment blocks execution', () => {
    const packet = createCommandPacket({
      task_id: 'prod-x',
      action_type: 'draft_email',
      risk_class: 'GREEN',
      environment: 'production',
      summary: 'MOCK',
      now: NOW,
    });
    let req = createApprovalRequest(packet, { now: NOW });
    req = decide(req, { decision: 'approved', now: NOW });
    const d = evaluateExecution(req, { env: CLEAR, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('production');
  });

  it('executeApproved never performs a live action - MOCK artifact only', () => {
    const req = makeRequest('draft_email', 'GREEN', { approve: true });
    const out = executeApproved(req, { env: CLEAR, now: NOW });
    expect(out.executed).toBe(true);
    expect(out.result).toContain('MOCK');
    expect(out.audit.production_touched).toBe(false);
    expect(out.audit.write_actions_performed).toBe(false);

    // a blocked one does not execute and returns no result
    const blocked = executeApproved(makeRequest('send_email', 'RED', { approve: true }), {
      env: CLEAR,
      now: NOW,
    });
    expect(blocked.executed).toBe(false);
    expect(blocked.result).toBeUndefined();
  });
});
