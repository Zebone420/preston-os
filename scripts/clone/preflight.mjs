#!/usr/bin/env node
// Clone preflight (Gate 2). Read-only, idempotent, fail-closed. Detects
// origin-instance (Preston) values, reused identifiers, and forbidden
// production targets BEFORE any bootstrap step touches anything.
//
// Checks (clone mode):
//   1. No origin identifier anywhere in the instance config: project refs,
//      origin domains, origin owner domain, origin branding.
//   2. foreign_project_refs contains EVERY known origin ref.
//   3. Environment values (if present) never reference an origin ref or
//      origin deployment alias, and SUPABASE_URL matches the declared
//      instance refs.
//   4. Required environment NAMES for the requested phase are present -
//      missing requirements fail with an actionable message.
// Origin mode runs the same shape checks minus the origin-value denial.
//
// Exit 0 = preflight clean; exit 1 = blocked (every reason listed).
import { loadInstanceConfig } from './validate_instance_config.mjs';

// The origin instance's non-secret identifiers. Extend when a new origin
// lineage exists. These are PUBLIC identifiers (URL components), never
// secrets - listing them here is what makes reuse mechanically detectable.
export const ORIGIN_IDENTIFIERS = {
  project_refs: ['vcqtlmlaxxankxyezlul', 'hiqsymsiwonmvrbbqhhe'],
  domains: [
    'preston-os-staging.vercel.app',
    'preston-os-prod.vercel.app',
    'preston.nyc',
    'prestonwd.com',
  ],
  branding: ['preston'],
};

const REQUIRED_ENV_NAMES = [
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_RUNTIME_ENV', 'OWNER_EMAIL_ALLOWLIST',
  'ORCH_STAGING_PROJECT_REF', 'ORCH_PRODUCTION_PROJECT_REF',
  'ORCH_FOREIGN_PROJECT_REFS',
];

function lc(v) { return String(v ?? '').toLowerCase(); }

export function preflight(cfg, env) {
  const blocks = [];
  const block = (msg) => blocks.push(msg);
  const isClone = cfg.instance.mode === 'clone';

  const cfgText = lc(JSON.stringify({
    instance: cfg.instance, owner: cfg.owner, deployment: cfg.deployment,
    branding: cfg.branding,
  }));

  if (isClone) {
    for (const ref of ORIGIN_IDENTIFIERS.project_refs) {
      if (cfgText.includes(ref)) {
        block(`origin project ref '${ref}' appears in the instance config - a clone must use its OWN projects`);
      }
      if (!cfg.environments.foreign_project_refs.map(lc).includes(ref)) {
        block(`foreign_project_refs must include origin ref '${ref}' so the runtime refuses it`);
      }
    }
    for (const d of ORIGIN_IDENTIFIERS.domains) {
      if (cfgText.includes(lc(d))) {
        block(`origin domain '${d}' appears in the instance config - a clone must use its own domains and identities`);
      }
    }
    for (const b of ORIGIN_IDENTIFIERS.branding) {
      if (lc(cfg.instance.display_name).includes(b) ||
          lc(cfg.branding.product_name).includes(b) ||
          lc(cfg.instance.slug).includes(b)) {
        block(`origin branding '${b}' appears in the clone identity - configure the new business's own branding`);
      }
    }
  }

  // Environment surface (only the values that exist; names are the contract).
  const missing = REQUIRED_ENV_NAMES.filter((n) => !String(env[n] ?? '').trim());
  for (const m of missing) {
    block(`required environment value missing: ${m} (set it per clone/env.instance.template)`);
  }

  const url = lc(env['SUPABASE_URL']);
  const pubUrl = lc(env['NEXT_PUBLIC_SUPABASE_URL']);
  if (isClone) {
    // An origin project ref must not appear in ANY environment value, not
    // only the two Supabase URL vars - a ref embedded in an OAuth redirect
    // URI, callback, or any other URL-bearing value is refused too (live
    // clone-proof hardening 2026-08-27: the runtime ORCH_FOREIGN_PROJECT_REFS
    // gate blocks this at execution time, and the preflight now catches it
    // pre-deploy across the whole env surface).
    for (const ref of ORIGIN_IDENTIFIERS.project_refs) {
      for (const [name, v] of Object.entries(env)) {
        // ORCH_FOREIGN_PROJECT_REFS is the denylist itself: it is REQUIRED
        // to name the origin refs so the runtime refuses them. Every other
        // env value naming an origin ref is a misconfiguration.
        if (name === 'ORCH_FOREIGN_PROJECT_REFS') continue;
        if (lc(v).includes(ref)) {
          block(`${name} contains an ORIGIN project ref ('${ref}') - refused`);
        }
      }
    }
    for (const d of ORIGIN_IDENTIFIERS.domains) {
      const dd = lc(d);
      for (const name of ['PRESTON_CONTROL_PUBLIC_ORIGIN', 'GOOGLE_OAUTH_REDIRECT_URI', 'PRESTON_CONTROL_GPT_CALLBACK_URL']) {
        if (lc(env[name]).includes(dd)) block(`${name} references origin domain '${d}' - refused`);
      }
      if (lc(env['OWNER_EMAIL_ALLOWLIST']).includes(dd)) {
        block(`OWNER_EMAIL_ALLOWLIST references origin domain '${d}' - a clone needs its own owner identities`);
      }
    }
  }

  // The declared refs and the actual URL must agree (both modes).
  const stagingRef = lc(cfg.environments.staging_project_ref);
  const prodRef = lc(cfg.environments.production_project_ref);
  const envStagRef = lc(env['ORCH_STAGING_PROJECT_REF']);
  const envProdRef = lc(env['ORCH_PRODUCTION_PROJECT_REF']);
  if (envStagRef && envStagRef !== stagingRef) {
    block('ORCH_STAGING_PROJECT_REF does not match environments.staging_project_ref');
  }
  if (envProdRef && envProdRef !== prodRef) {
    block('ORCH_PRODUCTION_PROJECT_REF does not match environments.production_project_ref');
  }
  const runtimeEnv = String(env['SUPABASE_RUNTIME_ENV'] ?? '');
  if (url) {
    if (runtimeEnv === 'staging' && !url.includes(stagingRef)) {
      block('SUPABASE_URL does not contain the declared staging project ref');
    }
    if (runtimeEnv === 'production' && !url.includes(prodRef)) {
      block('SUPABASE_URL does not contain the declared production project ref');
    }
  }

  return { ok: blocks.length === 0, blocks };
}

// CLI: node preflight.mjs <instance.config.json>   (env from process.env)
if (process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node preflight.mjs <instance.config.json>');
    process.exit(1);
  }
  const loaded = loadInstanceConfig(path);
  if (!loaded.ok) {
    console.error('preflight BLOCKED: invalid instance config:');
    for (const e of loaded.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const r = preflight(loaded.config, process.env);
  if (!r.ok) {
    console.error('preflight BLOCKED:');
    for (const b of r.blocks) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log('preflight CLEAN: no origin-instance values, no reused identifiers, required environment present');
  process.exit(0);
}
