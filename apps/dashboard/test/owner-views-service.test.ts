import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import { prestonOwnerView, type ToolContext } from '../src/lib/preston-control/tools';

const NOW = '2026-09-08T12:00:00.000Z';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const CLIENT_ID = '22222222-3333-4444-8555-666666666666';

function context(db: ReturnType<typeof makeComposerFakeDb>): ToolContext {
  return { client: db.client, ownerEmail: 'owner@example.com', now: NOW };
}

describe('Phase 2 owner read operations', () => {
  it('builds Today, Approvals, Workforce, Incidents and Brief from the same bounded rows', async () => {
    const db = makeComposerFakeDb();
    db.rowsOf('projects').push({ id: PROJECT_ID, project_code: 'P26-0041' });
    db.rowsOf('attention_items').push({
      id: 'att-1', item_type: 'OUR_COMMITMENT', detector: 'commitment_due',
      project_id: PROJECT_ID, subject: 'Call client', status: 'open',
      due_at: '2026-09-07T12:00:00.000Z', first_seen_at: NOW,
      evidence: [{ kind: 'message', ref: 'msg-1' }],
    });
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-12345678', status: 'pending', risk_class: 'RED',
      action: 'review proposal', created_at: NOW,
      expires_at: '2026-09-09T12:00:00.000Z',
    });
    db.rowsOf('goal_jobs').push({
      id: 'job-1', goal_id: 'goal-1', title: 'Draft proposal',
      status: 'in_progress', assigned_role: 'claude', risk_class: 'GREEN',
      attempts: 1, evidence_refs: [], created_at: NOW, updated_at: NOW,
    });
    for (const view of ['today', 'approvals', 'workforce', 'incidents', 'brief'] as const) {
      const result = await prestonOwnerView(context(db), { view });
      expect(result.ok, view).toBe(true);
    }
    const today = await prestonOwnerView(context(db), { view: 'today' });
    expect(JSON.stringify(today)).toContain('Call client');
    expect(JSON.stringify(today)).toContain('P26-0041');
    const approvals = await prestonOwnerView(context(db), { view: 'approvals' });
    expect(JSON.stringify(approvals)).toContain('apr-12345678');
    const workforce = await prestonOwnerView(context(db), { view: 'workforce' });
    expect(JSON.stringify(workforce)).toContain('Draft proposal');
  });

  it('Project returns current document truth and fails honestly for absent facts', async () => {
    const db = makeComposerFakeDb();
    db.rowsOf('projects').push({
      id: PROJECT_ID, project_code: 'P26-0041', client_id: CLIENT_ID,
      title: 'Example project', status: 'in_progress',
    });
    db.rowsOf('business_clients').push({
      id: CLIENT_ID, display_name: 'Example Client', client_type: 'homeowner',
    });
    db.rowsOf('documents').push({
      id: 'doc-1', project_id: PROJECT_ID, document_type: 'proposal',
      canonical_filename: 'P26-0041_PROPOSAL_CLIENT_V01.pdf', version: 1,
      is_current: true, authority_class: 'PROJECT_RECORD',
      privacy_class: 'CLIENT_CONFIDENTIAL', verification_status: 'verified',
      registered_at: NOW, drive_file_id: 'drive-1',
    });
    const result = await prestonOwnerView(context(db), {
      view: 'project', project_ref: 'P26-0041',
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('P26-0041_PROPOSAL_CLIENT_V01.pdf');
    expect(JSON.stringify(result)).toContain('drive-1');
  });

  it('rejects invalid view argument combinations without reading actions', async () => {
    const db = makeComposerFakeDb();
    expect(await prestonOwnerView(context(db), { view: 'project' }))
      .toEqual({ ok: false, error: 'project_ref_required' });
    expect(await prestonOwnerView(context(db), {
      view: 'today', project_ref: 'P26-0041',
    })).toEqual({ ok: false, error: 'project_ref_only_valid_for_project' });
  });
});
