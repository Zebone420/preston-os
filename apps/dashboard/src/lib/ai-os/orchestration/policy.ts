// Preston AI OS - Phase 7 approval policy engine. PURE, default-deny.
// Maps a proposed (action, agent, environment) to a policy decision:
// risk class, whether owner approval is required, whether it needs a MOBILE
// (Telegram/ChatGPT) gate, and the evidence required. Ambiguity => fail closed
// (require approval). Reuses classifyRisk from the runtime command layer.

import { classifyRisk } from '../commands';
import type { RiskClass } from '../types';
import type { AgentRole } from './model';
import { agentMayProposeRisk } from './agent-contracts';

// Actions that ALWAYS require a fresh one-time owner mobile approval, no matter
// how the free-text classifier scores them. Matched by keyword against the
// action text. This is the RED mobile-gate taxonomy from the master goal.
const MOBILE_GATE_MARKERS: RegExp[] = [
  /\bcredential|secret|token|api[_-]?key\b/i,
  /\bservice[_-]?role\b/i,
  /\bproduction|prod\b/i,
  /\bdeploy\b/i,
  /\bmigrat/i,
  /\blive[_-]?send|send[_-]?(email|sms|message|telegram)\b/i,
  /\bexternal[_-]?write|airtable[_-]?write|crm[_-]?write\b/i,
  /\binvoice|payment|refund|charge\b/i,
  /\bdns\b/i,
  /\bdelete|destroy|retire|drop\b/i,
  /\brls\b/i,
  /\banon[_-]?grant\b/i,
  /\benable[_-]?execution|execution_enabled\b/i,
  /\bremote[_-]?runner|remote_runner_enabled\b/i,
  /\bhermes[_-]?mode\b/i,
  /\bpush\b/i,
];

export type PolicyTier = 'GREEN' | 'YELLOW' | 'RED';

export interface PolicyDecision {
  risk_class: RiskClass;
  tier: PolicyTier;
  requires_approval: boolean;
  mobile_gate: boolean; // true => must go to Telegram/ChatGPT mobile
  evidence_required: string[]; // evidence classes the request must carry
  allowed_for_agent: boolean; // is this within the agent's contract ceiling
  reason: string;
}

function tierOf(risk: RiskClass, mobile: boolean): PolicyTier {
  if (mobile || risk === 'RED' || risk === 'BLACK') return 'RED';
  if (risk === 'YELLOW') return 'YELLOW';
  return 'GREEN';
}

// Evaluate a proposed action. Fail-closed: any parse trouble or unknown agent
// yields a RED, approval-required, mobile-gated decision.
export function evaluatePolicy(input: {
  action: string;
  agent: AgentRole;
  environment: string;
}): PolicyDecision {
  const action = typeof input.action === 'string' ? input.action : '';
  if (action.trim().length === 0) {
    return failClosed('empty_action');
  }
  if (input.environment !== 'staging') {
    // Phase 7 is staging-only; any other environment is RED + mobile.
    return {
      risk_class: 'RED', tier: 'RED', requires_approval: true,
      mobile_gate: true, evidence_required: ['environment_justification'],
      allowed_for_agent: false, reason: 'non_staging_environment',
    };
  }
  const risk = classifyRisk(action);
  const mobile = MOBILE_GATE_MARKERS.some((re) => re.test(action));
  const tier = tierOf(risk, mobile);
  const allowed = agentMayProposeRisk(input.agent, risk);

  const requires_approval = tier !== 'GREEN'; // default-deny for non-GREEN
  const evidence_required =
    tier === 'GREEN'
      ? ['run_evidence']
      : tier === 'YELLOW'
        ? ['run_evidence', 'test_evidence', 'audit_evidence']
        : ['run_evidence', 'test_evidence', 'audit_evidence',
           'rollback_plan', 'owner_justification'];

  return {
    risk_class: risk,
    tier,
    requires_approval,
    mobile_gate: mobile || tier === 'RED',
    evidence_required,
    allowed_for_agent: allowed,
    reason: allowed ? 'classified' : 'exceeds_agent_ceiling',
  };
}

function failClosed(reason: string): PolicyDecision {
  return {
    risk_class: 'RED', tier: 'RED', requires_approval: true,
    mobile_gate: true,
    evidence_required: ['run_evidence', 'test_evidence', 'audit_evidence',
      'rollback_plan', 'owner_justification'],
    allowed_for_agent: false, reason,
  };
}

// Convenience: is this action auto-runnable by an agent WITHOUT owner approval?
// Only GREEN actions within the agent ceiling qualify.
export function isAutoRunnable(input: {
  action: string;
  agent: AgentRole;
  environment: string;
}): boolean {
  const d = evaluatePolicy(input);
  return d.tier === 'GREEN' && !d.requires_approval && d.allowed_for_agent;
}

// Job-level classification. A DECOMPOSED job runs in an isolated worktree,
// simulation-only, producing at most a local commit + evidence - the master
// goal lists "isolated worktree coding", "local tests", and "local commits"
// as GREEN. So a bounded worktree job is GREEN (auto-runnable in simulation)
// UNLESS its objective names a RED/mobile action (deploy/production/credential/
// migrate-apply/send/push/...), in which case it is RED and gated. Ambiguity
// does NOT escalate a bounded worktree job (that would gate all ordinary
// implementation); the mobile-gate markers are the only escalation trigger.
export interface JobPolicy {
  risk_class: RiskClass;
  tier: PolicyTier;
  requires_approval: boolean;
  mobile_gate: boolean;
  reason: string;
}

export function classifyJob(kind: string, objective: string): JobPolicy {
  const text = `${kind}: ${objective ?? ''}`;
  const d = evaluatePolicy({ action: text, agent: 'claude', environment: 'staging' });
  if (d.mobile_gate || d.tier === 'RED') {
    return {
      risk_class: d.risk_class, tier: 'RED', requires_approval: true,
      mobile_gate: true, reason: 'objective_names_gated_action',
    };
  }
  // Bounded worktree simulation work: GREEN.
  return {
    risk_class: 'GREEN', tier: 'GREEN', requires_approval: false,
    mobile_gate: false, reason: 'bounded_worktree_simulation',
  };
}
