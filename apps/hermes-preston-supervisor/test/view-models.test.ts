import { describe, expect, it } from "vitest";
import {
  aggregateJobRows,
  artifactIdFromRef,
  metricFromState,
  toGoalCard,
  toHeader,
  toMetrics,
  type GoalDetailWire,
  type JobWire,
  type StatusWire,
} from "../dashboard/src/domain/view-models";

// Ported from the staging-verified reference suite. Core contract:
// authoritative IDs/states pass through unchanged, and a metric whose
// underlying read failed renders as 'UNKNOWN' - NEVER an invented
// zero. Adds the v0 defect fix: prefixed evidence refs
// (artifact:art-<hex>) resolve to the artifact id.

function statusFixture(): StatusWire {
  return {
    generated_at: "2026-08-31T12:00:00.000Z",
    environment: "staging",
    posture: "operating",
    controls: {
      readable: true,
      execution_enabled: false,
      remote_runner_enabled: false,
      owner_stop: false,
      paused: false,
      hermes_mode: "observe_only",
      updated_at: "2026-08-31T11:00:00.000Z",
    },
    summary: {
      total_goals: 3,
      running_goals: 1,
      blocked_goals: 1,
      open_approvals: 2,
      failed_jobs: 1,
      dead_lettered_jobs: 2,
    },
    recent_goals: [],
    pending_approvals: [],
    failures: [],
    dead_letters: [],
    read_states: {
      goals: "ok",
      approvals: "ok",
      jobs: "ok",
      failures: "ok",
      dead_letters: "ok",
    },
    needs_attention: ["2 approval(s) waiting for the owner"],
  };
}

function jobFixture(over: Partial<JobWire>): JobWire {
  return {
    job_id: "j-1",
    goal_id: "g-1",
    kind: "code",
    title: "job one",
    objective: "o",
    status: "completed",
    risk_class: "GREEN",
    assigned_role: "claude",
    attempts: 1,
    requires_approval: false,
    approval_id: null,
    failure_reason: null,
    evidence_refs: ["artifact:art-" + "a".repeat(32)],
    created_at: "2026-08-30T10:00:00.000Z",
    updated_at: "2026-08-31T09:00:00.000Z",
    ...over,
  };
}

function goalFixture(over: Partial<GoalDetailWire> = {}): GoalDetailWire {
  return {
    found: true,
    goal: {
      goal_id: "g-1",
      title: "T",
      objective: "O",
      status: "running",
      source: "owner",
      requested_by: "info@preston.nyc",
      environment: "staging",
      correlation_id: "c-1",
      simulation_only: true,
      iteration: 0,
      created_at: "2026-08-30T10:00:00.000Z",
      updated_at: "2026-08-31T10:00:00.000Z",
    },
    jobs: [
      jobFixture({}),
      jobFixture({
        job_id: "j-2",
        kind: "test",
        status: "in_progress",
        assigned_role: "codex",
        attempts: 2,
        evidence_refs: [],
        updated_at: "2026-08-31T11:00:00.000Z",
      }),
    ],
    jobs_read_ok: true,
    job_status_counts: { completed: 1, in_progress: 1 },
    pending_approvals: [],
    evidence_refs: [
      { job_id: "j-1", ref: "artifact:art-" + "a".repeat(32) },
    ],
    parent_goal_id: null,
    child_goal_ids: [],
    ...over,
  };
}

describe("metricFromState", () => {
  it("trusts ok and empty; everything else is UNKNOWN", () => {
    expect(metricFromState("ok", 5)).toBe(5);
    expect(metricFromState("empty", 0)).toBe(0);
    expect(metricFromState("error", 0)).toBe("UNKNOWN");
    expect(metricFromState("migration_absent", 0)).toBe("UNKNOWN");
    expect(metricFromState("weird", 9)).toBe("UNKNOWN");
  });
});

describe("toMetrics", () => {
  it("passes live counts through when every bucket read cleanly", () => {
    expect(toMetrics(statusFixture())).toEqual({
      total_goals: 3,
      running_goals: 1,
      blocked_goals: 1,
      pending_approvals: 2,
      failed_jobs: 1,
      dead_lettered_jobs: 2,
    });
  });

  it("an errored approvals read yields UNKNOWN, not the summary zero", () => {
    const s = statusFixture();
    s.read_states.approvals = "error";
    s.summary.open_approvals = 0;
    const m = toMetrics(s);
    expect(m.pending_approvals).toBe("UNKNOWN");
    expect(m.total_goals).toBe(3);
  });

  it("an errored jobs sweep marks BOTH failure metrics UNKNOWN", () => {
    const s = statusFixture();
    s.read_states.jobs = "error";
    const m = toMetrics(s);
    expect(m.failed_jobs).toBe("UNKNOWN");
    expect(m.dead_lettered_jobs).toBe("UNKNOWN");
  });
});

describe("toHeader", () => {
  it("carries posture, flags, hermes_mode and needs_attention verbatim", () => {
    const head = toHeader(statusFixture());
    expect(head.environment).toBe("staging");
    expect(head.posture).toBe("operating");
    expect(head.execution_enabled).toBe(false);
    expect(head.hermes_mode).toBe("observe_only");
    expect(head.needs_attention).toEqual([
      "2 approval(s) waiting for the owner",
    ]);
  });
});

describe("toGoalCard", () => {
  it("sums job counts and counts evidence availability factually", () => {
    const card = toGoalCard(goalFixture());
    expect(card.goal_id).toBe("g-1");
    expect(card.job_total).toBe(2);
    expect(card.pending_approvals).toBe(0);
    expect(card.evidence_refs).toBe(1);
  });

  it("a failed jobs read yields UNKNOWN job total, never zero", () => {
    const card = toGoalCard(
      goalFixture({ jobs_read_ok: false, job_status_counts: {} }),
    );
    expect(card.job_total).toBe("UNKNOWN");
  });
});

describe("aggregateJobRows", () => {
  it("flattens found goals newest-first, skipping unreadable ones", () => {
    const rows = aggregateJobRows([
      goalFixture(),
      { found: false, error: "read_failed" },
    ]);
    expect(rows.map((r) => r.job_id)).toEqual(["j-2", "j-1"]);
    expect(rows[1].evidence_refs).toBe(1);
  });

  it("caps the aggregate", () => {
    const rows = aggregateJobRows([goalFixture()], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].job_id).toBe("j-2");
  });
});

describe("artifactIdFromRef (v0 defect fix)", () => {
  const id = "art-" + "a".repeat(32);
  it("resolves BOTH bare and artifact:-prefixed refs", () => {
    expect(artifactIdFromRef(id)).toBe(id);
    expect(artifactIdFromRef("artifact:" + id)).toBe(id);
  });
  it("refuses everything else", () => {
    expect(artifactIdFromRef("art-" + "a".repeat(31))).toBeNull();
    expect(artifactIdFromRef("artifact:art-xyz")).toBeNull();
    expect(artifactIdFromRef("note:done")).toBeNull();
    expect(artifactIdFromRef(42)).toBeNull();
    expect(artifactIdFromRef(null)).toBeNull();
  });
});
