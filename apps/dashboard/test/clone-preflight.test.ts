// Clone preflight regressions (Gate 2 clone kit). Pins the live clone-proof
// hardening (2026-08-27): an origin project ref anywhere in the environment
// is refused, EXCEPT in ORCH_FOREIGN_PROJECT_REFS (the denylist itself).
import { describe, expect, it } from 'vitest';
// The preflight is a dependency-free ESM script in the repo root scripts dir.
import { preflight, ORIGIN_IDENTIFIERS } from '../../../scripts/clone/preflight.mjs';

const cloneCfg = {
  schema_version: 1,
  instance: { slug: 'northstar-wd', display_name: 'Northstar WD', mode: 'clone' },
  owner: { email: 'owner@northstar-wd.example' },
  environments: {
    staging_project_ref: 'tjndmioqwzdolqjtxjvh',
    production_project_ref: 'orzjfkqgyevxaezldbro',
    foreign_project_refs: ORIGIN_IDENTIFIERS.project_refs,
  },
  deployment: {
    staging_origin: 'https://northstar-clone-proof-20260827.vercel.app',
    production_origin: 'https://northstar-clone-proof-20260827-prod.vercel.app',
  },
  branding: { product_name: 'Northstar Command Center' },
};

const nsEnv: Record<string, string> = {
  SUPABASE_URL: 'https://tjndmioqwzdolqjtxjvh.supabase.co',
  NEXT_PUBLIC_SUPABASE_URL: 'https://tjndmioqwzdolqjtxjvh.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
  SUPABASE_RUNTIME_ENV: 'staging',
  OWNER_EMAIL_ALLOWLIST: 'owner@northstar-wd.example',
  ORCH_STAGING_PROJECT_REF: 'tjndmioqwzdolqjtxjvh',
  ORCH_PRODUCTION_PROJECT_REF: 'orzjfkqgyevxaezldbro',
  ORCH_FOREIGN_PROJECT_REFS: ORIGIN_IDENTIFIERS.project_refs.join(','),
};

describe('clone preflight foreign-ref isolation', () => {
  it('a clean Northstar-only environment passes', () => {
    expect(preflight(cloneCfg, nsEnv).ok).toBe(true);
  });

  it('the denylist naming the origin refs does NOT self-trip', () => {
    // ORCH_FOREIGN_PROJECT_REFS must contain the origin refs by design.
    const r = preflight(cloneCfg, nsEnv);
    expect(r.blocks.some((b: string) => b.includes('ORCH_FOREIGN_PROJECT_REFS'))).toBe(false);
  });

  it('an origin ref in a NON-Supabase env value is refused (whole-env scan)', () => {
    for (const ref of ORIGIN_IDENTIFIERS.project_refs) {
      const r = preflight(cloneCfg, { ...nsEnv, GOOGLE_OAUTH_REDIRECT_URI: `https://${ref}.supabase.co/x` });
      expect(r.ok).toBe(false);
      expect(r.blocks.join(' ')).toContain(ref);
    }
  });

  it('an origin ref in the Supabase URL is refused', () => {
    const r = preflight(cloneCfg, { ...nsEnv, SUPABASE_URL: 'https://hiqsymsiwonmvrbbqhhe.supabase.co' });
    expect(r.ok).toBe(false);
  });

  it('missing required env fails closed', () => {
    expect(preflight(cloneCfg, {}).ok).toBe(false);
  });
});
