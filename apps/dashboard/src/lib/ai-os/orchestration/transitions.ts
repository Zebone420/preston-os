// Preston AI OS - Phase 7 status transition guards. PURE. The authoritative
// allowed-transition graphs for goals and jobs. Any transition not listed is
// rejected (fail-closed). Terminal states have no outgoing edges. Used by the
// durable store (CAS) and the driver so persisted and in-memory transitions
// agree on the same legal graph.

import type { GoalJobStatus, GoalStatus } from './model';

const GOAL_EDGES: Record<GoalStatus, readonly GoalStatus[]> = {
  proposed: ['decomposed', 'cancelled'],
  decomposed: ['running', 'blocked', 'cancelled'],
  running: ['blocked', 'completed', 'failed', 'cancelled', 'dead_lettered'],
  blocked: ['running', 'cancelled', 'dead_lettered', 'completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  dead_lettered: [],
};

const JOB_EDGES: Record<GoalJobStatus, readonly GoalJobStatus[]> = {
  pending: ['ready', 'assigned', 'awaiting_approval', 'cancelled'],
  ready: ['assigned', 'in_progress', 'awaiting_approval', 'cancelled'],
  assigned: ['in_progress', 'ready', 'cancelled'],
  in_progress: ['awaiting_review', 'completed', 'failed', 'cancelled'],
  awaiting_review: ['completed', 'failed', 'cancelled'],
  awaiting_approval: ['ready', 'cancelled', 'dead_lettered', 'failed'],
  failed: ['ready', 'dead_lettered', 'cancelled'], // retry -> ready
  completed: [],
  cancelled: [],
  dead_lettered: [],
};

export function canTransitionGoal(from: string, to: string): boolean {
  const edges = GOAL_EDGES[from as GoalStatus];
  return Array.isArray(edges) && edges.includes(to as GoalStatus);
}

export function canTransitionJob(from: string, to: string): boolean {
  const edges = JOB_EDGES[from as GoalJobStatus];
  return Array.isArray(edges) && edges.includes(to as GoalJobStatus);
}

export function isTerminalGoal(s: string): boolean {
  return ['completed', 'failed', 'cancelled', 'dead_lettered'].includes(s);
}
export function isTerminalJob(s: string): boolean {
  return ['completed', 'cancelled', 'dead_lettered'].includes(s);
}
