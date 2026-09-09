import { describe, expect, it } from 'vitest';
import { makeSandboxConnectorPassport } from '../src/lib/ai-os/connectors/passport';
import {
  evaluateSoftLaunch,
  softLaunchAssessmentRow,
  type SoftLaunchFacts,
} from '../src/lib/ai-os/connectors/soft-launch';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function facts(over: Partial<SoftLaunchFacts> = {}): SoftLaunchFacts {
  const base: SoftLaunchFacts = {
    build_revision: '8d50db04a241641237f7c0815ff4c2d9aac8dafb',
    control: {
      local_foundation_sealed: true,
      status_event_truth_proven: true,
      kill_stop_unit_proven: true,
      backup_restore_procedure_proven: true,
    },
    workers: {
      claude_path_built: true,
      codex_path_built: true,
      concurrency_unit_proven: true,
      staging_runtime_proven: false,
    },
    validation: { unit: true, integration: true, typecheck: true, lint: true },
    safety: {
      live_customer_sends_disabled: true,
      financial_execution_disabled: true,
      order_placement_disabled: true,
      production_untouched: true,
    },
    connectors: [{
      passport: makeSandboxConnectorPassport({
        provider: 'gmail', capabilities: ['gmail.message.draft'],
        environment: 'staging', now_ms: NOW,
      }),
      requirement: {
        provider: 'gmail', capability: 'gmail.message.draft',
        operation_kind: 'write', environment: 'staging',
        required_mode: 'sandbox_only', now_ms: NOW,
      },
    }],
    evidence_refs: ['report:local-validation'],
    open_critical_defects: [],
    owner_gates: ['push_branch', 'staging_runtime_window'],
  };
  return { ...base, ...over };
}

describe('M9 soft-launch readiness', () => {
  it('reports repository-ready while live staging proof remains owner-gated', () => {
    expect(evaluateSoftLaunch(facts())).toEqual({
      status: 'REPOSITORY_READY', repository_ready: true,
      staging_ready: false, production_ready: false, blockers: [],
      owner_gates: ['push_branch', 'staging_runtime_window'],
      evidence_refs: ['report:local-validation'],
      build_revision: '8d50db04a241641237f7c0815ff4c2d9aac8dafb',
    });
  });

  it('blocks on any failed validation, unsafe consequential surface, stale connector, or defect', () => {
    const f = facts();
    f.validation.security = false;
    f.safety.order_placement_disabled = false;
    f.connectors[0].passport!.data_as_of = new Date(NOW - 301_000).toISOString();
    f.open_critical_defects = ['wrong_project'];
    const result = evaluateSoftLaunch(f);
    expect(result.status).toBe('BLOCKED');
    expect(result.production_ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'validation:security', 'safety:order_placement_disabled',
      'connector:0:data_stale', 'critical:wrong_project',
    ]));
  });

  it('can reach staging-ready only after runtime proof and still never asserts production-ready', () => {
    const f = facts();
    f.workers.staging_runtime_proven = true;
    const result = evaluateSoftLaunch(f);
    expect(result.status).toBe('STAGING_READY_OWNER_GATED');
    expect(result.staging_ready).toBe(true);
    expect(result.production_ready).toBe(false);
    expect(softLaunchAssessmentRow(result, '2026-09-08T12:00:00.000Z', 'owner'))
      .toMatchObject({ production_ready: false, evaluated_by: 'owner' });
  });
});
