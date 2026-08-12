// P2 environment generalization (2026-08-12). ONE source of truth for
// "which environment is THIS deployment", replacing the Phase 7 literal
// 'staging' pins. The invariant everywhere stays EQUALITY with the
// deployment's single pinned environment - never "any environment".
//
// Two strictness levels, both fail-closed in the direction that matters:
//
//   strictRuntimeEnvironment(env)  -> 'staging' | 'production' | null
//     Gates that decide whether anything RUNS (dispatcher, execution
//     capability, real adapter) use this and REFUSE on null. An unset,
//     blank, or mistyped SUPABASE_RUNTIME_ENV can never run anything.
//
//   deploymentEnvironment(env)     -> 'staging' | 'production'
//     Stamping/validation contexts (what environment do new rows carry,
//     which rows does a validator accept) fall back to 'staging' when
//     the env var is unset/invalid. 'staging' is the conservative label:
//     it is simulation-pinned and consumable by nothing in production,
//     and an unset deployment can never mint 'production' rows. This
//     also keeps every pre-P2 test and staging behavior byte-identical.

export const RUNTIME_ENVIRONMENTS = ['staging', 'production'] as const;
export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

type EnvMap = Record<string, string | undefined>;

export function strictRuntimeEnvironment(
  env: EnvMap = process.env as EnvMap,
): RuntimeEnvironment | null {
  const v = env['SUPABASE_RUNTIME_ENV'];
  return v === 'staging' || v === 'production' ? v : null;
}

export function deploymentEnvironment(
  env: EnvMap = process.env as EnvMap,
): RuntimeEnvironment {
  return strictRuntimeEnvironment(env) ?? 'staging';
}

// Known project refs: each deployment must never point at the OTHER
// environment's database (symmetric cross-env URL denylist; adversarial
// review of 89f49a6, findings 1+2). Refs appear in public URLs; not
// secrets. Compare case-insensitively - hostnames are case-insensitive.
export const STAGING_PROJECT_REF = 'vcqtlmlaxxankxyezlul';
export const PRODUCTION_PROJECT_REF = 'hiqsymsiwonmvrbbqhhe';
