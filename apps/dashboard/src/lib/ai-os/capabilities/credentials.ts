// Preston AI OS - provider credential broker FOUNDATION (power-station
// master goal section 14). ARCHITECTURE + INTERFACE ONLY in this goal: no
// provider (Gmail/Calendar/Airtable/Drive) credential exists anywhere, and
// nothing here is reachable from an idle tick or a provider-free job.
//
// V1 model (trusted executor host only):
//
//   root-owned provider env/token FILE (0600, service-user readable path
//   named by env VAR NAME only - values never appear in code, prompts,
//   logs, SSOT text, or evidence)
//     -> broker reads on demand
//     -> access material cached IN-PROCESS with expiry
//     -> handed ONLY to the provider adapter inside the trusted executor
//
// Worker isolation is STRUCTURAL, not procedural: bounded workers receive
// the positive CHILD_ENV_ALLOWLIST (real-claude-adapter.sanitizeChildEnv),
// which cannot name PRESTON_PROVIDER_* variables, and worktrees/prompts/
// artifacts never receive broker output (the executor keeps credentials
// inside the adapter call). A structural test pins the allowlist.
//
// Future migration trigger (documented, deliberately NOT built now): when
// more than one host must mint provider tokens, or when per-capability
// scoping of a shared provider account is needed, move the storage layer to
// Supabase Vault (or an equivalent broker) behind THIS same interface - the
// executor/adapters do not change. Until then a dedicated secrets service
// is over-engineering (master goal final principle).

export const PROVIDER_CREDENTIAL_ENV_PREFIX = 'PRESTON_PROVIDER_';

export interface ProviderCredential {
  provider: string;
  // Opaque access material for the adapter. NEVER logged, NEVER serialized
  // into results/evidence/SSOT rows.
  secret: string;
  expires_at_ms: number | null; // null = static until rotated on disk
}

export type CredentialResolution =
  | { ok: true; credential: ProviderCredential }
  | { ok: false; reason: 'provider_not_configured' | 'credential_file_unreadable' | 'credential_empty' };

export interface CredentialBrokerDeps {
  env: Record<string, string | undefined>;
  // File reader seam (os-runtime binds node:fs; tests bind fakes). Must
  // throw on unreadable paths.
  readFile: (path: string) => string;
  now: () => number;
  // In-process cache TTL for file-sourced material (bounds disk reads, not
  // validity - the file on disk stays the authority between rotations).
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

// e.g. provider 'preston.dryrun' -> PRESTON_PROVIDER_PRESTON_DRYRUN_TOKEN_FILE
export function credentialFileEnvName(provider: string): string {
  return PROVIDER_CREDENTIAL_ENV_PREFIX +
    String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_TOKEN_FILE';
}

export interface CredentialBroker {
  resolve(provider: string): CredentialResolution;
  // Observability WITHOUT values: how many resolutions hit the cache/disk.
  stats(): { resolutions: number; disk_reads: number };
}

export function makeCredentialBroker(deps: CredentialBrokerDeps): CredentialBroker {
  const ttl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = new Map<string, { secret: string; cached_at: number }>();
  let resolutions = 0;
  let diskReads = 0;
  return {
    resolve(provider: string): CredentialResolution {
      resolutions++;
      const path = String(deps.env[credentialFileEnvName(provider)] ?? '').trim();
      if (!path) return { ok: false, reason: 'provider_not_configured' };
      const hit = cache.get(provider);
      if (hit && deps.now() - hit.cached_at < ttl) {
        return {
          ok: true,
          credential: { provider, secret: hit.secret, expires_at_ms: null },
        };
      }
      let raw: string;
      try {
        raw = deps.readFile(path);
      } catch {
        return { ok: false, reason: 'credential_file_unreadable' };
      }
      const secret = String(raw ?? '').trim();
      if (!secret) return { ok: false, reason: 'credential_empty' };
      diskReads++;
      cache.set(provider, { secret, cached_at: deps.now() });
      return { ok: true, credential: { provider, secret, expires_at_ms: null } };
    },
    stats: () => ({ resolutions, disk_reads: diskReads }),
  };
}
