import { redactSecrets } from './memory';

// Preston AI OS - checkpoint / handoff format (Phase 3). PURE.
// Canonical resumable checkpoint shared across agents (Claude <-> Codex) and
// reported to ChatGPT / Telegram. Stores CONCLUSIONS, evidence, commands, and
// status only - never private reasoning / chain-of-thought. JSON + Markdown +
// compact renderings; a Supabase persistence adapter is a later gate.

export type CheckpointStatus =
  | 'in_progress'
  | 'blocked'
  | 'complete'
  | 'failed'
  | 'handoff';

export interface Checkpoint {
  project: string;
  phase: string;
  gate: string;
  goal: string;
  job_id: string;
  agent_id: string;
  worktree: string;
  branch: string;
  base_commit: string;
  current_commit: string;
  files_changed: string[];
  tests_run: string;
  validation: string;
  blockers: string[];
  owner_actions: string[];
  next_action: string;
  rollback: string;
  correlation_id: string;
  created_at: string;
  status: CheckpointStatus;
}

// Keys that would leak hidden reasoning; stripped from any untrusted input.
const FORBIDDEN_KEYS = new Set([
  'reasoning',
  'chain_of_thought',
  'cot',
  'thoughts',
  'scratchpad',
  'internal',
]);

// Sanitize an untrusted checkpoint object: drop reasoning-shaped keys and
// redact secret-shaped values. Use before persisting anything from an agent.
export function sanitizeCheckpointInput(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return redactSecrets(out) as Record<string, unknown>;
}

export interface CheckpointValidation {
  ok: boolean;
  errors: string[];
}

export function validateCheckpoint(c: Partial<Checkpoint>): CheckpointValidation {
  const errors: string[] = [];
  const required: (keyof Checkpoint)[] = [
    'project', 'phase', 'gate', 'goal', 'job_id', 'agent_id',
    'correlation_id', 'created_at', 'status', 'next_action',
  ];
  for (const k of required) {
    if (!c[k] || String(c[k]).trim() === '') errors.push(`${String(k)} required`);
  }
  return { ok: errors.length === 0, errors };
}

// Human-readable Markdown (secrets redacted defensively).
export function renderMarkdown(c: Checkpoint): string {
  const safe = redactSecrets(c) as Checkpoint;
  return [
    `# Checkpoint - ${safe.project} (${safe.status})`,
    `Phase: ${safe.phase} | Gate: ${safe.gate}`,
    `Goal: ${safe.goal}`,
    `Job: ${safe.job_id} | Agent: ${safe.agent_id} | Corr: ${safe.correlation_id}`,
    `Worktree: ${safe.worktree} | Branch: ${safe.branch}`,
    `Base: ${safe.base_commit} -> Current: ${safe.current_commit}`,
    `Files changed: ${safe.files_changed.join(', ') || 'none'}`,
    `Tests: ${safe.tests_run}`,
    `Validation: ${safe.validation}`,
    `Blockers: ${safe.blockers.join('; ') || 'none'}`,
    `Owner actions: ${safe.owner_actions.join('; ') || 'none'}`,
    `Next action: ${safe.next_action}`,
    `Rollback: ${safe.rollback}`,
  ].join('\n');
}

// Compact one-liner for Telegram-style status (no secrets).
export function renderTelegram(c: Checkpoint): string {
  return `[${c.status}] ${c.project} ${c.phase}/${c.gate} job=${c.job_id} next=${c.next_action}`;
}

// Transfer a checkpoint to another agent (Claude <-> Codex). Marks handoff;
// preserves correlation id and evidence, resets the receiving agent.
export function toHandoff(c: Checkpoint, toAgent: string, now: string): Checkpoint {
  return { ...c, agent_id: toAgent, status: 'handoff', created_at: now };
}
