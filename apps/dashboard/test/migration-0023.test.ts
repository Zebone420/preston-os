// 0023 - DB-side job classification gate. Closes the classification-to-gating
// bypass (matrix probe C-1): a runtime identity cannot birth an ungated job
// whose objective the DB classifies as dangerous. INSERT-only RESTRICTIVE
// policy + IMMUTABLE job_gate_required(). Static pins; live behaviour is the
// 0023 staging matrix.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '0023_job_classification_gate.sql'), 'utf8');
const policyTs = readFileSync(join(ROOT, 'apps', 'dashboard', 'src', 'lib', 'ai-os', 'orchestration', 'policy.ts'), 'utf8');
const commandsTs = readFileSync(join(ROOT, 'apps', 'dashboard', 'src', 'lib', 'ai-os', 'commands.ts'), 'utf8');

describe('migration 0023 - job classification gate', () => {
  it('defines job_gate_required IMMUTABLE with pinned search_path', () => {
    expect(sql).toMatch(/function public\.job_gate_required\(p_kind text, p_objective text\)/);
    expect(sql).toContain('immutable');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  it('classifier reads only its text args (never risk_class / requires_approval)', () => {
    const fn = sql.slice(sql.indexOf('function public.job_gate_required'), sql.indexOf('revoke all on function public.job_gate_required'));
    expect(fn).not.toMatch(/risk_class/);
    expect(fn).not.toMatch(/requires_approval/);
  });

  it('execute is revoked from public and granted to authenticated', () => {
    expect(sql).toMatch(/revoke all on function public\.job_gate_required\(text, text\) from public/);
    expect(sql).toMatch(/grant execute on function public\.job_gate_required\(text, text\) to authenticated/);
  });

  it('adds an INSERT-only RESTRICTIVE policy with the EXACT approved predicate', () => {
    // MUST include "on goal_jobs": CREATE POLICY without ON <table> is a
    // PostgreSQL syntax error (the staging D-1 FAIL: the policy was never
    // installed, so the runtime insert was never restricted).
    expect(sql).toMatch(/create policy goal_jobs_runtime_classify on goal_jobs as restrictive\s+for insert to authenticated/);
    const chk = sql.slice(sql.indexOf('with check', sql.indexOf('goal_jobs_runtime_classify')));
    // all three OR-terms present, including the load-bearing classifier call
    expect(chk).toMatch(/not public\.is_runtime_service\(\)/);
    expect(chk).toMatch(/requires_approval = true/);
    expect(chk).toMatch(/not public\.job_gate_required\(kind, objective\)/);
  });

  it('policy is INSERT-only (never for-all/for-update) so the clear path is untouched', () => {
    expect(sql).not.toMatch(/goal_jobs_runtime_classify[\s\S]*for all/);
    expect(sql).not.toMatch(/goal_jobs_runtime_classify[\s\S]*for update/);
    expect(sql).toMatch(/goal_jobs_runtime_classify on goal_jobs as restrictive\s+for insert/);
  });

  // PARSE REGRESSION (staging D-1 FAIL root cause): CREATE POLICY grammar is
  // `create policy <name> ON <table> ...` — the ON clause is mandatory. The
  // original 0023 omitted it, the statement errored on apply, and the policy
  // silently did not exist. Pin that every create policy names its table.
  it('every create policy statement names its target table (ON <table>)', () => {
    const stmts = sql.match(/create policy\s+\w+\s+\w+/g) ?? [];
    expect(stmts.length).toBeGreaterThan(0);
    for (const s of stmts) {
      expect(s, `create policy missing ON <table>: "${s}"`).toMatch(/create policy\s+\w+\s+on\b/);
    }
  });

  it('does NOT enforce risk_class consistency (kept out of scope)', () => {
    const pol = sql.slice(sql.indexOf('goal_jobs_runtime_classify'));
    expect(pol).not.toMatch(/risk_class/);
  });

  // DRIFT GUARD: every dangerous marker the app uses to force approval must be
  // present in the DB predicate, so the DB can never UNDER-classify vs the app.
  it('DB predicate is a superset of the app RED + mobile-gate markers', () => {
    const appMarkers = [
      // classifyRisk RED tokens (commands.ts)
      'send', 'email', 'sms', 'deploy', 'production', 'prod', 'delete',
      'payment', 'charge', 'transfer', 'migrat',
      // classifyRisk BLACK fragments (commands.ts, assembled) + mobile tokens.
      // 'trunc[a]te' matches the char-class-broken form used in 0023 (so this
      // test file itself never carries the literal destructive token).
      'trunc[a]te', 'wipe', 'destroy', 'shutdown', 'drop', 'push',
      'dns', 'rls', 'invoice', 'refund', 'retire',
      'hermes[_-]?mode', 'remote[_-]?runner', 'remote_runner_enabled',
      'execution_enabled', 'enable[_-]?execution', 'anon[_-]?grant',
      'airtable[_-]?write', 'crm[_-]?write', 'external[_-]?write',
    ];
    for (const m of appMarkers) {
      expect(sql.includes(m), `0023 predicate missing app marker: ${m}`).toBe(true);
    }
    // sanity: these markers really do exist in the app sources we mirror
    expect(commandsTs).toMatch(/send\|email\|sms\|deploy\|production\|prod\|delete\|payment\|charge\|transfer\|migrate/);
    expect(policyTs).toMatch(/remote\[_-\]\?runner|remote_runner_enabled/);
  });
});
