// P1 production gate (2026-08-11): environment allowlist for the
// cookie-less remote surfaces (/api/os/remote/*, /api/os/ssot/status).
// Until P1 these routes were pinned to exactly 'staging'; production was
// enabled by adding it HERE, and only here, at the reviewed P1 code gate.
// Any other value - test_dev, unset, blank, typo - stays fail-closed
// ('unconfigured'), so a missing env var can never open a surface.
export const REMOTE_SURFACE_ENVS = ['staging', 'production'] as const;

export function remoteSurfaceEnvAllowed(value: string | undefined): boolean {
  return (REMOTE_SURFACE_ENVS as readonly string[]).includes(value ?? '');
}
