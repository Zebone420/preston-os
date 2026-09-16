import { afterEach, describe, expect, it } from 'vitest';
import { loadLettaBrainConfig } from '../src/lib/brain/letta-config';

const saved = {
  PRESTON_BRAIN_ENABLED: process.env.PRESTON_BRAIN_ENABLED,
  PRESTON_BRAIN_LETTA_BACKEND: process.env.PRESTON_BRAIN_LETTA_BACKEND,
  PRESTON_BRAIN_BRIDGE_URL: process.env.PRESTON_BRAIN_BRIDGE_URL,
  PRESTON_BRAIN_LETTA_URL: process.env.PRESTON_BRAIN_LETTA_URL,
  PRESTON_BRAIN_LETTA_AGENT_ID: process.env.PRESTON_BRAIN_LETTA_AGENT_ID,
  PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED: process.env.PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED,
  SUPABASE_RUNTIME_ENV: process.env.SUPABASE_RUNTIME_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Super Brain dashboard endpoint separation', () => {
  it('loads the Brain Bridge URL and never the direct Letta URL', () => {
    process.env.PRESTON_BRAIN_ENABLED = 'true';
    process.env.PRESTON_BRAIN_LETTA_BACKEND = 'remote';
    process.env.PRESTON_BRAIN_BRIDGE_URL = 'https://bridge.staging.internal';
    process.env.PRESTON_BRAIN_LETTA_URL = 'https://letta.staging.internal';
    process.env.PRESTON_BRAIN_LETTA_AGENT_ID = 'agent-staging-001';
    process.env.PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED = 'true';
    process.env.SUPABASE_RUNTIME_ENV = 'staging';

    const config = loadLettaBrainConfig();
    expect(config.url).toBe('https://bridge.staging.internal');
    expect(config.url).not.toBe(process.env.PRESTON_BRAIN_LETTA_URL);
  });
});
