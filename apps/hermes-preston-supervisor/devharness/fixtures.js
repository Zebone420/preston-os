// Preston Supervisor DEV HARNESS fixtures. Recorded from the
// staging-verified reference session (2026-08-31/09-01) - shapes are
// real Preston Control projections; NO live data, NO credentials.
// This file exists only for local visual verification.

const GOAL_A = "2490e615-7c46-467c-adb6-b28a9e1dc093";
const GOAL_B = "cc84434a-2b17-40e9-967d-f3fea5abc97c";
const GOAL_C = "3fe2684c-0000-4000-8000-000000000abc";
const JOB_A = "8da19675-ba1f-42e7-8ab7-73b0a1a8cc7d";
const JOB_B = "0c87b3e5-556f-4569-a8eb-aad4e9d7dc06";
const JOB_C = "da81d49b-0000-4000-8000-000000000abc";
const ART = "art-d6bd44a7c28c6e35c3110fdacbb413b7";

function goal(id, title, status, created) {
  return {
    goal_id: id, title, objective: title + ".", status,
    source: "dashboard", requested_by: "info@preston.nyc",
    environment: "staging", correlation_id: "cmp-harness-" + id.slice(0, 8),
    simulation_only: true, iteration: 0,
    created_at: created, updated_at: created,
  };
}

function job(id, goalId, title, status, risk, attempts, refs) {
  return {
    job_id: id, goal_id: goalId, kind: "audit", title,
    objective: title + ".", status, risk_class: risk,
    assigned_role: "claude", attempts,
    requires_approval: risk === "RED", approval_id: null,
    failure_reason: null, evidence_refs: refs,
    created_at: "2026-08-31T21:10:38.882+00:00",
    updated_at: "2026-08-31T21:10:46.382+00:00",
  };
}

const APPROVALS = [
  {
    approval_id: "apr-cb04e953b2388e5961a2a360",
    goal_id: GOAL_C, job_id: JOB_C,
    action: "code: Fix the deploy script for the dashboard.",
    affected_resource: "repository",
    reason: "composer: task requires owner approval by policy",
    risk_class: "RED", environment: "staging",
    expected_effect: "repository change", rollback_plan: "revert",
    status: "pending",
    created_at: "2026-08-28T22:14:57.772+00:00",
    expires_at: "2026-08-29T22:14:57.724+00:00",
    decided_at: null, decision_open: false,
  },
  {
    approval_id: "apr-ba1793cd5f71c5a473e4f594",
    goal_id: null, job_id: null,
    action: "migration: draft the schema migration plan for owner review.",
    affected_resource: "schema",
    reason: "composer: task requires owner approval by policy",
    risk_class: "YELLOW", environment: "staging",
    expected_effect: "plan only", rollback_plan: "n/a",
    status: "pending",
    created_at: "2026-08-27T01:12:08.216+00:00",
    expires_at: "2026-08-28T01:08:23.521+00:00",
    decided_at: null, decision_open: false,
  },
];

const EVENTS = [
  {
    event_id: "sup:job:" + JOB_B + ":completed:1788207037505",
    kind: "completed",
    occurred_at: "2026-08-31T20:30:37.505+00:00",
    goal_id: GOAL_B, job_id: JOB_B, job_kind: "audit",
    prior_state: "running", new_state: "completed",
    provider_role: "claude", risk_class: "GREEN",
    requires_approval: false, approval_id: null,
    failure_reason: null, evidence_refs: [], correlation_id: "c-1",
  },
  {
    event_id: "sup:rej:supbridge-neg-20260831-1",
    kind: "submit_rejected",
    occurred_at: "2026-08-31T20:30:06.572Z",
    goal_id: null, job_id: null, job_kind: null,
    prior_state: null, new_state: "submit_rejected",
    provider_role: null, risk_class: null,
    requires_approval: null, approval_id: null,
    failure_reason: "ambiguous_request:goal_1_has_no_tasks",
    evidence_refs: [],
    correlation_id: "submit:supbridge-neg-20260831-1",
  },
  {
    event_id: "sup:job:" + JOB_C + ":awaiting_approval:1788207785978",
    kind: "approval_required",
    occurred_at: "2026-08-31T20:43:05.978+00:00",
    goal_id: GOAL_C, job_id: JOB_C, job_kind: "code",
    prior_state: null, new_state: "awaiting_approval",
    provider_role: "claude", risk_class: "RED",
    requires_approval: true,
    approval_id: "apr-cb04e953b2388e5961a2a360",
    failure_reason: null, evidence_refs: [], correlation_id: "c-2",
  },
  {
    event_id: "sup:goal:" + GOAL_C + ":blocked:1788207785978",
    kind: "blocked",
    occurred_at: "2026-08-31T20:43:05.978+00:00",
    goal_id: GOAL_C, job_id: null, job_kind: null,
    prior_state: null, new_state: "blocked",
    provider_role: null, risk_class: null,
    requires_approval: null, approval_id: null,
    failure_reason: null, evidence_refs: [], correlation_id: "c-2",
  },
  {
    // SB-1 same-millisecond pair: running then completed at one ts.
    event_id: "sup:job:" + JOB_A + ":in_progress:1788210646382",
    kind: "running",
    occurred_at: "2026-08-31T21:10:46.382+00:00",
    goal_id: GOAL_A, job_id: JOB_A, job_kind: "audit",
    prior_state: null, new_state: "in_progress",
    provider_role: "claude", risk_class: "GREEN",
    requires_approval: false, approval_id: null,
    failure_reason: null, evidence_refs: [], correlation_id: "c-3",
  },
  {
    event_id: "sup:job:" + JOB_A + ":completed:1788210646382",
    kind: "completed",
    occurred_at: "2026-08-31T21:10:46.382+00:00",
    goal_id: GOAL_A, job_id: JOB_A, job_kind: "audit",
    prior_state: "running", new_state: "completed",
    provider_role: "claude", risk_class: "GREEN",
    requires_approval: false, approval_id: null,
    failure_reason: null,
    evidence_refs: ["artifact:" + ART], correlation_id: "c-3",
  },
];

const WINDOW = {
  goals_covered: 20, goals_state: "ok", jobs_state: "ok",
  approvals_state: "ok", controls_readable: true,
  rejections_readable: true, migration_applied: true,
};

const FINAL_CURSOR = "v1:1788210646382:sup:job:" + JOB_A +
  ":completed:1788210646382";

// A fresh event minted for the SECOND live poll so the notification
// center demonstrably fires exactly once (never from backfill).
const LATE_EVENT = {
  event_id: "sup:job:" + JOB_B + ":completed:1788299999000",
  kind: "completed",
  occurred_at: "2026-09-01T21:59:59.000+00:00",
  goal_id: GOAL_B, job_id: JOB_B, job_kind: "audit",
  prior_state: "running", new_state: "completed",
  provider_role: "claude", risk_class: "GREEN",
  requires_approval: false, approval_id: null,
  failure_reason: null, evidence_refs: [], correlation_id: "c-4",
};

window.__PRESTON_FIXTURES__ = {
  GOAL_A, GOAL_B, GOAL_C, JOB_A, JOB_B, JOB_C, ART,
  FINAL_CURSOR, WINDOW, EVENTS, LATE_EVENT, APPROVALS,
  link: { configured: true, host: "preston-os-staging.vercel.app" },
  status: {
    generated_at: "2026-09-01T01:37:15.909Z",
    environment: "staging",
    posture: "operating",
    controls: {
      readable: true, execution_enabled: true,
      remote_runner_enabled: true, owner_stop: false, paused: false,
      hermes_mode: "observe_only",
      updated_at: "2026-08-31T21:00:00.000Z",
    },
    summary: {
      total_goals: 10, running_goals: 0, blocked_goals: 1,
      open_approvals: 7, failed_jobs: 0, dead_lettered_jobs: 0,
    },
    recent_goals: [
      goal(GOAL_A, "Audit the repository", "completed",
        "2026-08-31T21:10:38.882+00:00"),
      goal(GOAL_B, "Audit the repository", "completed",
        "2026-08-31T20:30:01.673+00:00"),
      goal(GOAL_C, "Fix the deploy script for the dashboard",
        "blocked", "2026-08-28T22:14:57.772+00:00"),
    ],
    pending_approvals: APPROVALS,
    failures: [],
    dead_letters: [],
    read_states: {
      goals: "ok", approvals: "ok", jobs: "ok",
      failures: "ok", dead_letters: "ok",
    },
    needs_attention: [
      "7 approval(s) waiting for the owner",
      "1 blocked goal(s)",
    ],
  },
  goals: {
    [GOAL_A]: {
      found: true,
      goal: goal(GOAL_A, "Audit the repository", "completed",
        "2026-08-31T21:10:38.882+00:00"),
      jobs: [job(JOB_A, GOAL_A, "Audit the repository", "completed",
        "GREEN", 1, ["artifact:" + ART])],
      jobs_read_ok: true,
      job_status_counts: { completed: 1 },
      pending_approvals: [],
      evidence_refs: [{ job_id: JOB_A, ref: "artifact:" + ART }],
      parent_goal_id: null, child_goal_ids: [],
    },
    [GOAL_B]: {
      found: true,
      goal: goal(GOAL_B, "Audit the repository", "completed",
        "2026-08-31T20:30:01.673+00:00"),
      jobs: [job(JOB_B, GOAL_B, "Audit the repository", "completed",
        "GREEN", 1, [])],
      jobs_read_ok: true,
      job_status_counts: { completed: 1 },
      pending_approvals: [], evidence_refs: [],
      parent_goal_id: null, child_goal_ids: [],
    },
    [GOAL_C]: {
      found: true,
      goal: goal(GOAL_C, "Fix the deploy script for the dashboard",
        "blocked", "2026-08-28T22:14:57.772+00:00"),
      jobs: [job(JOB_C, GOAL_C, "Fix the deploy script",
        "awaiting_approval", "RED", 0, [])],
      jobs_read_ok: true,
      job_status_counts: { awaiting_approval: 1 },
      pending_approvals: [APPROVALS[0]], evidence_refs: [],
      parent_goal_id: null, child_goal_ids: [],
    },
  },
  jobs: {
    [JOB_A]: {
      found: true,
      job: job(JOB_A, GOAL_A, "Audit the repository", "completed",
        "GREEN", 1, ["artifact:" + ART]),
      run: { active: false, lease_expires_at: null },
      approval: null,
      result_reports: [{
        attempt: 1, outcome: "completed", executed: true,
        mode: "real", provider_role: "claude",
        summary: "REAL level-1 audit run completed (exit 0, bounded)",
        failure_reason: null,
        files_changed: ["apps/dashboard/docs/AUDIT_G_D3_DASHBOARD_v1.md"],
        evidence_refs: ["artifact:" + ART],
        structured: null, structured_error: null,
        provider_model: null, duration_ms: 378701,
        recorded_at: "2026-08-31T21:17:08.824+00:00",
      }],
      result_reports_read_ok: true,
    },
  },
  artifacts: {
    [ART]: {
      found: true,
      artifact: {
        artifact_id: ART, goal_id: GOAL_A, job_id: JOB_A,
        run_id: JOB_A + ":20dd76b4",
        artifact_type: "document",
        name: "run-report/" + JOB_A + ".md",
        sha256: "a6e7f029b7063c0c8178b3026e26d329ee2e85e6eb7d3315" +
          "c119c9fc571fb43d",
        mime_type: "text/markdown", size_bytes: 2847,
        created_by: "claude", provider: "claude", commit_sha: null,
        environment: "staging", classification: "internal",
        retention_state: "active",
        created_at: "2026-08-31T21:10:46.382+00:00",
      },
      retrieval: "ok",
      signed_url: "#dev-harness-mock-signed-url",
      signed_url_expires_in_seconds: 300,
    },
  },
};
