import { listRecords, type AirtableRecord } from './airtable';

// Card data adapters. The mock-to-real switch is env presence:
// - Airtable TEST env + table id configured -> real TEST/DEV reads
//   through the read-only wrapper (guards enforced there).
// - Anything missing -> MOCK data with an explanatory note.
// No adapter can write anywhere.

export type CardSource = 'mock' | 'airtable_test' | 'supabase_staging';

export interface CardItem {
  id: string;
  title: string;
  detail?: string;
}

export interface CardData {
  source: CardSource;
  items: CardItem[];
  note?: string;
}

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

interface AdapterOpts {
  env?: Env;
  fetchImpl?: FetchLike;
}

const MOCKS: Record<string, CardItem[]> = {
  today: [
    { id: 'mock-1', title: '9:30 AM - Site measure, Brooklyn', detail: 'MOCK' },
    { id: 'mock-2', title: '2:00 PM - Install crew check-in', detail: 'MOCK' },
  ],
  leads: [
    { id: 'mock-1', title: 'Lead: window replacement inquiry', detail: 'MOCK' },
    { id: 'mock-2', title: 'Follow-up: quote sent 5 days ago', detail: 'MOCK' },
  ],
  projects: [
    { id: 'mock-1', title: 'Project A - awaiting delivery', detail: 'MOCK' },
    { id: 'mock-2', title: 'Project B - blocked on permit', detail: 'MOCK' },
  ],
  quotes: [
    { id: 'mock-1', title: 'Quote 1042 - missing measurements', detail: 'MOCK' },
    { id: 'mock-2', title: 'Quote 1043 - awaiting client', detail: 'MOCK' },
  ],
  approvals: [{ id: 'mock-1', title: 'No pending approvals', detail: 'MOCK' }],
};

function mock(key: string, note: string): CardData {
  return { source: 'mock', items: MOCKS[key] ?? [], note };
}

function firstText(fields: Record<string, unknown>, fallback: string): string {
  for (const v of Object.values(fields)) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return fallback;
}

function toItems(records: AirtableRecord[]): CardItem[] {
  return records.map((r) => ({ id: r.id, title: firstText(r.fields, r.id) }));
}

async function airtableCard(
  key: string,
  tableEnvName: string,
  opts?: AdapterOpts,
): Promise<CardData> {
  const env = opts?.env ?? process.env;
  const baseId = env['AIRTABLE_TEST_BASE_ID'];
  const tableId = env[tableEnvName];
  if (!baseId || !env['AIRTABLE_TEST_PAT']) {
    return mock(key, 'setup mode: Airtable TEST env not configured');
  }
  if (!tableId) {
    return mock(key, 'setup mode: ' + tableEnvName + ' not configured');
  }
  try {
    const records = await listRecords(baseId, tableId, {
      env,
      fetchImpl: opts?.fetchImpl,
      maxRecords: 5,
    });
    return { source: 'airtable_test', items: toItems(records) };
  } catch (err) {
    return mock(key, 'airtable read failed: ' + (err as Error).message);
  }
}

export function getTodayCard(opts?: AdapterOpts): Promise<CardData> {
  return airtableCard('today', 'AIRTABLE_TBL_APPOINTMENTS', opts);
}
export function getLeadsCard(opts?: AdapterOpts): Promise<CardData> {
  return airtableCard('leads', 'AIRTABLE_TBL_LEADS', opts);
}
export function getProjectsCard(opts?: AdapterOpts): Promise<CardData> {
  return airtableCard('projects', 'AIRTABLE_TBL_PROJECTS', opts);
}
export function getQuotesCard(opts?: AdapterOpts): Promise<CardData> {
  return airtableCard('quotes', 'AIRTABLE_TBL_QUOTES', opts);
}

// Approvals card reads Supabase staging (approvals queue).
export interface SupabaseQueryResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        opts: { ascending: boolean },
      ): { limit(n: number): PromiseLike<SupabaseQueryResult> };
    };
  };
}

export async function getApprovalsCard(
  supabase: SupabaseLike | null,
): Promise<CardData> {
  if (!supabase) {
    return mock('approvals', 'setup mode: Supabase env not configured');
  }
  try {
    const res = await supabase
      .from('approvals')
      .select('id, requested_action, action_class, decision')
      .order('created_at', { ascending: false })
      .limit(5);
    if (res.error) {
      return mock('approvals', 'supabase read failed: ' + res.error.message);
    }
    const rows = res.data ?? [];
    if (rows.length === 0) {
      return {
        source: 'supabase_staging',
        items: [{ id: 'none', title: 'No pending approvals' }],
      };
    }
    return {
      source: 'supabase_staging',
      items: rows.map((r) => ({
        id: String(r['id'] ?? ''),
        title:
          String(r['requested_action'] ?? 'approval') +
          ' [' +
          String(r['action_class'] ?? '?') +
          '] - ' +
          String(r['decision'] ?? 'pending'),
      })),
    };
  } catch (err) {
    return mock(
      'approvals',
      'supabase read failed: ' + (err as Error).message,
    );
  }
}
