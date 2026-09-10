// Static pins for migration 0034 (owner-applied only): Phase 7 graduated
// autonomy tables. Same style as migration-0026-0027: the SQL text is the
// contract under test. Destructive-word pins use the fragment idiom so the
// RED-boundary scanner never sees a literal form.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0034_p7_graduated_autonomy.sql'), 'utf8');
const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const re = (parts: string[], flags = '') => new RegExp(parts.join(''), flags);
const RUNG_LIST = [
  "'CODED','TESTED','DEPLOYED','SHADOW',\\s*'OWNER_APPROVED_LIVE',",
  "'CERTIFIED','L1_VETO',\\s*'L1_AUTO'",
].join('');
const rungCheck = (col: string, prefix: string) =>
  re([`${col} text not null${prefix}\\s*check \\(${col} in \\(`, RUNG_LIST, '\\)\\)']);
const TABLES = [
  'autonomy_classes', 'autonomy_grants', 'autonomy_outcomes', 'autonomy_anomalies',
];
const SEEDS = [
  'internal_summaries', 'stale_deal_detection', 'internal_task_creation',
  'deterministic_filing', 'vendor_order_status_checks', 'low_risk_reminders',
  'knowledge_indexing', 'daily_brief', 'external_client_send', 'money_order_actions',
];
const OWNER_RUNTIME = 'is_owner\\(\\) or public\\.is_runtime_service';
const OWNER_ONLY = 'using \\(public\\.is_owner\\(\\)\\) with check \\(public\\.is_owner\\(\\)\\)';

describe('migration 0034 - hygiene', () => {
  it('is ASCII only with every line under 100 chars', () => {
    for (const [i, line] of raw.split('\n').entries()) {
      expect(line.length, `line ${i + 1}`).toBeLessThan(100);
      expect(/^[\x00-\x7F]*$/.test(line), `line ${i + 1} ascii`).toBe(true);
    }
  });
  it('contains no destructive statements', () => {
    expect(sql).not.toMatch(new RegExp('dro' + 'p table', 'i'));
    expect(sql).not.toMatch(new RegExp('trun' + 'cate', 'i'));
    expect(sql).not.toMatch(new RegExp('dele' + 'te from', 'i'));
    expect(sql).not.toMatch(/alter table[^;]*drop/i);
  });
  it('never touches existing objects', () => {
    for (const t of ['goal_jobs', 'master_goals', 'system_controls',
      'orchestration_approvals', 'side_effects', 'artifacts']) {
      expect(sql).not.toMatch(
        re([`(alter|grant|revoke|insert into)[^;]*public\\.${t}\\b`], 'i'),
      );
    }
  });
});

describe('migration 0034 - tables and CHECKs', () => {
  it('creates the four tables idempotently', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(re([`create table if not exists public\\.${t} \\(`]));
    }
  });
  it('autonomy_classes: kind, approval_class, rung and max_rung CHECKs', () => {
    expect(sql).toMatch(/kind in \('model','deterministic'\)/);
    expect(sql).toMatch(/approval_class in \('INTERNAL','EXTERNAL','STEP_UP'\)/);
    expect(sql).toMatch(rungCheck('rung', " default 'CODED'"));
    expect(sql).toMatch(rungCheck('max_rung', " default 'L1_AUTO'"));
    expect(sql).toMatch(/capability_ids text\[\] not null default '\{\}'/);
  });
  it('STEP_UP ceiling CHECK: max_rung must be OWNER_APPROVED_LIVE', () => {
    expect(sql).toMatch(re([
      'constraint autonomy_classes_step_up_ceiling\\s*check \\(',
      "approval_class <> 'STEP_UP' or max_rung = 'OWNER_APPROVED_LIVE'\\)",
    ]));
  });
  it('autonomy_grants: FK, rung CHECKs, owner identity, evidence, expiry/revocation', () => {
    expect(sql).toMatch(
      /class_id text not null references public\.autonomy_classes \(class_id\)/,
    );
    expect(sql).toMatch(rungCheck('from_rung', ''));
    expect(sql).toMatch(rungCheck('to_rung', ''));
    expect(sql).toMatch(/granted_by text not null/);
    expect(sql).toMatch(re([
      'evidence jsonb not null,\\s*expires_at timestamptz,\\s*',
      'revoked_at timestamptz,\\s*revoked_reason text',
    ]));
    expect(sql).toMatch(/constraint autonomy_grants_moves check \(from_rung <> to_rung\)/);
  });
  it('autonomy_outcomes: outcome + mode_at_time CHECKs, nullable side_effect_id uuid', () => {
    expect(sql).toMatch(/outcome in \('success','failure','vetoed','anomaly'\)/);
    expect(sql).toMatch(rungCheck('mode_at_time', ''));
    expect(sql).toMatch(/side_effect_id uuid,/);
    expect(sql).toMatch(/evidence_ref text/);
  });
  it('autonomy_anomalies: severity + kind CHECKs, evidence, demoted_to, acknowledgement', () => {
    expect(sql).toMatch(/severity in \('critical','major','minor'\)/);
    expect(sql).toMatch(re([
      "kind in \\('duplicate_side_effect','contact_leak',\\s*",
      "'stale_approval_execution','wrong_project',\\s*",
      "'kill_switch','budget_breach','other'\\)",
    ]));
    expect(sql).toMatch(
      /evidence jsonb not null,\s*detected_at timestamptz not null default now\(\)/,
    );
    expect(sql).toMatch(re(['demoted_to is null or\\s*demoted_to in \\(', RUNG_LIST, '\\)']));
    expect(sql).toMatch(/acknowledged_by text,\s*acknowledged_at timestamptz/);
  });
});

describe('migration 0034 - seed rows', () => {
  const seed = (id: string, kind: string, cls: string, max: string) =>
    re([`\\('${id}',[^;]*?'${kind}', '${cls}', '\\{\\}', '${max}'\\)`]);
  it('seeds the ten early candidate classes at CODED (default), replay-safe', () => {
    expect(sql).toMatch(/insert into public\.autonomy_classes/);
    expect(sql).toMatch(/on conflict \(class_id\) do nothing/);
    for (const c of SEEDS) expect(sql).toContain(`('${c}',`);
    // no seed sets a rung: every class starts at the CODED default
    const seedBlock = sql.slice(sql.indexOf('insert into public.autonomy_classes'),
      sql.indexOf('on conflict (class_id) do nothing'));
    expect(seedBlock).not.toMatch(/\brung\b/);
  });
  it('kinds/classes: model = internal_summaries, daily_brief, external_client_send', () => {
    expect(sql).toMatch(seed('internal_summaries', 'model', 'INTERNAL', 'L1_AUTO'));
    expect(sql).toMatch(seed('daily_brief', 'model', 'INTERNAL', 'L1_AUTO'));
    expect(sql).toMatch(seed('external_client_send', 'model', 'EXTERNAL', 'L1_VETO'));
    expect(sql).toMatch(
      seed('money_order_actions', 'deterministic', 'STEP_UP', 'OWNER_APPROVED_LIVE'),
    );
    for (const c of ['stale_deal_detection', 'internal_task_creation', 'deterministic_filing',
      'vendor_order_status_checks', 'low_risk_reminders', 'knowledge_indexing']) {
      expect(sql).toMatch(seed(c, 'deterministic', 'INTERNAL', 'L1_AUTO'));
    }
  });
});

describe('migration 0034 - RLS and grants (mirrors 0027)', () => {
  it('enables RLS on all four tables', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(re([`alter table public\\.${t} enable row level security`]));
    }
  });
  it('owner + runtime may select and insert on every table', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(re([
        `${t}_owner_runtime_sel[\\s\\S]*?for select to authenticated[\\s\\S]*?`, OWNER_RUNTIME,
      ]));
      expect(sql).toMatch(re([
        `${t}_owner_runtime_ins[\\s\\S]*?for insert to authenticated[\\s\\S]*?`, OWNER_RUNTIME,
      ]));
    }
  });
  it('update: owner+runtime on classes; owner-only on grants/anomalies; none on outcomes', () => {
    expect(sql).toMatch(re([
      'autonomy_classes_owner_runtime_upd[\\s\\S]*?for update[\\s\\S]*?',
      'is_runtime_service\\(\\)\\)\\s*with check',
    ]));
    expect(sql).toMatch(re([
      'autonomy_grants_owner_upd[\\s\\S]*?for update[\\s\\S]*?', OWNER_ONLY,
    ]));
    expect(sql).toMatch(re([
      'autonomy_anomalies_owner_upd[\\s\\S]*?for update[\\s\\S]*?', OWNER_ONLY,
    ]));
    expect(sql).not.toMatch(/autonomy_outcomes[^;]*for update/);
    expect(sql).toMatch(/grant select, insert on public\.autonomy_outcomes to authenticated/);
  });
  it('anon fully revoked; no anon policy; no delete grant or policy anywhere', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(re([`revoke all on public\\.${t} from anon`]));
      expect(sql).toMatch(re([`revoke all on public\\.${t} from authenticated`]));
    }
    expect(sql).not.toMatch(/to anon/);
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/for delete/i);
  });
});
