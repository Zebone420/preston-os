// Preston Super Brain v1 - Dashboard-side Brain Bridge configuration.
// Only env var NAMES here. Never values.
// The dashboard points at the isolated Brain Bridge, never directly at Letta.

export interface LettaBrainConfig {
  enabled: boolean;
  backend: string;
  url: string;
  agentId: string;
  isolationAttested: boolean;
  runtimeEnv: string;
}

export function loadLettaBrainConfig(): LettaBrainConfig {
  return {
    enabled: process.env.PRESTON_BRAIN_ENABLED === 'true',
    backend: process.env.PRESTON_BRAIN_LETTA_BACKEND ?? '',
    url: process.env.PRESTON_BRAIN_BRIDGE_URL ?? '',
    agentId: process.env.PRESTON_BRAIN_LETTA_AGENT_ID ?? '',
    isolationAttested: process.env.PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED === 'true',
    runtimeEnv: process.env.SUPABASE_RUNTIME_ENV ?? '',
  };
}

export type LettaConfigError =
  | 'brain_disabled'
  | 'backend_not_remote'
  | 'backend_local_refused'
  | 'backend_cloud_refused'
  | 'backend_cloud_oauth_refused'
  | 'missing_url'
  | 'missing_agent_id'
  | 'isolation_not_attested'
  | 'production_refused'
  | 'runtime_env_not_staging';

export interface LettaConfigValidation {
  valid: boolean;
  errors: LettaConfigError[];
}

export function validateLettaBrainConfig(config: LettaBrainConfig): LettaConfigValidation {
  const errors: LettaConfigError[] = [];

  if (!config.enabled) errors.push('brain_disabled');
  if (config.backend === 'local') errors.push('backend_local_refused');
  if (config.backend === 'cloud') errors.push('backend_cloud_refused');
  if (config.backend === 'cloud-oauth') errors.push('backend_cloud_oauth_refused');
  if (config.backend !== 'remote') errors.push('backend_not_remote');
  if (!config.url) errors.push('missing_url');
  if (!config.agentId) errors.push('missing_agent_id');
  if (!config.isolationAttested) errors.push('isolation_not_attested');
  if (config.runtimeEnv === 'production') errors.push('production_refused');
  if (config.runtimeEnv !== 'staging') errors.push('runtime_env_not_staging');

  return { valid: errors.length === 0, errors };
}
