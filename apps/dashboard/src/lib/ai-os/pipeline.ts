import {
  PIPELINE_STAGES,
  type ExecutionRecord,
  type ExecutionState,
  type PipelineStage,
} from './types';

// Preston AI OS - execution pipeline state machine (Phase 2 foundation).
// PURE and FAIL-CLOSED. Every action must flow through PIPELINE_STAGES in
// order; this module decides the single next legal step and refuses to enter
// execution unless every gate passes. It executes NOTHING - it only computes
// whether an advance is permitted. Real adapters remain disabled elsewhere.

export interface AdvanceContext {
  now: string; // ISO timestamp (injected; no ambient clock)
  // Global execution kill. Unless BOTH this and rec.execution_enabled are
  // true, the pipeline can never enter execution_attempt. Default posture is
  // false (fail-closed) - callers must opt in explicitly.
  executionEnabled: boolean;
}

export interface AdvanceResult {
  ok: boolean;
  stage: PipelineStage; // resulting stage (unchanged when blocked)
  state: ExecutionState;
  reason?: string; // why an advance was refused
}

export function stageIndex(stage: PipelineStage): number {
  return (PIPELINE_STAGES as readonly string[]).indexOf(stage);
}

export function isTerminalStage(stage: PipelineStage): boolean {
  return stage === 'audit';
}

// Advance by exactly one stage, or block. Gates (fail-closed):
//  1. approval required from execution_intent onward;
//  2. RED/BLACK risk never reaches execution_attempt;
//  3. execution_attempt requires execution globally + per-record enabled;
//  4. execution_attempt requires a worker lease.
export function advance(
  rec: ExecutionRecord,
  ctx: AdvanceContext,
): AdvanceResult {
  const i = stageIndex(rec.stage);
  if (i < 0) {
    return { ok: false, stage: rec.stage, state: 'failed', reason: 'unknown stage' };
  }
  if (isTerminalStage(rec.stage)) {
    return { ok: false, stage: rec.stage, state: rec.state, reason: 'already terminal' };
  }
  const next = PIPELINE_STAGES[i + 1];

  // Gate 1: approval must be present before crossing into execution_intent.
  if (i + 1 >= stageIndex('execution_intent') && !rec.approved) {
    return { ok: false, stage: rec.stage, state: 'blocked', reason: 'not approved' };
  }
  // Gate 2: RED/BLACK never execute.
  if (
    next === 'execution_attempt' &&
    (rec.risk_class === 'RED' || rec.risk_class === 'BLACK')
  ) {
    return {
      ok: false,
      stage: rec.stage,
      state: 'blocked',
      reason: 'risk class ' + rec.risk_class + ' never executes',
    };
  }
  // Gate 3: execution must be globally AND per-record enabled to attempt.
  if (next === 'execution_attempt' && !(ctx.executionEnabled && rec.execution_enabled)) {
    return {
      ok: false,
      stage: rec.stage,
      state: 'blocked',
      reason: 'execution disabled (fail-closed)',
    };
  }
  // Gate 4: a worker lease is required to attempt execution.
  if (next === 'execution_attempt' && !rec.worker_lease) {
    return { ok: false, stage: rec.stage, state: 'blocked', reason: 'no worker lease' };
  }

  return {
    ok: true,
    stage: next,
    state: isTerminalStage(next) ? 'done' : 'advancing',
  };
}
