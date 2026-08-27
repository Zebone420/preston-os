// Preston AI OS - fast-track Phase E: explicit provider/model routing table.
// PURE, deterministic, versioned - deliberately NOT an LLM decision. The
// pipeline's existing role assignment (composer -> decomposition ->
// composer-persist) remains the sole authority for WHICH provider role runs a
// job; this table only selects WHICH MODEL that provider's CLI is asked for,
// per job kind, from owner-set environment values.
//
// Fail-closed posture: with no ORCH_MODEL_* env set, every decision is
// { model: null } - the provider CLI runs with its own default, exactly the
// pre-fast-track behavior. A malformed model value is IGNORED (null), never
// passed to a process. The decision (model + reason + version) is recorded in
// the run's result event so routing is auditable per job.

export const ROUTING_VERSION = 1;

// Owner-tunable model env per kind, with a default fallback. Conceptual
// mapping (the owner sets values that exist for their account):
//   documentation/recommendation -> a lower-cost fast capable model
//   code/test/repair/migration   -> the stronger coding model
//   audit                        -> a strong reasoning/review model
export const MODEL_ENV_BY_KIND: Readonly<Record<string, string>> = Object.freeze({
  documentation: 'ORCH_MODEL_DOCUMENTATION',
  recommendation: 'ORCH_MODEL_RECOMMENDATION',
  code: 'ORCH_MODEL_CODE',
  test: 'ORCH_MODEL_TEST',
  repair: 'ORCH_MODEL_REPAIR',
  migration: 'ORCH_MODEL_MIGRATION',
  audit: 'ORCH_MODEL_AUDIT',
});

export const MODEL_ENV_DEFAULT = 'ORCH_MODEL_DEFAULT';

// Conservative model-name shape: letters/digits/dot/dash/underscore/colon.
// Anything else never reaches a process argument.
const MODEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,63}$/;

export interface RoutingDecision {
  model: string | null; // provider CLI --model value; null = CLI default
  reason: string; // static, auditable: which table entry decided
  version: typeof ROUTING_VERSION;
}

export function routeModel(
  kind: string,
  env: Record<string, string | undefined>,
): RoutingDecision {
  const kindEnv = MODEL_ENV_BY_KIND[kind];
  const fromKind = kindEnv ? String(env[kindEnv] ?? '').trim() : '';
  if (fromKind) {
    if (MODEL_NAME_RE.test(fromKind)) {
      return { model: fromKind, reason: `table:v${ROUTING_VERSION}:${kind}`, version: ROUTING_VERSION };
    }
    return { model: null, reason: `invalid_model_ignored:${kind}`, version: ROUTING_VERSION };
  }
  const dflt = String(env[MODEL_ENV_DEFAULT] ?? '').trim();
  if (dflt) {
    if (MODEL_NAME_RE.test(dflt)) {
      return { model: dflt, reason: `table:v${ROUTING_VERSION}:default`, version: ROUTING_VERSION };
    }
    return { model: null, reason: 'invalid_model_ignored:default', version: ROUTING_VERSION };
  }
  return { model: null, reason: `cli_default:v${ROUTING_VERSION}`, version: ROUTING_VERSION };
}
