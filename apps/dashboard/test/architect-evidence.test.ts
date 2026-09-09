import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_REQUIREMENTS,
  formatEvidenceRef,
  hasRequiredEvidence,
  parseEvidenceRef,
  type ArchitectEvidenceKind,
} from '../src/lib/ai-os/architect/evidence';
import type { RiskClass } from '../src/lib/ai-os/types';

const HEAD = '2'.repeat(40);
const OTHER = '3'.repeat(40);

function refs(risk: RiskClass, head = HEAD): string[] {
  return EVIDENCE_REQUIREMENTS[risk].map((kind) =>
    formatEvidenceRef({ kind, head_sha: head, locator: `artifact/${kind}.json` }));
}

function check(risk: RiskClass, evidence_refs: string[]) {
  return hasRequiredEvidence({
    change: {
      repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
      head_branch: 'architect/corr-architect-0007', base_sha: '1'.repeat(40),
      head_sha: HEAD, diff_hash: '4'.repeat(64),
    },
    risk_class: risk, evidence_refs,
  });
}

describe('AG-7 required evidence', () => {
  it('accepts a complete checklist for every risk class', () => {
    for (const risk of ['GREEN', 'YELLOW', 'RED', 'BLACK'] as const) {
      expect(check(risk, refs(risk)), risk).toEqual({ complete: true, missing: [] });
    }
  });

  it('rejects each required RED evidence class individually', () => {
    for (const missing of EVIDENCE_REQUIREMENTS.RED) {
      const evidence = refs('RED').filter((raw) => !raw.startsWith(`${missing}:`));
      expect(check('RED', evidence), missing).toEqual({
        complete: false, missing: [missing],
      });
    }
  });

  it('does not count evidence from another head SHA', () => {
    for (const kind of EVIDENCE_REQUIREMENTS.RED) {
      const evidence = refs('RED').map((raw) => raw.startsWith(`${kind}:`)
        ? formatEvidenceRef({ kind, head_sha: OTHER, locator: 'old/result.json' })
        : raw);
      expect(check('RED', evidence).missing).toContain(kind);
    }
  });

  it('parses only structured, known, exact-SHA references', () => {
    const good = formatEvidenceRef({
      kind: 'tests_ref', head_sha: HEAD, locator: 'reports/tests.json',
    });
    expect(parseEvidenceRef(good)).toEqual({
      kind: 'tests_ref', head_sha: HEAD, locator: 'reports/tests.json',
    });
    for (const raw of [null, '', 'tests_ref:short:x', `unknown:${HEAD}:x`,
      `tests_ref:${HEAD}:`]) {
      expect(parseEvidenceRef(raw)).toBeNull();
    }
  });

  it('requirements always include the four contract minimums', () => {
    const minimum: ArchitectEvidenceKind[] = [
      'tests_ref', 'typecheck_ref', 'secret_scan_ref', 'red_boundary_scan_ref',
    ];
    for (const kinds of Object.values(EVIDENCE_REQUIREMENTS)) {
      expect(kinds).toEqual(expect.arrayContaining(minimum));
    }
  });
});
