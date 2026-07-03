import { describe, expect, it, vi } from 'vitest';
import {
  getApprovalsCard,
  getLeadsCard,
  getProjectsCard,
  getQuotesCard,
  getTodayCard,
  type SupabaseLike,
  type SupabaseQueryResult,
} from '../src/lib/cards';

const TEST_BASE = 'appTESTBASE0000001';
const airtableEnv = {
  AIRTABLE_TEST_PAT: 'test-pat-placeholder',
  AIRTABLE_TEST_BASE_ID: TEST_BASE,
  AIRTABLE_TBL_APPOINTMENTS: 'tblToday',
  AIRTABLE_TBL_LEADS: 'tblLeads',
  AIRTABLE_TBL_PROJECTS: 'tblProjects',
  AIRTABLE_TBL_QUOTES: 'tblQuotes',
};

function recordsFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      records: [
        { id: 'rec1', fields: { fldA: 'Real TEST row' } },
        { id: 'rec2', fields: { fldA: '' } },
      ],
    }),
  })) as unknown as typeof fetch;
}

function fakeSupabase(result: SupabaseQueryResult): SupabaseLike {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => result,
        }),
      }),
    }),
  };
}

describe('card adapters: mock-to-real switch', () => {
  it('falls back to MOCK with a note in setup mode (empty env)', async () => {
    for (const adapter of [
      getTodayCard,
      getLeadsCard,
      getProjectsCard,
      getQuotesCard,
    ]) {
      const data = await adapter({ env: {} });
      expect(data.source).toBe('mock');
      expect(data.note).toContain('not configured');
      expect(data.items.length).toBeGreaterThan(0);
    }
  });

  it('falls back to MOCK when the table id is missing', async () => {
    const env = {
      AIRTABLE_TEST_PAT: 'test-pat-placeholder',
      AIRTABLE_TEST_BASE_ID: TEST_BASE,
    };
    const data = await getTodayCard({ env });
    expect(data.source).toBe('mock');
    expect(data.note).toContain('AIRTABLE_TBL_APPOINTMENTS');
  });

  it('reads real TEST/DEV rows when env is fully configured', async () => {
    const fetchSpy = recordsFetch();
    const data = await getTodayCard({ env: airtableEnv, fetchImpl: fetchSpy });
    expect(data.source).toBe('airtable_test');
    expect(data.items[0].title).toBe('Real TEST row');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to MOCK on airtable read failure', async () => {
    const failing = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const data = await getQuotesCard({ env: airtableEnv, fetchImpl: failing });
    expect(data.source).toBe('mock');
    expect(data.note).toContain('read failed');
  });
});

describe('approvals card adapter', () => {
  it('falls back to MOCK when supabase is not configured', async () => {
    const data = await getApprovalsCard(null);
    expect(data.source).toBe('mock');
  });

  it('maps approval rows from supabase staging', async () => {
    const data = await getApprovalsCard(
      fakeSupabase({
        data: [
          {
            id: 'a1',
            requested_action: 'staging deploy',
            action_class: 'YELLOW',
            decision: 'pending',
          },
        ],
        error: null,
      }),
    );
    expect(data.source).toBe('supabase_staging');
    expect(data.items[0].title).toContain('staging deploy');
    expect(data.items[0].title).toContain('YELLOW');
  });

  it('shows an empty-queue row when there are no approvals', async () => {
    const data = await getApprovalsCard(fakeSupabase({ data: [], error: null }));
    expect(data.source).toBe('supabase_staging');
    expect(data.items[0].title).toBe('No pending approvals');
  });

  it('falls back to MOCK on supabase error', async () => {
    const data = await getApprovalsCard(
      fakeSupabase({ data: null, error: { message: 'permission denied' } }),
    );
    expect(data.source).toBe('mock');
    expect(data.note).toContain('permission denied');
  });
});
