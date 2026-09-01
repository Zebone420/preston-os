// Preston Supervisor - root tab. READ-ONLY observation surface above
// Preston Control, rendered as a first-class Hermes dashboard module.
// Every number comes from the supported Preston Control reads via the
// plugin backend; nothing here executes, approves, cancels, submits,
// or writes. Unknown renders as UNKNOWN, never an invented zero.

import { h, sdk } from "../sdk";
import { readLink, readOp, type LinkState } from "../domain/api";
import {
  aggregateJobRows,
  toGoalCard,
  toHeader,
  toMetrics,
  type ApprovalWire,
  type GoalDetailWire,
  type StatusWire,
} from "../domain/view-models";
import {
  flagBadge,
  idLink,
  metricCard,
  note,
  section,
  shortId,
  table,
  toneBadge,
} from "./bits";
import { ArtifactView, GoalView, JobView, type Nav } from "./detail";
import { SupervisorFeed } from "./feed";

const GOAL_DETAIL_LIMIT = 6;

type View =
  | { kind: "overview" }
  | { kind: "goal"; id: string }
  | { kind: "job"; id: string }
  | { kind: "artifact"; id: string };

interface OverviewData {
  status: StatusWire;
  approvals: { read_ok: boolean; approvals: ApprovalWire[] };
  details: GoalDetailWire[];
}

type OverviewState =
  | { state: "loading" }
  | { state: "unconfigured"; link: LinkState }
  | { state: "failed"; error: string }
  | { state: "ok"; link: LinkState; data: OverviewData };

async function loadOverview(): Promise<OverviewState> {
  const link = await readLink();
  const statusRes = await readOp<StatusWire>("/status");
  if (statusRes.kind === "unconfigured") {
    return { state: "unconfigured", link };
  }
  if (statusRes.kind === "error") {
    return { state: "failed", error: statusRes.error };
  }
  const approvalsRes = await readOp<{
    read_ok: boolean;
    approvals: ApprovalWire[];
  }>("/approvals");
  const approvals =
    approvalsRes.kind === "ok"
      ? approvalsRes.data
      : { read_ok: false, approvals: [] };
  const recent = statusRes.data.recent_goals.slice(0, GOAL_DETAIL_LIMIT);
  const details: GoalDetailWire[] = [];
  for (const g of recent) {
    const d = await readOp<GoalDetailWire>(`/goals/${g.goal_id}`);
    if (d.kind === "ok") details.push(d.data);
  }
  return {
    state: "ok",
    link,
    data: { status: statusRes.data, approvals, details },
  };
}

function overviewBody(data: OverviewData, nav: Nav): unknown[] {
  const header = toHeader(data.status);
  const metrics = toMetrics(data.status);
  const goalCards = data.details
    .filter((d) => d.found && d.goal)
    .map(toGoalCard);
  const jobRows = aggregateJobRows(data.details);
  const approvals = data.approvals;

  const systemCard = section(
    "System",
    null,
    h(
      "div",
      { className: "ps-row ps-gap ps-wrap" },
      toneBadge(`env: ${header.environment}`, "muted"),
      toneBadge(
        `posture: ${header.posture}`,
        header.posture === "operating" ? "ok" : "warn",
      ),
      header.controls_readable
        ? null
        : toneBadge("controls UNREADABLE - fail-closed values", "warn"),
      flagBadge("execution", header.execution_enabled, true),
      flagBadge("remote_runner", header.remote_runner_enabled, true),
      flagBadge("owner_stop", header.owner_stop, true),
      flagBadge("paused", header.paused, true),
      toneBadge(`hermes_mode: ${header.hermes_mode}`, "muted"),
      h(
        "span",
        { className: "ps-muted" },
        `as of ${header.generated_at}`,
      ),
    ),
  );

  const metricsRow = h(
    "div",
    { className: "ps-metric-grid" },
    metricCard("Goals", metrics.total_goals),
    metricCard("Running", metrics.running_goals),
    metricCard("Blocked", metrics.blocked_goals),
    metricCard("Pending approvals", metrics.pending_approvals),
    metricCard("Failed", metrics.failed_jobs),
    metricCard("Dead-lettered", metrics.dead_lettered_jobs),
  );

  const attention =
    header.needs_attention.length > 0
      ? section(
          "Needs attention",
          null,
          ...header.needs_attention.map((line) =>
            h("div", { key: line, className: "ps-warn-line" }, line),
          ),
        )
      : null;

  const goalsCard = section(
    "Recent goals",
    `via preston_status + preston_get_goal (${GOAL_DETAIL_LIMIT} most recent)`,
    goalCards.length === 0
      ? note("no goals in the covered window")
      : table(
          ["Goal", "Status", "Created", "Jobs", "Approvals", "Evidence"],
          goalCards.map((g) => [
            idLink(`${g.title || "(untitled)"} [${shortId(g.goal_id)}]`, () =>
              nav.onOpenGoal(g.goal_id),
            ),
            toneBadge(g.status),
            g.created_at,
            String(g.job_total) +
              " " +
              Object.entries(g.job_status_counts)
                .map(([k, v]) => `${k}:${v}`)
                .join(" "),
            String(g.pending_approvals),
            g.evidence_refs > 0 ? `yes (${g.evidence_refs})` : "none",
          ]),
          (index) => goalCards[index].goal_id,
        ),
  );

  const jobsCard = section(
    "Jobs (recent goals)",
    "provider/model + duration appear on job detail when reported",
    jobRows.length === 0
      ? note("no jobs in the covered window")
      : table(
          ["Job", "Role", "Status", "Risk", "Attempts", "Failure"],
          jobRows.map((j) => [
            idLink(`${j.title || j.kind} [${shortId(j.job_id)}]`, () =>
              nav.onOpenJob(j.job_id),
            ),
            j.assigned_role ?? "UNKNOWN",
            toneBadge(j.status),
            j.risk_class,
            String(j.attempts),
            j.failure_reason ?? "",
          ]),
          (index) => jobRows[index].job_id,
        ),
  );

  const approvalsCard = section(
    "Pending owner approvals",
    "DISPLAY ONLY - decisions happen in Preston Control",
    !approvals.read_ok
      ? note("approvals UNREADABLE (fail-closed) - count is UNKNOWN", "warn")
      : approvals.approvals.length === 0
        ? note("no pending approvals")
        : table(
            ["Approval", "Goal / Job", "Action", "Reason", "Risk", "Env",
             "Expires"],
            approvals.approvals.map((a) => [
              h(
                "span",
                { className: "ps-mono" },
                a.approval_id,
                a.decision_open
                  ? ""
                  : h("div", { className: "ps-warn-line" }, "expired"),
              ),
              h(
                "span",
                null,
                a.goal_id
                  ? idLink(shortId(a.goal_id), () =>
                      nav.onOpenGoal(a.goal_id as string),
                    )
                  : "-",
                " / ",
                a.job_id
                  ? idLink(shortId(a.job_id), () =>
                      nav.onOpenJob(a.job_id as string),
                    )
                  : "-",
              ),
              a.action,
              a.reason,
              toneBadge(
                a.risk_class,
                a.risk_class === "RED" ? "danger" : "warn",
              ),
              a.environment,
              a.expires_at,
            ]),
            (index) => approvals.approvals[index].approval_id,
          ),
  );

  const failuresCard = section(
    "Failed jobs",
    null,
    data.status.read_states.jobs !== "ok" &&
      data.status.read_states.jobs !== "empty"
      ? note(
          `jobs bucket ${data.status.read_states.jobs} - listing may ` +
            "be incomplete",
          "warn",
        )
      : null,
    data.status.failures.length === 0
      ? note("no failed jobs in the covered window")
      : h(
          "div",
          { className: "ps-stack-sm" },
          ...data.status.failures.map((j) =>
            h(
              "div",
              { key: j.job_id, className: "ps-feed-row" },
              idLink(`${j.title || j.kind} [${shortId(j.job_id)}]`, () =>
                nav.onOpenJob(j.job_id),
              ),
              h(
                "span",
                { className: "ps-danger" },
                j.failure_reason ?? "no failure reason recorded",
              ),
            ),
          ),
        ),
  );

  const deadCard = section(
    "Dead-lettered jobs",
    "historical dead letters remain visible; they are facts, not noise",
    data.status.dead_letters.length === 0
      ? note("no dead-lettered jobs in the covered window")
      : h(
          "div",
          { className: "ps-stack-sm" },
          ...data.status.dead_letters.map((j) =>
            h(
              "div",
              { key: j.job_id, className: "ps-feed-row" },
              idLink(`${j.title || j.kind} [${shortId(j.job_id)}]`, () =>
                nav.onOpenJob(j.job_id),
              ),
              h(
                "span",
                { className: "ps-danger" },
                j.failure_reason ?? "no failure reason recorded",
              ),
            ),
          ),
        ),
  );

  return [
    systemCard,
    metricsRow,
    attention,
    h("div", { className: "ps-grid-2" }, goalsCard, jobsCard),
    approvalsCard,
    h("div", { className: "ps-grid-2" }, failuresCard, deadCard),
    h(SupervisorFeed as never, {
      environment: header.environment,
      onOpenGoal: nav.onOpenGoal,
      onOpenJob: nav.onOpenJob,
    }),
    note(
      "Preston Supervisor observes through Preston Control only: " +
        "preston_status, preston_get_goal, preston_get_job, " +
        "preston_list_approvals, preston_poll_events, " +
        "preston_get_evidence, preston_get_artifact. It has no " +
        "execution, approval, cancellation, or submission authority.",
    ),
  ];
}

export function PrestonTab(): unknown {
  const { hooks } = sdk();
  const [view, setView] = hooks.useState<View>({ kind: "overview" });
  const [overview, setOverview] = hooks.useState<OverviewState>({
    state: "loading",
  });
  const [reloadToken, setReloadToken] = hooks.useState(0);

  hooks.useEffect(() => {
    let cancelled = false;
    setOverview({ state: "loading" });
    void loadOverview().then((result) => {
      if (!cancelled) setOverview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const nav: Nav = {
    onOpenGoal: (id) => setView({ kind: "goal", id }),
    onOpenJob: (id) => setView({ kind: "job", id }),
    onOpenArtifact: (id) => setView({ kind: "artifact", id }),
    onBack: () => setView({ kind: "overview" }),
  };

  const head = h(
    "div",
    { className: "ps-row ps-gap ps-header" },
    h("h1", { className: "ps-title" }, "Preston"),
    toneBadge("SUPERVISOR v0.1 - READ ONLY", "muted"),
    view.kind === "overview"
      ? h(
          "button",
          {
            className: "ps-btn",
            type: "button",
            onClick: () => setReloadToken(reloadToken + 1),
          },
          "Refresh",
        )
      : null,
  );

  let body: unknown;
  if (view.kind === "goal") {
    body = h(GoalView as never, { id: view.id, nav });
  } else if (view.kind === "job") {
    body = h(JobView as never, { id: view.id, nav });
  } else if (view.kind === "artifact") {
    body = h(ArtifactView as never, { id: view.id, nav });
  } else if (overview.state === "loading") {
    body = note("loading Preston status...");
  } else if (overview.state === "unconfigured") {
    body = section(
      "Preston link",
      "FAIL CLOSED",
      note(
        "Preston Control link is NOT configured on this dashboard " +
          "host. The owner sets the Preston Control URL and access " +
          "credential in the dashboard SERVER environment (names in " +
          "README; values never enter the browser). Until then this " +
          "module shows nothing rather than guessing.",
        "warn",
      ),
    );
  } else if (overview.state === "failed") {
    body = note(`Preston status unreadable: ${overview.error}`, "warn");
  } else {
    body = h(
      "div",
      { className: "ps-stack" },
      ...overviewBody(overview.data, nav),
    );
  }

  return h("div", { className: "ps-root" }, head, body);
}
