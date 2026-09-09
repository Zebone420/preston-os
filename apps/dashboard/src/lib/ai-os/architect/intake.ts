// Preston AI OS - Architect Gate AG-1: request intake contract. PURE (no
// I/O, no clock). The single validated shape of a request to start
// Architect reasoning about a repository change. Nothing downstream
// (AG-2..AG-10) may accept an ArchitectRequest that has not passed
// validateArchitectRequest - fail-closed on any missing/invalid field.

import { RUNTIME_ID_RE } from '../commands';
import {
  deploymentEnvironment, type RuntimeEnvironment,
} from '../runtime-environment';

export interface ArchitectRequest {
  repo: string; // raw repository identity as supplied by the caller; AG-2 canonicalizes and authorizes it
  base_branch: string;
  objective: string;
  correlation_id: string;
  requested_by: string; // owner identity, same convention as MasterGoal.requested_by
  source_goal_job_id: string; // the goal-job this Architect request was raised for
  environment: RuntimeEnvironment;
}

export type ArchitectRequestError =
  | 'repo_required'
  | 'base_branch_required'
  | 'objective_required'
  | 'correlation_id_invalid'
  | 'requested_by_required'
  | 'source_goal_job_id_invalid'
  | 'environment_mismatch';

function id(v: unknown): boolean {
  return typeof v === 'string' && RUNTIME_ID_RE.test(v);
}

function text(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// P2: environment is checked against THIS deployment's pinned environment,
// never "any" - same invariant as validateMasterGoal.
export function validateArchitectRequest(
  r: ArchitectRequest,
  expectedEnvironment: RuntimeEnvironment = deploymentEnvironment(),
): ArchitectRequestError[] {
  const errs: ArchitectRequestError[] = [];
  if (!text(r.repo)) errs.push('repo_required');
  if (!text(r.base_branch)) errs.push('base_branch_required');
  if (!text(r.objective)) errs.push('objective_required');
  if (!id(r.correlation_id)) errs.push('correlation_id_invalid');
  if (!text(r.requested_by)) errs.push('requested_by_required');
  if (!id(r.source_goal_job_id)) errs.push('source_goal_job_id_invalid');
  if (r.environment !== expectedEnvironment) errs.push('environment_mismatch');
  return errs;
}
