// Architect Gate AG-7: pure, exact-head validation evidence checklist.

import type { RiskClass } from '../types';
import type { ArchitectProposal } from './proposal';

export type ArchitectEvidenceKind =
  | 'tests_ref'
  | 'typecheck_ref'
  | 'secret_scan_ref'
  | 'red_boundary_scan_ref'
  | 'lint_ref'
  | 'policy_ref'
  | 'rollback_ref'
  | 'owner_justification_ref';

const BASE: readonly ArchitectEvidenceKind[] = [
  'tests_ref', 'typecheck_ref', 'secret_scan_ref', 'red_boundary_scan_ref',
];

export const EVIDENCE_REQUIREMENTS: Readonly<Record<
  RiskClass, readonly ArchitectEvidenceKind[]
>> = Object.freeze({
  GREEN: BASE,
  YELLOW: [...BASE, 'lint_ref'],
  RED: [...BASE, 'lint_ref', 'policy_ref', 'rollback_ref'],
  BLACK: [...BASE, 'lint_ref', 'policy_ref', 'rollback_ref', 'owner_justification_ref'],
});

export interface ArchitectEvidenceRef {
  kind: ArchitectEvidenceKind;
  head_sha: string;
  locator: string;
}

export function formatEvidenceRef(ref: ArchitectEvidenceRef): string {
  return `${ref.kind}:${ref.head_sha}:${ref.locator}`;
}

export function parseEvidenceRef(raw: unknown): ArchitectEvidenceRef | null {
  if (typeof raw !== 'string') return null;
  const first = raw.indexOf(':');
  const second = raw.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1 || second === raw.length - 1) return null;
  const kind = raw.slice(0, first) as ArchitectEvidenceKind;
  const head_sha = raw.slice(first + 1, second);
  const locator = raw.slice(second + 1);
  if (!Object.values(EVIDENCE_REQUIREMENTS).some((items) => items.includes(kind)) ||
      !/^[0-9a-f]{40}$/.test(head_sha) || locator.trim().length === 0) {
    return null;
  }
  return { kind, head_sha, locator };
}

export interface EvidenceCheck {
  complete: boolean;
  missing: ArchitectEvidenceKind[];
}

export function hasRequiredEvidence(
  proposal: Pick<ArchitectProposal, 'change' | 'evidence_refs' | 'risk_class'>,
): EvidenceCheck {
  const present = new Set(
    proposal.evidence_refs
      .map(parseEvidenceRef)
      .filter((ref): ref is ArchitectEvidenceRef =>
        ref !== null && ref.head_sha === proposal.change.head_sha)
      .map((ref) => ref.kind),
  );
  const missing = EVIDENCE_REQUIREMENTS[proposal.risk_class]
    .filter((kind) => !present.has(kind));
  return { complete: missing.length === 0, missing };
}
