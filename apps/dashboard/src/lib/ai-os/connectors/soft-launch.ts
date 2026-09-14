// Preston AI OS - M9 soft-launch readiness contract.
// Deterministic assessment only: this module cannot deploy, promote, enable a
// capability, mutate production, or waive an owner gate.

import {
  evaluateConnectorPassport,
  type ConnectorPassport,
  type ConnectorRequirement,
} from './passport';

export interface SoftLaunchFacts {
  build_revision: string;
  control: {
    local_foundation_sealed: boolean;
    status_event_truth_proven: boolean;
    kill_stop_unit_proven: boolean;
    backup_restore_procedure_proven: boolean;
  };
  workers: {
    claude_path_built: boolean;
    codex_path_built: boolean;
    concurrency_unit_proven: boolean;
    staging_runtime_proven: boolean;
  };
  validation: Record<string, boolean>;
  safety: {
    live_customer_sends_disabled: boolean;
    financial_execution_disabled: boolean;
    order_placement_disabled: boolean;
    production_untouched: boolean;
  };
  connectors: Array<{
    passport: ConnectorPassport | null | undefined;
    requirement: ConnectorRequirement;
  }>;
  evidence_refs: string[];
  open_critical_defects: string[];
  owner_gates: string[];
}

export interface SoftLaunchAssessment {
  status: 'BLOCKED' | 'REPOSITORY_READY' | 'STAGING_READY_OWNER_GATED';
  repository_ready: boolean;
  staging_ready: boolean;
  production_ready: false;
  blockers: string[];
  owner_gates: string[];
  evidence_refs: string[];
  build_revision: string;
}

export function evaluateSoftLaunch(
  facts: SoftLaunchFacts,
): SoftLaunchAssessment {
  const blockers: string[] = [];
  if (!/^[0-9a-f]{7,64}$/i.test(facts.build_revision)) {
    blockers.push('build_revision_unpinned');
  }
  for (const [name, passed] of Object.entries(facts.control)) {
    if (!passed) blockers.push(`control:${name}`);
  }
  for (const name of [
    'claude_path_built', 'codex_path_built', 'concurrency_unit_proven',
  ] as const) {
    if (!facts.workers[name]) blockers.push(`workers:${name}`);
  }
  for (const [name, passed] of Object.entries(facts.validation).sort()) {
    if (!passed) blockers.push(`validation:${name}`);
  }
  for (const [name, safe] of Object.entries(facts.safety)) {
    if (!safe) blockers.push(`safety:${name}`);
  }
  facts.connectors.forEach((item, index) => {
    const check = evaluateConnectorPassport(item.passport, item.requirement);
    if (!check.ok) blockers.push(`connector:${index}:${check.reason}`);
  });
  for (const defect of facts.open_critical_defects) {
    blockers.push(`critical:${defect}`);
  }
  if (facts.evidence_refs.length === 0 ||
      facts.evidence_refs.some((ref) => !String(ref).trim())) {
    blockers.push('evidence_missing');
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  const repositoryReady = uniqueBlockers.length === 0;
  const stagingReady = repositoryReady && facts.workers.staging_runtime_proven;
  return {
    status: !repositoryReady ? 'BLOCKED'
      : stagingReady ? 'STAGING_READY_OWNER_GATED' : 'REPOSITORY_READY',
    repository_ready: repositoryReady,
    staging_ready: stagingReady,
    // Production promotion is an owner-gated consequential operation and is
    // deliberately outside this assessment's state space.
    production_ready: false,
    blockers: uniqueBlockers,
    owner_gates: [...new Set(facts.owner_gates.map(String).filter(Boolean))],
    evidence_refs: [...new Set(facts.evidence_refs.map(String).filter(Boolean))],
    build_revision: facts.build_revision,
  };
}

export function softLaunchAssessmentRow(
  assessment: SoftLaunchAssessment,
  evaluatedAt: string,
  evaluatedBy: string,
): Record<string, unknown> {
  return {
    build_revision: assessment.build_revision,
    status: assessment.status,
    repository_ready: assessment.repository_ready,
    staging_ready: assessment.staging_ready,
    production_ready: false,
    blockers: assessment.blockers,
    owner_gates: assessment.owner_gates,
    evidence_refs: assessment.evidence_refs,
    evaluated_at: evaluatedAt,
    evaluated_by: evaluatedBy,
  };
}
