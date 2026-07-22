// Preston AI OS - Phase 7 agent registry contracts. PURE, default-deny.
// Each agent has a STANDALONE contract: no agent inherits authority from
// another. A capability is denied unless it appears in `capabilities` AND is
// not in `prohibitions` AND the requested risk is within `max_risk`.

import type { RiskClass } from '../types';
import type { AgentRole } from './model';

export type Capability =
  | 'read_repo'
  | 'edit_repo' // edit files inside an isolated worktree only
  | 'run_tests'
  | 'run_scanners'
  | 'local_commit'
  | 'create_worktree'
  | 'audit'
  | 'coordinate' // monitor/reconcile/escalate (no approve, no execute)
  | 'propose_command' // raise a proposal (never execute it)
  | 'intake_goal' // submit a master goal
  | 'produce_recommendation';

// Actions no agent may ever do without a fresh owner mobile approval, and that
// no agent contract may list as an owned capability. Enforced structurally.
export const UNIVERSAL_PROHIBITIONS: readonly string[] = [
  'push',
  'deploy',
  'production_access',
  'credential_access',
  'service_role_use',
  'live_send',
  'external_business_write',
  'enable_execution',
  'enable_remote_runner',
  'change_hermes_mode',
  'self_approve',
  'weaken_rls',
  'weaken_scanner',
] as const;

const RISK_ORDER: Record<RiskClass, number> = {
  GREEN: 0, YELLOW: 1, RED: 2, BLACK: 3,
};

export interface AgentContract {
  role: AgentRole;
  version: string;
  capabilities: readonly Capability[];
  prohibitions: readonly string[]; // extra, beyond the universal set
  max_risk: RiskClass; // highest risk this agent may even PROPOSE
  environment_scope: 'staging'; // Phase 7 hard-pin
  write_scope: 'worktree_only' | 'none';
  network_scope: 'none'; // no agent gets network in Phase 7
  can_approve: false; // hard-pinned false for every agent
  max_concurrent_jobs: number;
  timeout_ms: number;
  max_retries: number;
}

const RO = <T,>(a: T[]): readonly T[] => Object.freeze([...a]);

// Default-deny registry. ChatGPT proposes/intakes but never edits. Hermes
// coordinates but never edits or approves. Claude/Codex implement in a
// worktree. Audit reads + audits only. No `can_approve` anywhere.
export const AGENT_CONTRACTS: Readonly<Record<AgentRole, AgentContract>> =
  Object.freeze({
    chatgpt: {
      role: 'chatgpt', version: '1.0.0',
      capabilities: RO<Capability>(['intake_goal', 'propose_command', 'read_repo']),
      prohibitions: RO(['edit_repo', 'local_commit', 'run_tests']),
      max_risk: 'YELLOW', environment_scope: 'staging',
      write_scope: 'none', network_scope: 'none', can_approve: false,
      max_concurrent_jobs: 1, timeout_ms: 60_000, max_retries: 1,
    },
    claude: {
      role: 'claude', version: '1.0.0',
      capabilities: RO<Capability>([
        'read_repo', 'edit_repo', 'run_tests', 'run_scanners',
        'local_commit', 'create_worktree', 'audit', 'propose_command',
      ]),
      prohibitions: RO([]),
      max_risk: 'YELLOW', environment_scope: 'staging',
      write_scope: 'worktree_only', network_scope: 'none', can_approve: false,
      max_concurrent_jobs: 2, timeout_ms: 900_000, max_retries: 2,
    },
    codex: {
      role: 'codex', version: '1.0.0',
      capabilities: RO<Capability>([
        'read_repo', 'edit_repo', 'run_tests', 'run_scanners',
        'local_commit', 'create_worktree', 'audit', 'propose_command',
      ]),
      prohibitions: RO([]),
      max_risk: 'YELLOW', environment_scope: 'staging',
      write_scope: 'worktree_only', network_scope: 'none', can_approve: false,
      max_concurrent_jobs: 2, timeout_ms: 900_000, max_retries: 2,
    },
    hermes: {
      role: 'hermes', version: '1.0.0',
      capabilities: RO<Capability>(['read_repo', 'coordinate', 'audit']),
      prohibitions: RO(['edit_repo', 'local_commit', 'propose_command']),
      max_risk: 'GREEN', environment_scope: 'staging',
      write_scope: 'none', network_scope: 'none', can_approve: false,
      max_concurrent_jobs: 1, timeout_ms: 120_000, max_retries: 1,
    },
    audit: {
      role: 'audit', version: '1.0.0',
      capabilities: RO<Capability>(['read_repo', 'run_tests', 'run_scanners', 'audit']),
      prohibitions: RO(['edit_repo', 'local_commit']),
      max_risk: 'GREEN', environment_scope: 'staging',
      write_scope: 'none', network_scope: 'none', can_approve: false,
      max_concurrent_jobs: 2, timeout_ms: 300_000, max_retries: 1,
    },
  });

// Default-deny capability check. A capability is granted only if it is listed,
// not in the agent's prohibitions, and not in the universal prohibition set.
export function canAgentPerform(
  role: AgentRole,
  capability: Capability,
): boolean {
  const c = AGENT_CONTRACTS[role];
  if (!c) return false; // unknown agent => deny
  if (UNIVERSAL_PROHIBITIONS.includes(capability as string)) return false;
  if (c.prohibitions.includes(capability)) return false;
  return c.capabilities.includes(capability);
}

// Can the agent even PROPOSE an action at this risk? (Proposing is not doing;
// approval + execution gates still apply downstream.)
export function agentMayProposeRisk(role: AgentRole, risk: RiskClass): boolean {
  const c = AGENT_CONTRACTS[role];
  if (!c) return false;
  return RISK_ORDER[risk] <= RISK_ORDER[c.max_risk];
}

// Structural self-check: no contract may claim a universally-prohibited action
// or set can_approve true. Returns the list of violations (empty = healthy).
export function auditContracts(): string[] {
  const bad: string[] = [];
  for (const c of Object.values(AGENT_CONTRACTS)) {
    if ((c as { can_approve: boolean }).can_approve === true) {
      bad.push(`${c.role}:can_approve_true`);
    }
    for (const cap of c.capabilities) {
      if (UNIVERSAL_PROHIBITIONS.includes(cap as string)) {
        bad.push(`${c.role}:claims_prohibited:${cap}`);
      }
    }
    if (c.environment_scope !== 'staging') bad.push(`${c.role}:env_not_staging`);
    if (c.network_scope !== 'none') bad.push(`${c.role}:has_network`);
  }
  return bad;
}
