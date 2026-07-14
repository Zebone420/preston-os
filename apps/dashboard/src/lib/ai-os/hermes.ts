import { type SystemControls, isHalted } from './controls';
import { eligibleWorker, type EligibilityInput } from './leases';
import { validateCommand, isExpired as commandExpired, type CommandPacket } from './commands';

// Preston AI OS - Hermes orchestration engine (Phase 3). PURE decision logic,
// DISABLED by default. Hermes only DECIDES; it never executes shell, never
// bypasses approval, never activates itself, never runs RED/BLACK, and never
// acts when the runtime is halted/paused. The actual dispatch is gated again
// downstream (execution stays disabled). No daemon, no polling here.

export type HermesDecision = 'dispatch' | 'propose' | 'observe' | 'reject' | 'noop';

export interface HermesInput {
  controls: SystemControls;
  command: CommandPacket | null;
  eligibility: EligibilityInput; // job + agent + controls + required caps/connectors
  now: string;
}

export interface HermesResult {
  decision: HermesDecision;
  reasons: string[];
}

// Decide the next action for one job. Mode governs the ceiling:
//   disabled/stopped        -> noop
//   paused                  -> noop
//   observe_only            -> observe (never acts)
//   propose_only            -> propose iff fully eligible (never dispatches)
//   dispatch_eligible       -> dispatch iff fully eligible
// Eligibility is fail-closed and adversarial (see leases.eligibleWorker):
// refuses unapproved, RED/BLACK, execution-disabled, stale agent, missing
// capability/connector, halt/pause/cancel, missing correlation id.
export function decide(input: HermesInput): HermesResult {
  const { controls, command, now } = input;
  const mode = controls.hermes_mode;

  if (mode === 'disabled' || mode === 'stopped') {
    return { decision: 'noop', reasons: ['hermes ' + mode] };
  }
  if (mode === 'paused' || controls.paused) {
    return { decision: 'noop', reasons: ['paused'] };
  }
  if (mode === 'observe_only') {
    return { decision: 'observe', reasons: ['observe_only'] };
  }

  // propose_only or dispatch_eligible: evaluate every gate before acting.
  const reasons: string[] = [];
  if (isHalted(controls)) reasons.push('runtime halted');
  if (!command) {
    reasons.push('missing command packet');
  } else {
    const v = validateCommand(command);
    if (!v.ok) reasons.push('malformed command: ' + v.errors.join(','));
    if (commandExpired(command, now)) reasons.push('command expired');
  }
  reasons.push(...eligibleWorker(input.eligibility).reasons);

  if (reasons.length > 0) return { decision: 'reject', reasons };

  return mode === 'propose_only'
    ? { decision: 'propose', reasons: [] }
    : { decision: 'dispatch', reasons: [] };
}
