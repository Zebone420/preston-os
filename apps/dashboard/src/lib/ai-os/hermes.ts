import { type SystemControls, isHalted } from './controls';
import { eligibleWorker, type EligibilityInput } from './leases';
import { validateCommand, isExpired as commandExpired, type CommandPacket } from './commands';
import type { Job } from './queue';

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

// --- routing recommendation (Phase 5J) --------------------------------------
// Hermes stays observe-only: this NEVER assigns work, NEVER writes, NEVER
// calls another agent. It only CLASSIFIES a job's free-text intent into a
// bounded set of task kinds and attaches a fixed, non-executing recommendation
// (implementer=claude, reviewer=codex) that the caller records as reason
// strings alongside the 'observe' decision. Pure, no I/O, never throws.

export type TaskKind = 'documentation' | 'code' | 'test' | 'migration' | 'unknown';

// Minimal free-text hints a caller may (optionally) supply from the job's
// command packet. Deliberately NOT the full CommandPacket shape - Hermes only
// ever reads these three descriptive fields for classification, nothing else.
export interface TaskTextHints {
  requested_action?: string | null;
  requested_scope?: string | null;
  expected_outcome?: string | null;
}

export interface TaskClassification {
  task_kind: TaskKind;
  implementer: 'claude';
  reviewer: 'codex';
}

// Bounded keyword heuristics, checked most-specific-first so a job mentioning
// both e.g. "test" and "migration" resolves deterministically.
const MIGRATION_RE = /\b(migration|migrate|schema[\s-]?change|alter\s+table|ddl)\b/i;
const TEST_RE = /\b(tests?|testing|spec(s)?|vitest|jest|unit[\s-]?test|e2e|coverage)\b/i;
const DOC_RE = /\b(docs?|documentation|readme|changelog|write[\s-]?up)\b/i;
const CODE_RE = /\b(implement|fix|refactor|feature|bug|code|function|endpoint|component|route|module|api)\b/i;

// Classify a job (plus optional packet hints) into a task kind and attach the
// fixed claude/codex recommendation. Reads ONLY title-ish/free-text fields
// (requested_action, requested_scope, expected_outcome when a packet is
// available; falls back to job identifiers otherwise - normally not enough
// signal, so that path is expected to land on 'unknown'). Fail-closed:
// anything unexpected yields 'unknown' rather than throwing.
export function classifyTask(
  job: Job | null | undefined,
  packet?: TaskTextHints | null,
): TaskClassification {
  let kind: TaskKind = 'unknown';
  try {
    const parts = [
      packet?.requested_action,
      packet?.requested_scope,
      packet?.expected_outcome,
      job?.command_id,
      job?.id,
    ].filter((s): s is string => typeof s === 'string' && s.length > 0);
    const text = parts.join(' ').toLowerCase();
    if (MIGRATION_RE.test(text)) kind = 'migration';
    else if (TEST_RE.test(text)) kind = 'test';
    else if (DOC_RE.test(text)) kind = 'documentation';
    else if (CODE_RE.test(text)) kind = 'code';
  } catch {
    kind = 'unknown';
  }
  // implementer/reviewer are fixed and always distinct - never derived from
  // untrusted text, so no classification path can make them equal.
  return { task_kind: kind, implementer: 'claude', reviewer: 'codex' };
}
