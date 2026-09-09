// Knowledge domains + access policy (master build plan 6.2 / 6.6).
//
// There is never one unrestricted global index: every query names a
// domain or a project the requester holds. Restricted domains are denied
// unless the requester scope explicitly grants them. PROJECT_DOCUMENT
// material is only visible inside a matching project scope.

export const KNOWLEDGE_DOMAINS = [
  'ANDERSEN_OFFICIAL',
  'LPC_OFFICIAL',
  'LPC_PRECEDENT',
  'PRESTON_SOP',
  'TEMPLATE_LIBRARY',
  'FIELD_OPERATIONS',
  'PRICING_POLICY',
  'ARCHITECTURE_HISTORY',
  'PROJECT_DOCUMENT',
  'FINANCE_RESTRICTED',
  'HR_RESTRICTED',
  'INSURANCE_RESTRICTED',
] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

export const RESTRICTED_DOMAINS: readonly KnowledgeDomain[] = [
  'FINANCE_RESTRICTED',
  'HR_RESTRICTED',
  'INSURANCE_RESTRICTED',
];

export const PROJECT_SCOPED_DOMAINS: readonly KnowledgeDomain[] = [
  'PROJECT_DOCUMENT',
];

export function isKnowledgeDomain(v: unknown): v is KnowledgeDomain {
  return (
    typeof v === 'string' &&
    (KNOWLEDGE_DOMAINS as readonly string[]).includes(v)
  );
}

export function isRestrictedDomain(domain: string): boolean {
  return (RESTRICTED_DOMAINS as readonly string[]).includes(domain);
}

export function isProjectScopedDomain(domain: string): boolean {
  return (PROJECT_SCOPED_DOMAINS as readonly string[]).includes(domain);
}

// What the requester is allowed to see. Both lists are explicit grants;
// an empty list grants nothing.
export interface RequesterScope {
  projectIds: readonly string[];
  restrictedDomains: readonly string[];
}

export interface AccessRequest {
  domain?: string | null;
  projectId?: string | null;
  requesterScope: RequesterScope;
}

export type AccessReason =
  | 'ok'
  | 'ok_project_scope'
  | 'invalid_requester_scope'
  | 'global_unscoped_query_refused'
  | 'unknown_domain'
  | 'restricted_domain_not_granted'
  | 'project_scope_required'
  | 'project_not_in_requester_scope';

export interface AccessDecision {
  allow: boolean;
  reason: AccessReason;
  // The domains the decision actually covers (a no-domain query inside a
  // project scope covers PROJECT_DOCUMENT only).
  domains: KnowledgeDomain[];
}

function deny(reason: AccessReason): AccessDecision {
  return { allow: false, reason, domains: [] };
}

function validScope(scope: unknown): scope is RequesterScope {
  if (!scope || typeof scope !== 'object') return false;
  const s = scope as Record<string, unknown>;
  const isStrList = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');
  return isStrList(s.projectIds) && isStrList(s.restrictedDomains);
}

export function accessPolicy(req: AccessRequest): AccessDecision {
  if (!req || !validScope(req.requesterScope)) {
    return deny('invalid_requester_scope');
  }
  const scope = req.requesterScope;
  const projectId =
    typeof req.projectId === 'string' && req.projectId !== ''
      ? req.projectId
      : null;
  const domain =
    typeof req.domain === 'string' && req.domain !== '' ? req.domain : null;

  // A project id, when given, must always be one the requester holds.
  if (projectId !== null && !scope.projectIds.includes(projectId)) {
    return deny('project_not_in_requester_scope');
  }

  if (domain === null) {
    // No domain filter: only a project-scoped query is allowed, and it
    // covers that project's PROJECT_DOCUMENT material only.
    if (projectId === null) return deny('global_unscoped_query_refused');
    return {
      allow: true,
      reason: 'ok_project_scope',
      domains: ['PROJECT_DOCUMENT'],
    };
  }

  if (!isKnowledgeDomain(domain)) return deny('unknown_domain');

  if (isRestrictedDomain(domain) && !scope.restrictedDomains.includes(domain)) {
    return deny('restricted_domain_not_granted');
  }

  if (isProjectScopedDomain(domain) && projectId === null) {
    return deny('project_scope_required');
  }

  return { allow: true, reason: 'ok', domains: [domain] };
}
