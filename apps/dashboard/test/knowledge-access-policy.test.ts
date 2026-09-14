// Knowledge Fabric access policy pins (master build plan 6.6: never one
// unrestricted global index; restricted domains denied; project scoping).

import { describe, expect, it } from 'vitest';
import {
  accessPolicy,
  KNOWLEDGE_DOMAINS,
  PROJECT_SCOPED_DOMAINS,
  RESTRICTED_DOMAINS,
  isKnowledgeDomain,
} from '../src/lib/business/knowledge/domains';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const scope = { projectIds: [P1], restrictedDomains: [] as string[] };

describe('knowledge domains', () => {
  it('lists the twelve plan domains with the three restricted ones', () => {
    expect(KNOWLEDGE_DOMAINS.length).toBe(12);
    expect(RESTRICTED_DOMAINS).toEqual([
      'FINANCE_RESTRICTED', 'HR_RESTRICTED', 'INSURANCE_RESTRICTED',
    ]);
    expect(PROJECT_SCOPED_DOMAINS).toEqual(['PROJECT_DOCUMENT']);
    expect(isKnowledgeDomain('LPC_OFFICIAL')).toBe(true);
    expect(isKnowledgeDomain('GLOBAL')).toBe(false);
  });
});

describe('accessPolicy', () => {
  it('refuses a global query with no domain filter and no project scope', () => {
    const d = accessPolicy({ requesterScope: scope });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('global_unscoped_query_refused');
    expect(d.domains).toEqual([]);
    expect(accessPolicy({ domain: '', projectId: '', requesterScope: scope }).allow)
      .toBe(false);
  });

  it('denies restricted domains unless explicitly granted', () => {
    for (const domain of RESTRICTED_DOMAINS) {
      const denied = accessPolicy({ domain, requesterScope: scope });
      expect(denied.allow).toBe(false);
      expect(denied.reason).toBe('restricted_domain_not_granted');
      const granted = accessPolicy({
        domain,
        requesterScope: { projectIds: [], restrictedDomains: [domain] },
      });
      expect(granted.allow).toBe(true);
      expect(granted.domains).toEqual([domain]);
    }
    // A grant for one restricted domain does not open another.
    const cross = accessPolicy({
      domain: 'HR_RESTRICTED',
      requesterScope: { projectIds: [], restrictedDomains: ['FINANCE_RESTRICTED'] },
    });
    expect(cross.allow).toBe(false);
  });

  it('PROJECT_DOCUMENT requires a project id the requester holds', () => {
    expect(accessPolicy({ domain: 'PROJECT_DOCUMENT', requesterScope: scope }))
      .toMatchObject({ allow: false, reason: 'project_scope_required' });
    expect(accessPolicy({
      domain: 'PROJECT_DOCUMENT', projectId: P2, requesterScope: scope,
    })).toMatchObject({ allow: false, reason: 'project_not_in_requester_scope' });
    expect(accessPolicy({
      domain: 'PROJECT_DOCUMENT', projectId: P1, requesterScope: scope,
    })).toMatchObject({ allow: true, reason: 'ok', domains: ['PROJECT_DOCUMENT'] });
  });

  it('a project-scoped query without a domain covers PROJECT_DOCUMENT only', () => {
    const d = accessPolicy({ projectId: P1, requesterScope: scope });
    expect(d).toEqual({
      allow: true, reason: 'ok_project_scope', domains: ['PROJECT_DOCUMENT'],
    });
    expect(accessPolicy({ projectId: P2, requesterScope: scope }).allow).toBe(false);
  });

  it('allows open domains and denies unknown ones', () => {
    expect(accessPolicy({ domain: 'PRESTON_SOP', requesterScope: scope }).allow)
      .toBe(true);
    expect(accessPolicy({ domain: 'ANDERSEN_OFFICIAL', requesterScope: scope }).allow)
      .toBe(true);
    expect(accessPolicy({ domain: 'EVERYTHING', requesterScope: scope }))
      .toMatchObject({ allow: false, reason: 'unknown_domain' });
    expect(accessPolicy({ domain: 'preston_sop', requesterScope: scope }).allow)
      .toBe(false);
  });

  it('fails closed on a malformed requester scope', () => {
    const bad = { projectIds: 'all', restrictedDomains: [] } as unknown as {
      projectIds: string[]; restrictedDomains: string[];
    };
    expect(accessPolicy({ domain: 'PRESTON_SOP', requesterScope: bad }))
      .toMatchObject({ allow: false, reason: 'invalid_requester_scope' });
    expect(accessPolicy({
      domain: 'PRESTON_SOP',
      requesterScope: undefined as unknown as typeof scope,
    }).allow).toBe(false);
  });
});
