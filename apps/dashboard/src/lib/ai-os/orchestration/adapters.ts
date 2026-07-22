// Preston AI OS - Phase 7 agent adapters. PURE interface + SIMULATION adapter.
// An adapter turns an assigned GoalJob into an evidence-bearing result. The
// simulation adapter NEVER spawns a process, opens a socket, sends a message,
// pushes, deploys, or touches an external system - it produces a structured,
// deterministic simulated result with executed:false. Real Claude/Codex
// adapters are declared here as an interface + a capability probe that returns
// 'unavailable' until an owner activation gate proves otherwise (fail-closed).

import type { AgentRole, GoalJob } from './model';
import { AGENT_CONTRACTS } from './agent-contracts';

export type AdapterCapability = 'simulation' | 'real' | 'unavailable';

export interface AdapterResult {
  job_id: string;
  role: AgentRole;
  outcome: 'completed' | 'failed';
  executed: false; // hard-pinned: adapters never execute in this phase
  simulated: true;
  evidence_refs: string[];
  summary: string;
  failure_reason: string | null;
}

export interface AgentAdapter {
  role: AgentRole;
  // What can this adapter actually do right now? Fail-closed to 'unavailable'
  // for real capability until an activation gate proves the CLI/session works.
  detectCapability(): AdapterCapability;
  // Produce a result for a job. Pure/deterministic in simulation.
  runJob(job: GoalJob, now: string): AdapterResult;
}

// The simulation adapter: honors the agent contract, emits deterministic
// evidence, and cannot execute. Used for the whole Phase 7 validation.
export function makeSimulationAdapter(role: AgentRole): AgentAdapter {
  const contract = AGENT_CONTRACTS[role];
  return {
    role,
    detectCapability: () => 'simulation',
    runJob: (job: GoalJob, now: string): AdapterResult => {
      // Contract guard: an adapter never runs a job whose kind exceeds its
      // write scope. Implementation kinds need worktree_only write scope.
      const needsEdit = ['code', 'test', 'migration', 'repair', 'documentation'].includes(job.kind);
      if (needsEdit && contract.write_scope !== 'worktree_only') {
        return {
          job_id: job.id, role, outcome: 'failed', executed: false,
          simulated: true, evidence_refs: [],
          summary: 'simulation refused: role lacks worktree write scope',
          failure_reason: 'write_scope_violation',
        };
      }
      const evId = `ev:${job.correlation_id}:${now}`;
      return {
        job_id: job.id,
        role,
        outcome: 'completed',
        executed: false,
        simulated: true,
        evidence_refs: [evId],
        summary:
          `SIMULATED ${job.kind} "${job.title}" by ${role}: ` +
          `would create an isolated worktree, edit only allowed paths, run ` +
          `tests + scanners, and produce a local commit. No process spawned, ` +
          `nothing sent, nothing deployed.`,
        failure_reason: null,
      };
    },
  };
}

// Real-adapter capability probe. Phase 7 ships this as a fail-closed stub:
// without an owner-run activation gate (proving the agent CLI/session is
// present, authenticated, and sandboxed), real capability is 'unavailable'.
// This function deliberately performs NO detection I/O - it returns the
// documented, gated posture so no code path can silently "go real".
export function probeRealCapability(role: AgentRole): AdapterCapability {
  void role; // detection is gated; no I/O is performed here by design
  return 'unavailable';
}
