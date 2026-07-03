import { describe, expect, it, vi } from 'vitest';
import { GuardError } from '../src/lib/guards';
import { listRecords, writeRecords } from '../src/lib/airtable';

const TEST_BASE = 'appTESTBASE0000001';
const baseEnv = {
  AIRTABLE_TEST_PAT: 'test-pat-placeholder',
  AIRTABLE_TEST_BASE_ID: TEST_BASE,
};

function recordsFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      records: [{ id: 'rec1', fields: { fldName: 'Sample' } }],
    }),
  })) as unknown as typeof fetch;
}

describe('airtable read-only wrapper', () => {
  it('blocks bases not on the TEST/DEV allowlist', async () => {
    const fetchSpy = recordsFetch();
    await expect(
      listRecords('appPRODBASE0000001', 'tbl1', {
        env: baseEnv,
        fetchImpl: fetchSpy,
      }),
    ).rejects.toThrow(GuardError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks when the allowlist is not configured', async () => {
    const fetchSpy = recordsFetch();
    await expect(
      listRecords(TEST_BASE, 'tbl1', { env: {}, fetchImpl: fetchSpy }),
    ).rejects.toThrow(GuardError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks when the PAT is missing', async () => {
    const fetchSpy = recordsFetch();
    await expect(
      listRecords(TEST_BASE, 'tbl1', {
        env: { AIRTABLE_TEST_BASE_ID: TEST_BASE },
        fetchImpl: fetchSpy,
      }),
    ).rejects.toThrow(GuardError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads records from the TEST base by field id (mocked network)', async () => {
    const fetchSpy = recordsFetch();
    const records = await listRecords(TEST_BASE, 'tbl1', {
      env: baseEnv,
      fetchImpl: fetchSpy,
    });
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('rec1');
    const calledUrl = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('returnFieldsByFieldId=true');
  });

  it('write path is physically blocked in Phase 0B', () => {
    expect(() => writeRecords()).toThrow(GuardError);
  });
});
