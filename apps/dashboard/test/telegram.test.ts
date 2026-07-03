import { describe, expect, it, vi } from 'vitest';
import { GuardError } from '../src/lib/guards';
import { TELEGRAM_MODE, notifyOwner } from '../src/lib/telegram';

const OWNER = '123456';
const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'test-token-placeholder',
  TELEGRAM_OWNER_CHAT_ID: OWNER,
  DISABLE_ALL_AI_WRITES: 'false',
};

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200 })) as unknown as
    typeof fetch;
}

describe('telegram stage 1 (notify-only)', () => {
  it('mode is hardcoded to notify_only', () => {
    expect(TELEGRAM_MODE).toBe('notify_only');
  });

  it('rejects a non-owner chat id BEFORE any network call', async () => {
    const fetchSpy = okFetch();
    await expect(
      notifyOwner('hello', '999999', { env: baseEnv, fetchImpl: fetchSpy }),
    ).rejects.toThrow(GuardError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('scrubber blocks secret-shaped strings BEFORE any network call', async () => {
    const fetchSpy = okFetch();
    const fake = 'sk-' + 'a'.repeat(24);
    await expect(
      notifyOwner('key: ' + fake, OWNER, {
        env: baseEnv,
        fetchImpl: fetchSpy,
      }),
    ).rejects.toThrow(GuardError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not send when env is not configured', async () => {
    const fetchSpy = okFetch();
    const result = await notifyOwner('hello', OWNER, {
      env: {},
      fetchImpl: fetchSpy,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('telegram_not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed under the master shutoff flag', async () => {
    const fetchSpy = okFetch();
    const result = await notifyOwner('hello', OWNER, {
      env: { ...baseEnv, DISABLE_ALL_AI_WRITES: 'true' },
      fetchImpl: fetchSpy,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('shutoff_disable_all_ai_writes');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('telegram unavailable = no execution, failure reported', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await notifyOwner('hello', OWNER, {
      env: baseEnv,
      fetchImpl: failingFetch,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('telegram_unreachable');
  });

  it('sends to the owner when everything is valid (mocked network)', async () => {
    const fetchSpy = okFetch();
    const result = await notifyOwner('Approval requested: task 42', OWNER, {
      env: baseEnv,
      fetchImpl: fetchSpy,
    });
    expect(result.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
