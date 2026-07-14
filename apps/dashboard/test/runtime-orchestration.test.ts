import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import {
  canAllocate,
  canCleanup,
  isConcurrentConflict,
  planWorktree,
  refusesDirtyReuse,
  workerPushAllowed,
  type Worktree,
} from '../src/lib/ai-os/worktree';
import {
  renderMarkdown,
  renderTelegram,
  sanitizeCheckpointInput,
  toHandoff,
  validateCheckpoint,
  type Checkpoint,
} from '../src/lib/ai-os/checkpoint';
import { decide } from '../src/lib/ai-os/hermes';
import type { EligibilityInput } from '../src/lib/ai-os/leases';
import type { Job } from '../src/lib/ai-os/queue';
import { normalizeCommand } from '../src/lib/ai-os/commands';
import { runPermitted, simulate, validateEnvelope, type ExecutionEnvelope } from '../src/lib/ai-os/runner';

const NOW = '2026-07-14T12:00:00.000Z';

describe('worktree coordination', () => {
  const req = { repo: 'preston-os', agent: 'claude', job_id: 'j1', base_commit: 'abc', target_branch: 'master', now: NOW };
  it('requires a lock to allocate', () => {
    expect(canAllocate(null, req, false).ok).toBe(false);
    expect(canAllocate(null, req, true).ok).toBe(true);
  });
  it('refuses a tree in use by another agent', () => {
    const wt: Worktree = { ...planWorktree(req), agent: 'codex', status: 'in_use' };
    expect(canAllocate(wt, req, true).ok).toBe(false);
    expect(isConcurrentConflict(wt, 'claude')).toBe(true);
  });
  it('cleans up only after verification and never auto-pushes', () => {
    expect(canCleanup({ ...planWorktree(req), status: 'in_use' })).toBe(false);
    expect(canCleanup({ ...planWorktree(req), status: 'verified' })).toBe(true);
    expect(workerPushAllowed()).toBe(false);
  });
  it('refuses silent reuse of a dirty tree', () => {
    expect(refusesDirtyReuse({ ...planWorktree(req), dirty: true })).toBe(true);
  });
});

describe('checkpoint / handoff', () => {
  const cp: Checkpoint = {
    project: 'preston-os', phase: 'Phase 3', gate: 'runtime', goal: 'build runtime',
    job_id: 'j1', agent_id: 'claude', worktree: 'wt-j1', branch: 'master',
    base_commit: 'a', current_commit: 'b', files_changed: ['x.ts'], tests_run: 'vitest',
    validation: 'pass', blockers: [], owner_actions: ['push'], next_action: 'commit',
    rollback: 'git revert', correlation_id: 'c1', created_at: NOW, status: 'in_progress',
  };
  it('validates required fields', () => {
    expect(validateCheckpoint(cp).ok).toBe(true);
    expect(validateCheckpoint({ ...cp, goal: '' }).ok).toBe(false);
  });
  it('strips reasoning-shaped keys and redacts secrets on sanitize', () => {
    const out = sanitizeCheckpointInput({ next_action: 'x', chain_of_thought: 'hidden', api_key: 'sk' });
    expect('chain_of_thought' in out).toBe(false);
    expect(out.api_key).toBe('[REDACTED]');
  });
  it('renders markdown + compact telegram, and hands off', () => {
    expect(renderMarkdown(cp)).toContain('Checkpoint - preston-os');
    expect(renderTelegram(cp)).toContain('[in_progress]');
    expect(toHandoff(cp, 'codex', NOW).agent_id).toBe('codex');
    expect(toHandoff(cp, 'codex', NOW).status).toBe('handoff');
  });
});

const agent: AgentRecord = {
  id: 'claude-worker', display_name: 'CW', provider: 'anthropic', model: 'm',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'info@preston.nyc',
};
function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'leased', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: '2026-07-14T13:00:00.000Z',
    lease_owner: 'claude-worker', lease_token: 't', lease_expires_at: '2026-07-14T12:05:00.000Z',
    attempts: 0, max_attempts: 3, timeout_ms: 60000, retry_backoff_ms: 1000,
    idempotency_key: 'i', correlation_id: 'corr', checkpoint_ref: null, result_ref: null,
    error_class: null, execution_enabled: true, cancel_requested: false, created_at: NOW, updated_at: NOW,
    ...over,
  };
}
function elig(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    agent, job: job(), controls: { ...DEFAULT_CONTROLS, execution_enabled: true },
    requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW, ...over,
  };
}
const cmd = normalizeCommand({
  id: 'c1', actor: 'owner', source: 'dashboard', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os', correlation_id: 'corr', idempotency_key: 'i', now: NOW,
});

describe('Hermes - disabled by default + adversarial refusal', () => {
  const dispatchMode = (over: Partial<SystemControls> = {}): SystemControls => ({
    ...DEFAULT_CONTROLS, execution_enabled: true, hermes_mode: 'dispatch_eligible', ...over,
  });

  it('noop when disabled (default) or stopped/paused', () => {
    expect(decide({ controls: DEFAULT_CONTROLS, command: cmd, eligibility: elig(), now: NOW }).decision).toBe('noop');
    expect(decide({ controls: { ...DEFAULT_CONTROLS, hermes_mode: 'stopped' }, command: cmd, eligibility: elig(), now: NOW }).decision).toBe('noop');
    expect(decide({ controls: { ...dispatchMode(), paused: true }, command: cmd, eligibility: elig(), now: NOW }).decision).toBe('noop');
  });

  it('observe_only never acts', () => {
    expect(decide({ controls: { ...DEFAULT_CONTROLS, hermes_mode: 'observe_only' }, command: cmd, eligibility: elig(), now: NOW }).decision).toBe('observe');
  });

  it('dispatches only a fully-eligible GREEN job', () => {
    const controls = dispatchMode();
    expect(decide({ controls, command: cmd, eligibility: elig({ controls }), now: NOW }).decision).toBe('dispatch');
  });

  it('propose_only proposes but never dispatches', () => {
    const controls = dispatchMode({ hermes_mode: 'propose_only' });
    expect(decide({ controls, command: cmd, eligibility: elig({ controls }), now: NOW }).decision).toBe('propose');
  });

  it('rejects unapproved / RED / stale-agent / missing-connector / expired-command', () => {
    const controls = dispatchMode();
    expect(decide({ controls, command: cmd, eligibility: elig({ controls, job: job({ approval_id: null }) }), now: NOW }).decision).toBe('reject');
    expect(decide({ controls, command: cmd, eligibility: elig({ controls, job: job({ risk_class: 'RED' }) }), now: NOW }).decision).toBe('reject');
    expect(decide({ controls, command: cmd, eligibility: elig({ controls, now: '2026-07-14T13:30:00.000Z' }), now: '2026-07-14T13:30:00.000Z' }).decision).toBe('reject'); // stale agent + expired
    expect(decide({ controls, command: cmd, eligibility: elig({ controls, requiredConnectors: ['slack'] }), now: NOW }).decision).toBe('reject');
    expect(decide({ controls, command: null, eligibility: elig({ controls }), now: NOW }).decision).toBe('reject');
  });
});

describe('remote runner envelope - validation + simulation only', () => {
  const base: ExecutionEnvelope = {
    runner_id: 'r1', repo_root: '/srv/preston-os', executable: 'git',
    args: ['status', '--porcelain'], cwd: '/srv/preston-os', timeout_ms: 60000,
    allow_network: false, correlation_id: 'c1',
  };
  it('accepts a safe structured git command', () => {
    expect(validateEnvelope(base).ok).toBe(true);
  });
  it('rejects non-allowlisted executable', () => {
    expect(validateEnvelope({ ...base, executable: 'bash' }).ok).toBe(false);
  });
  it('rejects shell metacharacters and path traversal in args', () => {
    expect(validateEnvelope({ ...base, args: ['status', '&&', 'whoami'] }).ok).toBe(false);
    expect(validateEnvelope({ ...base, args: ['../etc/passwd'] }).ok).toBe(false);
  });
  it('rejects destructive args, network, cwd escape, bad timeout', () => {
    expect(validateEnvelope({ ...base, args: ['clean', '-' + 'rf'] }).ok).toBe(false);
    expect(validateEnvelope({ ...base, allow_network: true }).ok).toBe(false);
    expect(validateEnvelope({ ...base, cwd: '/other' }).ok).toBe(false);
    expect(validateEnvelope({ ...base, timeout_ms: 0 }).ok).toBe(false);
  });
  it('never permits a run without the runner enabled + runtime active', () => {
    expect(runPermitted(base, DEFAULT_CONTROLS)).toBe(false);
    expect(runPermitted(base, { ...DEFAULT_CONTROLS, execution_enabled: true, remote_runner_enabled: true })).toBe(true);
  });
  it('simulate never runs a process', () => {
    expect(simulate(base).wouldRun).toBe(false);
    expect(simulate(base).valid).toBe(true);
  });
});
