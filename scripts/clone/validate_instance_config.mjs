#!/usr/bin/env node
// Instance configuration validator (Gate 2). Pure, dependency-free,
// read-only. Validates the schema of an instance.config JSON and returns
// exit 0 (valid) / 1 (invalid, every error listed). Never prints values
// of anything that could be a secret - the config file is non-secret by
// contract, but errors echo FIELD NAMES only.
import { readFileSync } from 'node:fs';

const REF_RE = /^[a-z0-9]{16,24}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+$/i;

export function validateInstanceConfig(cfg) {
  const errors = [];
  const need = (cond, field, why) => { if (!cond) errors.push(`${field}: ${why}`); };
  const o = cfg ?? {};

  need(o.schema_version === 1, 'schema_version', 'must be 1');

  const inst = o.instance ?? {};
  need(SLUG_RE.test(String(inst.slug ?? '')), 'instance.slug',
    'must match ^[a-z0-9][a-z0-9-]{1,40}$');
  need(typeof inst.display_name === 'string' && inst.display_name.trim().length >= 2,
    'instance.display_name', 'required');
  need(inst.mode === 'origin' || inst.mode === 'clone', 'instance.mode',
    "must be 'origin' or 'clone'");

  const owner = o.owner ?? {};
  need(EMAIL_RE.test(String(owner.email ?? '')), 'owner.email', 'must be an email');

  const envs = o.environments ?? {};
  need(REF_RE.test(String(envs.staging_project_ref ?? '')),
    'environments.staging_project_ref', 'must be a project ref (16-24 [a-z0-9])');
  need(REF_RE.test(String(envs.production_project_ref ?? '')),
    'environments.production_project_ref', 'must be a project ref');
  need(String(envs.staging_project_ref) !== String(envs.production_project_ref),
    'environments', 'staging and production refs must differ');
  const foreign = Array.isArray(envs.foreign_project_refs) ? envs.foreign_project_refs : null;
  need(foreign !== null, 'environments.foreign_project_refs', 'must be an array');
  if (foreign) {
    for (const f of foreign) {
      need(REF_RE.test(String(f)), 'environments.foreign_project_refs',
        'every entry must be a project ref');
    }
    need(!foreign.includes(String(envs.staging_project_ref)) &&
      !foreign.includes(String(envs.production_project_ref)),
      'environments.foreign_project_refs',
      "must not contain this instance's own refs");
    if (inst.mode === 'clone') {
      need(foreign.length >= 1, 'environments.foreign_project_refs',
        'a clone must list every origin-instance ref it may never touch');
    }
  }

  const dep = o.deployment ?? {};
  need(ORIGIN_RE.test(String(dep.staging_origin ?? '')),
    'deployment.staging_origin', 'must be an https origin');
  need(ORIGIN_RE.test(String(dep.production_origin ?? '')),
    'deployment.production_origin', 'must be an https origin');
  need(String(dep.staging_origin) !== String(dep.production_origin),
    'deployment', 'staging and production origins must differ');

  const brand = o.branding ?? {};
  need(typeof brand.product_name === 'string' && brand.product_name.trim().length >= 2,
    'branding.product_name', 'required');

  return { ok: errors.length === 0, errors };
}

export function loadInstanceConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, errors: [`config file not readable: ${path}`], config: null };
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['config file is not valid JSON'], config: null };
  }
  const v = validateInstanceConfig(cfg);
  return { ok: v.ok, errors: v.errors, config: v.ok ? cfg : null };
}

// CLI: node validate_instance_config.mjs <path>
if (process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node validate_instance_config.mjs <instance.config.json>');
    process.exit(1);
  }
  const r = loadInstanceConfig(path);
  if (!r.ok) {
    console.error('INVALID instance config:');
    for (const e of r.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('instance config VALID');
  process.exit(0);
}
