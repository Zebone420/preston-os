// Preston AI OS - Phase 7 goal decomposition. PURE, deterministic.
// Turns a master goal + a caller-supplied ordered task spec into a
// dependency-ordered set of GoalJobs with capability-based role assignment.
// Fail-closed: cycles, over-budget size, or invalid specs are rejected; NO
// job is produced from an invalid decomposition. Deterministic: identical
// input (including injected ids) yields identical output.

import { classifyJob } from './policy';
import {
  AGENT_CONTRACTS,
} from './agent-contracts';
import type {
  AgentRole,
  GoalJob,
  JobKind,
  MasterGoal,
} from './model';
import { JOB_KINDS, validateMasterGoal } from './model';

export interface TaskSpec {
  local_id: string; // caller-stable id unique within the goal
  kind: JobKind;
  title: string;
  objective: string;
  depends_on_local: string[]; // local_ids of prerequisite tasks
}

export type DecomposeResult =
  | { ok: true; jobs: GoalJob[] }
  | { ok: false; errors: string[] };

// Capability-based assignment. Implementation kinds go to an implementer
// (claude); review/audit kinds go to the audit role or codex reviewer.
// Fixed, contract-checked - no agent is assigned a job its contract forbids.
function assignRole(kind: JobKind): AgentRole {
  switch (kind) {
    case 'audit':
      return 'audit';
    case 'documentation':
    case 'code':
    case 'test':
    case 'migration':
    case 'repair':
    case 'recommendation':
      return 'claude';
    default:
      return 'claude';
  }
}

// Topological sort with cycle detection over local ids. Returns ordered local
// ids or null if a cycle exists.
function topoOrder(specs: TaskSpec[]): string[] | null {
  const ids = new Set(specs.map((s) => s.local_id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of specs) {
    indeg.set(s.local_id, 0);
    adj.set(s.local_id, []);
  }
  for (const s of specs) {
    for (const dep of s.depends_on_local) {
      if (!ids.has(dep)) return null; // dangling dependency => reject
      adj.get(dep)!.push(s.local_id);
      indeg.set(s.local_id, (indeg.get(s.local_id) ?? 0) + 1);
    }
  }
  // Deterministic Kahn: process ready nodes in stable spec order.
  const order: string[] = [];
  const specOrder = specs.map((s) => s.local_id);
  const ready = () => specOrder.filter((id) => indeg.get(id) === 0 && !order.includes(id));
  let frontier = ready();
  while (frontier.length > 0) {
    const id = frontier[0];
    order.push(id);
    for (const nxt of adj.get(id)!) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
    }
    frontier = ready();
  }
  return order.length === specs.length ? order : null; // incomplete => cycle
}

export function decomposeGoal(
  goal: MasterGoal,
  specs: TaskSpec[],
  ids: (localId: string) => string, // deterministic id minter per local id
  now: string,
): DecomposeResult {
  const errors = validateMasterGoal(goal);
  if (!Array.isArray(specs) || specs.length === 0) errors.push('no_tasks');
  if (specs.length > goal.budget.max_jobs) errors.push('exceeds_max_jobs');

  const seen = new Set<string>();
  for (const s of specs) {
    if (!s.local_id || seen.has(s.local_id)) errors.push('duplicate_local_id');
    seen.add(s.local_id);
    if (!JOB_KINDS.includes(s.kind)) errors.push(`kind_invalid:${s.local_id}`);
    if (!s.title?.trim()) errors.push(`title_required:${s.local_id}`);
  }
  if (errors.length) return { ok: false, errors };

  const order = topoOrder(specs);
  if (!order) return { ok: false, errors: ['dependency_cycle_or_dangling'] };

  const byLocal = new Map(specs.map((s) => [s.local_id, s]));
  const jobIdByLocal = new Map<string, string>();
  for (const localId of order) jobIdByLocal.set(localId, ids(localId));

  const jobs: GoalJob[] = order.map((localId) => {
    const s = byLocal.get(localId)!;
    const role = assignRole(s.kind);
    // Bounded worktree simulation job: GREEN unless the objective names a
    // gated (RED/mobile) action, in which case it requires owner approval.
    const policy = classifyJob(s.kind, s.objective || s.title);
    const risk_class = policy.risk_class;
    return {
      id: jobIdByLocal.get(localId)!,
      goal_id: goal.id,
      kind: s.kind,
      title: s.title,
      objective: s.objective ?? '',
      risk_class,
      assigned_role: role,
      depends_on: s.depends_on_local.map((d) => jobIdByLocal.get(d)!),
      status: 'pending',
      attempts: 0,
      requires_approval: policy.requires_approval,
      approval_id: null,
      runtime_job_id: null,
      correlation_id: `${goal.correlation_id}:${localId}`,
      evidence_refs: [],
      failure_reason: null,
      created_at: now,
      updated_at: now,
    };
  });

  // Defense in depth: a job may never be assigned to a role whose contract
  // lacks edit capability for an implementation kind.
  for (const j of jobs) {
    const c = AGENT_CONTRACTS[j.assigned_role!];
    const needsEdit = ['code', 'test', 'migration', 'repair', 'documentation'].includes(j.kind);
    if (needsEdit && !c.capabilities.includes('edit_repo')) {
      return { ok: false, errors: [`assignment_capability_violation:${j.id}`] };
    }
  }

  return { ok: true, jobs };
}
