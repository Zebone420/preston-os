import { createClient } from '@supabase/supabase-js';
import type { RuntimeClient } from '../lib/ai-os/store';

// Preston AI OS - standalone runtime Supabase client (Phase 4B.1).
// Used ONLY by the compiled remote dispatchers (not the Next app). Builds an
// RLS-bound client for the worker/Hermes SERVICE IDENTITY - an owner-allowlisted
// authenticated user, NEVER the service-role key. Fail-closed: throws if config
// is missing. Never logs a secret. Not exercised by unit tests (they inject a
// fake RuntimeClient); this is the deploy-time wiring only.

export const REQUIRED_RUNTIME_ENV = [
  'SUPABASE_URL',
  'SUPABASE_RUNTIME_KEY', // anon/public key
  'SUPABASE_RUNTIME_TOKEN', // owner-allowlisted service-identity access token
] as const;

export function missingRuntimeEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_RUNTIME_ENV.filter((k) => !(env[k] && String(env[k]).trim() !== ''));
}

export function createRuntimeClient(env: Record<string, string | undefined>): RuntimeClient {
  const missing = missingRuntimeEnv(env);
  if (missing.length) {
    throw new Error('missing runtime env: ' + missing.join(', '));
  }
  const client = createClient(
    String(env['SUPABASE_URL']),
    String(env['SUPABASE_RUNTIME_KEY']),
    {
      global: { headers: { Authorization: 'Bearer ' + String(env['SUPABASE_RUNTIME_TOKEN']) } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return client as unknown as RuntimeClient;
}
