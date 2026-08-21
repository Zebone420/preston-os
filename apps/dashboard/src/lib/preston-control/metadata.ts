// Preston Control - OAuth 2.0 Protected Resource Metadata (RFC 9728).
// PURE. Tells the MCP client (ChatGPT) which authorization server protects
// /mcp: the project's Supabase Auth OAuth 2.1 server. No secret involved -
// the Supabase URL is public (it is also NEXT_PUBLIC_).

export const MCP_PATH = '/mcp';
export const PRM_PATH = '/.well-known/oauth-protected-resource';

export function publicOrigin(request: Request, env: Record<string, string | undefined> = process.env): string {
  const override = (env['PRESTON_CONTROL_PUBLIC_ORIGIN'] ?? '').trim();
  if (override) return override.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

export function protectedResourceMetadataUrl(request: Request): string {
  // RFC 9728 path-insert form for a resource with a path component.
  return `${publicOrigin(request)}${PRM_PATH}${MCP_PATH}`;
}

export function authorizationServerIssuer(env: Record<string, string | undefined>): string | null {
  const base = (env['NEXT_PUBLIC_SUPABASE_URL'] ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/auth/v1` : null;
}

export function protectedResourceMetadata(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> | null {
  const issuer = authorizationServerIssuer(env);
  if (!issuer) return null;
  return {
    resource: `${publicOrigin(request, env)}${MCP_PATH}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['email'],
    resource_name: 'Preston Control',
  };
}
