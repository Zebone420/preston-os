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

export type CardKey = 'today' | 'leads' | 'projects' | 'quotes';

export interface FieldMapping {
  title: string[];
  detail: string[];
}

// Per-card field-NAME priority lists (Stage 7). For each record the first
// present, non-empty, displayable field in the list wins. Owner chose names
// over field IDs for readability; if Airtable field names change, update
// these lists. Read-only display only - nothing here writes.
export const CARD_FIELDS: Record<CardKey, FieldMapping> = {
  today: {
    title: ['Type', 'Appointment Type', 'Subject', 'Name', 'Title'],
    detail: [
      'Date',
      'Appointment Date',
      'Start Time',
      'Location',
      'Address',
      'Project',
    ],
  },
  leads: {
    title: [
      'Lead Name',
      'Name',
      'Client Name',
      'Full Name',
      'Address',
      'Project Address',
    ],
    detail: ['Status', 'Stage', 'Phone', 'Email', 'Source'],
  },
  projects: {
    title: ['Project Name', 'Name', 'Address', 'Project Address', 'Client Name'],
    detail: ['Status', 'Stage', 'Blocker', 'Next Step'],
  },
  quotes: {
    title: ['Quote Name', 'Name', 'Client Name', 'Project Address', 'Address'],
    detail: ['Status', 'Quote Status', 'Date', 'Created', 'Total', 'Amount'],
  },
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Airtable record/field/base/table/view ids - never shown to a user.
function isAirtableId(s: string): boolean {
  return /^(rec|fld|app|tbl|viw)[A-Za-z0-9]{14,}$/.test(s);
}

// Clean display for an ISO date-only or datetime string; undefined if the
// value is not an ISO date. Pure string math (no Date) so it is timezone-
// and locale-stable and deterministic in tests.
export function formatDateValue(value: string): string | undefined {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return undefined;
  let out = month + ' ' + Number(m[3]) + ', ' + m[1];
  if (m[4] !== undefined && m[5] !== undefined) {
    let h = Number(m[4]);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    out += ', ' + h + ':' + m[5] + ' ' + ampm;
  }
  return out;
}

// Raw Airtable value -> display string, or undefined if empty or id-shaped.
// Arrays (multi-select, linked records) are joined from displayable parts.
function formatCell(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '' || isAirtableId(s)) return undefined;
    return formatDateValue(s) ?? s;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) =>
        typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '',
      )
      .filter((s) => s !== '' && !isAirtableId(s));
    return parts.length ? parts.join(', ') : undefined;
  }
  return undefined;
}

function pickByPriority(
  fields: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const name of names) {
    if (name in fields) {
      const cell = formatCell(fields[name]);
      if (cell !== undefined) return cell;
    }
  }
  return undefined;
}

// Title fallback when no priority field matched: the first displayable value
// in the record - never a rec.../fld... id and never the raw record id.
function fallbackTitle(fields: Record<string, unknown>): string {
  for (const v of Object.values(fields)) {
    const cell = formatCell(v);
    if (cell !== undefined) return cell;
  }
  return '(untitled record)';
}

export function toCardItems(
  records: AirtableRecord[],
  mapping: FieldMapping,
): CardItem[] {
  return records.map((r) => {
    const fields = r.fields ?? {};
    const title = pickByPriority(fields, mapping.title) ?? fallbackTitle(fields);
    const detail = pickByPriority(fields, mapping.detail);
    return detail ? { id: r.id, title, detail } : { id: r.id, title };
  });
}

async function airtableCard(
  key: CardKey,
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
    return {
      source: 'airtable_test',
      items: toCardItems(records, CARD_FIELDS[key]),
    };
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
