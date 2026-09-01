// Preston Supervisor - goal / job / artifact inspection views.
// READ ONLY: each view renders exactly what the corresponding Preston
// Control read reports. Missing telemetry renders as UNKNOWN - never
// inferred. No approve, reject, cancel, or submit control exists.

import { h, sdk } from "../sdk";
import { readOp } from "../domain/api";
import {
  artifactIdFromRef,
  type ApprovalWire,
  type GoalDetailWire,
} from "../domain/view-models";
import {
  idLink,
  kv,
  note,
  section,
  shortId,
  table,
  toneBadge,
} from "./bits";

export interface Nav {
  onOpenGoal: (id: string) => void;
  onOpenJob: (id: string) => void;
  onOpenArtifact: (id: string) => void;
  onBack: () => void;
}

type Loaded<T> =
  | { state: "loading" }
  | { state: "failed"; error: string }
  | { state: "ok"; data: T };

function useRead<T>(path: string): Loaded<T> {
  const { hooks } = sdk();
  const [value, setValue] = hooks.useState<Loaded<T>>({
    state: "loading",
  });
  hooks.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await readOp<T>(path);
      if (cancelled) return;
      if (res.kind === "ok") setValue({ state: "ok", data: res.data });
      else if (res.kind === "unconfigured") {
        setValue({
          state: "failed",
          error: "preston_link_not_configured",
        });
      } else setValue({ state: "failed", error: res.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);
  return value;
}

function backBar(nav: Nav, label: string): unknown {
  return h(
    "div",
    { className: "ps-row ps-gap" },
    idLink("back to overview", nav.onBack),
    toneBadge("READ ONLY", "muted"),
    h("span", { className: "ps-muted" }, label),
  );
}

function evidenceRefCell(ref: unknown, nav: Nav): unknown {
  const artifactId = artifactIdFromRef(ref);
  return artifactId
    ? idLink(String(ref), () => nav.onOpenArtifact(artifactId))
    : h("span", { className: "ps-mono" }, String(ref));
}

function approvalLine(a: ApprovalWire): unknown {
  return h(
    "div",
    { key: a.approval_id, className: "ps-feed-row" },
    h("span", { className: "ps-mono" }, a.approval_id),
    toneBadge(a.risk_class, a.risk_class === "RED" ? "danger" : "warn"),
    h("span", null, a.action),
    h(
      "span",
      { className: "ps-muted" },
      `reason: ${a.reason} | env: ${a.environment} | expires: ` +
        a.expires_at +
        (a.decision_open ? "" : " (expired)"),
    ),
  );
}

export function GoalView(props: { id: string; nav: Nav }): unknown {
  const res = useRead<GoalDetailWire>(`/goals/${props.id}`);
  if (res.state === "loading") return note("loading goal...");
  if (res.state === "failed") {
    return note(`goal not readable: ${res.error}`, "warn");
  }
  const d = res.data;
  if (!d.found || !d.goal) {
    return note(`goal not readable: ${d.error ?? "not_found"}`, "warn");
  }
  const g = d.goal;
  const jobs = d.jobs ?? [];
  const evidence = d.evidence_refs ?? [];
  return h(
    "div",
    { className: "ps-stack" },
    backBar(props.nav, `goal ${shortId(g.goal_id)}`),
    section(
      g.title || "(untitled goal)",
      g.status,
      h("p", { className: "ps-body" }, g.objective),
      h(
        "div",
        { className: "ps-kv-grid" },
        kv("goal_id", g.goal_id),
        kv("environment", g.environment),
        kv("source", g.source),
        kv("requested_by", g.requested_by),
        kv("created_at", g.created_at),
        kv("updated_at", g.updated_at),
        kv("correlation_id", g.correlation_id),
        kv("simulation_only", String(g.simulation_only)),
      ),
      d.parent_goal_id
        ? h(
            "div",
            null,
            "parent goal: ",
            idLink(d.parent_goal_id, () =>
              props.nav.onOpenGoal(d.parent_goal_id as string),
            ),
          )
        : null,
      ...(d.child_goal_ids ?? []).map((childId) =>
        h(
          "div",
          { key: childId },
          "child goal: ",
          idLink(childId, () => props.nav.onOpenGoal(childId)),
        ),
      ),
    ),
    section(
      "Jobs",
      d.jobs_read_ok === true ? null : "jobs read failed - may be incomplete",
      jobs.length === 0
        ? note("no jobs recorded")
        : table(
            ["Job", "Kind", "Role", "Status", "Risk", "Attempts", "Failure"],
            jobs.map((j) => [
              idLink(`${j.title || "(untitled)"} [${shortId(j.job_id)}]`, () =>
                props.nav.onOpenJob(j.job_id),
              ),
              j.kind,
              j.assigned_role ?? "UNKNOWN",
              toneBadge(j.status),
              j.risk_class,
              String(j.attempts),
              j.failure_reason ?? "",
            ]),
            (index) => jobs[index].job_id,
          ),
    ),
    section(
      "Pending approvals",
      "DISPLAY ONLY",
      (d.pending_approvals ?? []).length === 0
        ? note("no pending approvals for this goal")
        : h(
            "div",
            null,
            ...(d.pending_approvals ?? []).map(approvalLine),
          ),
    ),
    section(
      "Evidence",
      null,
      evidence.length === 0
        ? note("no evidence recorded")
        : h(
            "div",
            { className: "ps-stack-sm" },
            ...evidence.map((item, index) =>
              h(
                "div",
                { key: String(index), className: "ps-row ps-gap" },
                idLink(`job ${shortId(item.job_id)}`, () =>
                  props.nav.onOpenJob(item.job_id),
                ),
                evidenceRefCell(item.ref, props.nav),
              ),
            ),
          ),
    ),
  );
}

interface JobDetailWire {
  found: boolean;
  error?: string;
  job?: {
    job_id: string;
    goal_id: string;
    kind: string;
    title: string;
    objective: string;
    status: string;
    risk_class: string;
    assigned_role: string | null;
    attempts: number;
    requires_approval: boolean;
    failure_reason: string | null;
    updated_at: string;
  };
  run?: { active: boolean; lease_expires_at: string | null };
  approval?: ApprovalWire | null;
  result_reports?: Array<{
    attempt: number;
    outcome: string;
    executed: boolean;
    mode: string;
    provider_role: string;
    summary: string;
    failure_reason: string | null;
    files_changed: string[];
    evidence_refs: unknown[];
    provider_model: string | null;
    duration_ms: number | null;
    recorded_at: string;
  }>;
  result_reports_read_ok?: boolean;
}

export function JobView(props: { id: string; nav: Nav }): unknown {
  const res = useRead<JobDetailWire>(`/jobs/${props.id}`);
  if (res.state === "loading") return note("loading job...");
  if (res.state === "failed") {
    return note(`job not readable: ${res.error}`, "warn");
  }
  const d = res.data;
  if (!d.found || !d.job) {
    return note(`job not readable: ${d.error ?? "not_found"}`, "warn");
  }
  const j = d.job;
  const reports = d.result_reports ?? [];
  return h(
    "div",
    { className: "ps-stack" },
    backBar(props.nav, `job ${shortId(j.job_id)}`),
    section(
      j.title || "(untitled job)",
      j.status,
      h("p", { className: "ps-body" }, j.objective),
      h(
        "div",
        { className: "ps-kv-grid" },
        kv("job_id", j.job_id),
        kv("kind", j.kind),
        kv("assigned_role", j.assigned_role ?? "UNKNOWN"),
        kv("risk_class", j.risk_class),
        kv("attempts", String(j.attempts)),
        kv("requires_approval", String(j.requires_approval)),
        kv(
          "run active",
          String(d.run?.active ?? "UNKNOWN") +
            (d.run?.lease_expires_at
              ? ` (lease expires ${d.run.lease_expires_at})`
              : ""),
        ),
        kv("updated_at", j.updated_at),
      ),
      h(
        "div",
        null,
        "goal: ",
        idLink(shortId(j.goal_id), () =>
          props.nav.onOpenGoal(j.goal_id),
        ),
      ),
      j.failure_reason
        ? note(`failure: ${j.failure_reason}`, "danger")
        : null,
    ),
    d.approval
      ? section(
          "Related approval",
          "DISPLAY ONLY - decide in Preston Control",
          approvalLine(d.approval),
        )
      : null,
    section(
      "Result reports",
      d.result_reports_read_ok === true
        ? null
        : "reports read failed - UNKNOWN",
      reports.length === 0
        ? note(
            "no result reports recorded (a normal state until the " +
              "runtime records one for this job)",
          )
        : h(
            "div",
            { className: "ps-stack-sm" },
            ...reports.map((r) =>
              h(
                "div",
                { key: String(r.attempt), className: "ps-report" },
                h(
                  "div",
                  { className: "ps-row ps-gap" },
                  toneBadge(`attempt ${r.attempt}`, "muted"),
                  toneBadge(
                    r.outcome || "UNKNOWN",
                    r.outcome === "completed" ? "ok" : "danger",
                  ),
                  h("span", null, `mode: ${r.mode || "UNKNOWN"}`),
                  h(
                    "span",
                    null,
                    `model: ${r.provider_model ?? "UNKNOWN"}`,
                  ),
                  h(
                    "span",
                    null,
                    "duration: " +
                      (r.duration_ms === null
                        ? "UNKNOWN"
                        : `${r.duration_ms}ms`),
                  ),
                  h(
                    "span",
                    { className: "ps-muted" },
                    `recorded ${r.recorded_at}`,
                  ),
                ),
                h("p", { className: "ps-body" }, r.summary),
                r.failure_reason
                  ? note(`failure: ${r.failure_reason}`, "danger")
                  : null,
                r.files_changed.length > 0
                  ? h(
                      "div",
                      { className: "ps-muted" },
                      "files changed: ",
                      h(
                        "span",
                        { className: "ps-mono" },
                        r.files_changed.join(", "),
                      ),
                    )
                  : null,
                ...r.evidence_refs.map((ref, index) =>
                  h(
                    "div",
                    { key: String(index) },
                    evidenceRefCell(ref, props.nav),
                  ),
                ),
              ),
            ),
          ),
    ),
  );
}

interface ArtifactWire {
  found: boolean;
  error?: string;
  artifact?: Record<string, unknown>;
  retrieval?: string;
  signed_url?: string | null;
  signed_url_expires_in_seconds?: number | null;
}

export function ArtifactView(props: { id: string; nav: Nav }): unknown {
  const res = useRead<ArtifactWire>(`/artifacts/${props.id}`);
  if (res.state === "loading") return note("loading artifact...");
  if (res.state === "failed") {
    return note(`artifact not readable: ${res.error}`, "warn");
  }
  const d = res.data;
  if (!d.found || !d.artifact) {
    return note(
      `artifact not readable: ${d.error ?? "not_found"}`,
      "warn",
    );
  }
  const a = d.artifact;
  const str = (key: string) => String(a[key] ?? "UNKNOWN");
  return h(
    "div",
    { className: "ps-stack" },
    backBar(props.nav, `artifact ${String(a["artifact_id"] ?? "")}`),
    section(
      String(a["name"] ?? "(unnamed artifact)"),
      null,
      h(
        "div",
        { className: "ps-kv-grid" },
        kv("artifact_id", str("artifact_id")),
        kv("type", str("artifact_type")),
        kv("mime_type", str("mime_type")),
        kv("size_bytes", str("size_bytes")),
        kv("sha256", str("sha256")),
        kv("environment", str("environment")),
        kv("classification", str("classification")),
        kv("retention_state", str("retention_state")),
        kv("created_by", str("created_by")),
        kv("provider", a["provider"] == null ? "UNKNOWN" : str("provider")),
        kv(
          "commit_sha",
          a["commit_sha"] == null ? "UNKNOWN" : str("commit_sha"),
        ),
        kv("created_at", str("created_at")),
      ),
      h(
        "div",
        { className: "ps-row ps-gap" },
        "goal: ",
        idLink(shortId(String(a["goal_id"] ?? "")), () =>
          props.nav.onOpenGoal(String(a["goal_id"] ?? "")),
        ),
        "job: ",
        idLink(shortId(String(a["job_id"] ?? "")), () =>
          props.nav.onOpenJob(String(a["job_id"] ?? "")),
        ),
      ),
    ),
    section(
      "Retrieval",
      null,
      d.retrieval === "ok" && d.signed_url
        ? h(
            "p",
            null,
            h(
              "a",
              {
                href: d.signed_url,
                className: "ps-link",
                target: "_blank",
                rel: "noreferrer",
              },
              "open artifact",
            ),
            h(
              "span",
              { className: "ps-muted" },
              ` (signed link, expires in ` +
                `${d.signed_url_expires_in_seconds ?? "?"}s; reopen ` +
                "this view to mint a fresh one - links are never stored)",
            ),
          )
        : note(
            "no retrieval link: " +
              (d.retrieval === "retention_not_active"
                ? "retention state is not active"
                : "storage unavailable on this surface"),
            "warn",
          ),
    ),
  );
}
