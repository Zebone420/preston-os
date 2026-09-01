// Preston Supervisor - shared UI atoms built on the Hermes SDK
// component kit (shadcn-style) plus small ps-* classes that lean on
// the dashboard theme variables, so the tab reads as a first-class
// Hermes module in every theme.

import { component, h } from "../sdk";
import type { Metric } from "../domain/view-models";

export function section(
  title: string,
  badgeText: string | null,
  ...children: unknown[]
): unknown {
  return h(
    component("Card"),
    { className: "ps-section" },
    h(
      component("CardHeader"),
      { className: "ps-section-head" },
      h(
        component("CardTitle"),
        { className: "ps-section-title" },
        title,
        badgeText
          ? h(
              component("Badge"),
              { variant: "outline", className: "ps-head-badge" },
              badgeText,
            )
          : null,
      ),
    ),
    h(component("CardContent"), null, ...children),
  );
}

const KIND_TONE: Record<string, string> = {
  queued: "muted",
  running: "info",
  completed: "ok",
  failed: "danger",
  timed_out: "warn",
  dead_lettered: "danger",
  kind_not_eligible: "danger",
  blocked: "warn",
  paused: "warn",
  stopped: "warn",
  approval_required: "approval",
  submit_rejected: "intake",
  task_kind_unresolved: "intake",
};

export function toneBadge(text: string, tone?: string): unknown {
  const t = tone ?? KIND_TONE[text] ?? "muted";
  return h(
    "span",
    { className: `ps-badge ps-tone-${t}` },
    text,
  );
}

export function flagBadge(
  label: string,
  value: boolean,
  dangerWhenTrue: boolean,
): unknown {
  const danger = dangerWhenTrue === value;
  return toneBadge(`${label}: ${String(value)}`, danger ? "danger" : "ok");
}

export function metricCard(label: string, value: Metric): unknown {
  return h(
    "div",
    { className: "ps-metric" },
    h("div", { className: "ps-metric-label" }, label),
    h(
      "div",
      {
        className:
          "ps-metric-value" + (value === "UNKNOWN" ? " ps-unknown" : ""),
      },
      String(value),
    ),
  );
}

export function kv(label: string, value: unknown): unknown {
  return h(
    "div",
    { className: "ps-kv" },
    h("span", { className: "ps-kv-label" }, label),
    h("span", { className: "ps-kv-value" }, String(value ?? "UNKNOWN")),
  );
}

export function idLink(
  text: string,
  onClick: () => void,
): unknown {
  return h(
    "button",
    { className: "ps-link", onClick, type: "button" },
    text,
  );
}

export function note(text: string, tone = "muted"): unknown {
  return h("p", { className: `ps-note ps-note-${tone}` }, text);
}

export function table(
  headers: string[],
  rows: unknown[][],
  keyOf: (index: number) => string,
): unknown {
  return h(
    "div",
    { className: "ps-table-wrap" },
    h(
      "table",
      { className: "ps-table" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          ...headers.map((head) => h("th", { key: head }, head)),
        ),
      ),
      h(
        "tbody",
        null,
        ...rows.map((cells, index) =>
          h(
            "tr",
            { key: keyOf(index) },
            ...cells.map((cell, cellIndex) =>
              h("td", { key: String(cellIndex) }, cell as never),
            ),
          ),
        ),
      ),
    ),
  );
}

export function shortId(id: string | null | undefined): string {
  return id ? String(id).slice(0, 8) : "";
}
