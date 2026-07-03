import { GuardError, assertAirtableTestOnly } from './guards';

// Airtable TEST/DEV read-only wrapper. Server-only. Field IDs, not
// field names (returnFieldsByFieldId). Base allowlist enforced by the
// shared guard. Writes are physically blocked in Phase 0B.

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export async function listRecords(
  baseId: string,
  tableId: string,
  opts?: { env?: Env; fetchImpl?: FetchLike; maxRecords?: number },
): Promise<AirtableRecord[]> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const pat = env['AIRTABLE_TEST_PAT'];
  const allowed = env['AIRTABLE_TEST_BASE_ID'];

  assertAirtableTestOnly(baseId, allowed);
  if (!pat) {
    throw new GuardError('airtable: AIRTABLE_TEST_PAT is not configured');
  }

  const max = opts?.maxRecords ?? 25;
  const url =
    'https://api.airtable.com/v0/' +
    baseId +
    '/' +
    tableId +
    '?maxRecords=' +
    max +
    '&returnFieldsByFieldId=true';

  const res = await fetchImpl(url, {
    headers: { authorization: 'Bearer ' + pat },
  });
  if (!res.ok) {
    throw new Error('airtable read failed: http ' + res.status);
  }
  const data = (await res.json()) as { records?: AirtableRecord[] };
  return data.records ?? [];
}

// Phase 0B: every Airtable write path is blocked, unconditionally.
export function writeRecords(): never {
  throw new GuardError('airtable: writes are blocked in Phase 0B');
}
