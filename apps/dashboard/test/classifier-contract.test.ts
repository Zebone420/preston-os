import { describe, expect, it } from 'vitest';
import { classifyRisk, normalizeCommand } from '../src/lib/ai-os/commands';

// Phase 5 defect #2 documentation: the classifier wording contract.
//
// classifyRisk is DELIBERATELY conservative (default-deny). The observed
// Phase 5 behavior - "final laptop-closed staging simulation" rejected as
// YELLOW while "staging simulation drill: read repository status" passed as
// GREEN - is the intended contract, not a bug: GREEN requires an explicit
// read-only verb; anything else falls through to YELLOW (approval required).
// These tests PIN that contract so a future wording tweak that silently
// broadens GREEN fails loudly here. Do not "fix" a failing case by widening
// the GREEN list without an owner ruling.

describe('classifyRisk - pinned Phase 5 wording contract', () => {
  it('classifies the exact Phase 5 drill phrases as observed', () => {
    // The phrase that was correctly refused by /api/os/enqueue (not_green):
    expect(classifyRisk('final laptop-closed staging simulation')).toBe('YELLOW');
    // The explicitly read-only rewording that was accepted:
    expect(classifyRisk('staging simulation drill: read repository status')).toBe('GREEN');
  });

  it('defaults to YELLOW for ambiguous/unknown wording (never GREEN by default)', () => {
    expect(classifyRisk('run the weekly report')).toBe('YELLOW');
    expect(classifyRisk('simulate the pipeline')).toBe('YELLOW');
    expect(classifyRisk('refactor the module')).toBe('YELLOW');
    expect(classifyRisk('')).toBe('YELLOW');
  });

  it('requires an explicit read-only verb for GREEN', () => {
    expect(classifyRisk('read repository status')).toBe('GREEN');
    expect(classifyRisk('list open jobs')).toBe('GREEN');
    expect(classifyRisk('show system health')).toBe('GREEN');
    expect(classifyRisk('inspect the queue')).toBe('GREEN');
    expect(classifyRisk('get current controls')).toBe('GREEN');
  });

  it('known conservative quirk: "summarize"/"summary" do NOT reach GREEN', () => {
    // The GREEN list contains the stem 'summar' bounded by \b on both sides,
    // which can never match 'summary'/'summarize' (a word char follows the
    // stem). Pinned as-is: the miss makes classification MORE conservative
    // (summarize -> YELLOW -> approval required), so it is accepted, not
    // fixed, absent an owner ruling.
    expect(classifyRisk('summarize the repository')).toBe('YELLOW');
    expect(classifyRisk('summary of job status')).toBe('GREEN'); // 'status' matches, not 'summar'
    expect(classifyRisk('summary of jobs')).toBe('YELLOW');
  });

  it('RED outranks GREEN when both wordings appear (precedence pin)', () => {
    expect(classifyRisk('read production status')).toBe('RED');
    expect(classifyRisk('list emails to send')).toBe('RED');
    expect(classifyRisk('show deploy history')).toBe('RED');
  });

  it('substring safety: RED/GREEN words match on word boundaries only', () => {
    // 'products' must not trip \bprod\b; 'target' must not trip \bget\b.
    expect(classifyRisk('list products')).toBe('GREEN');
    expect(classifyRisk('inspect the target branch')).toBe('GREEN');
    // 'reads' does not match \bread\b -> stays YELLOW (conservative).
    expect(classifyRisk('reads everything')).toBe('YELLOW');
  });

  it('destructive markers classify BLACK ahead of everything else', () => {
    expect(classifyRisk('r' + 'm -rf the worktree')).toBe('BLACK');
    expect(classifyRisk('force push master')).toBe('BLACK');
    expect(classifyRisk('read status then wipe the disk')).toBe('BLACK');
  });
});

describe('normalizeCommand - approval posture follows the classification', () => {
  const base = {
    id: 'c1', actor: 'info@preston.nyc', source: 'dashboard' as const,
    target_project: 'preston-os', target_repository: 'preston-os',
    correlation_id: 'corr-abc12345', idempotency_key: 'idem-abc12345',
    now: '2026-07-21T12:00:00.000Z',
  };

  it('YELLOW (and anything non-GREEN) requires approval; GREEN does not', () => {
    const yellow = normalizeCommand({ ...base, requested_action: 'final laptop-closed staging simulation' });
    expect(yellow.action_class).toBe('YELLOW');
    expect(yellow.approval_required).toBe(true);

    const green = normalizeCommand({ ...base, requested_action: 'staging simulation drill: read repository status' });
    expect(green.action_class).toBe('GREEN');
    expect(green.approval_required).toBe(false);
  });

  it('execution_eligible is false at intake regardless of class', () => {
    for (const requested_action of ['read status', 'final laptop-closed staging simulation', 'deploy now']) {
      expect(normalizeCommand({ ...base, requested_action }).execution_eligible).toBe(false);
    }
  });
});
