import { createHash } from 'node:crypto';

import type { ArchitectProposal } from './proposal';

export interface GithubPrPayload {
  base: string;
  body: string;
  head: string;
  title: string;
}

export function buildPrPayload(proposal: ArchitectProposal): GithubPrPayload {
  const evidence = [...proposal.evidence_refs]
    .sort((left, right) => left.localeCompare(right))
    // Bind the exact internal evidence reference without disclosing its
    // locator in the public PR body.
    .map((reference) => `- sha256:${createHash('sha256')
      .update(reference, 'utf8').digest('hex')}`)
    .join('\n');
  return {
    base: proposal.change.base_branch,
    head: proposal.change.head_branch,
    title: proposal.request.objective,
    body: [
      'Preston Architect governed change proposal',
      '',
      `Correlation: ${proposal.request.correlation_id}`,
      `Repository: ${proposal.change.repo}`,
      `Base: ${proposal.change.base_branch}@${proposal.change.base_sha}`,
      `Head: ${proposal.change.head_branch}@${proposal.change.head_sha}`,
      `Diff SHA-256: ${proposal.change.diff_hash}`,
      '',
      'Evidence:',
      evidence,
    ].join('\n'),
  };
}
