// Preston Supervisor - live supervisor feed + in-dashboard
// notification center, ported from the staging-verified reference.
// READ-ONLY observation: polls the plugin backend (preston_poll_events
// underneath) on an interval, persists the opaque cursor per Preston
// environment, deduplicates by deterministic event id, and treats
// cursor_invalid as a VISIBLE re-anchor state - never an empty feed,
// never a silent replay of history into fresh notifications.

import { h, sdk } from "../sdk";
import { readOp } from "../domain/api";
import {
  cursorStorageKey,
  deriveNotifications,
  isSubmitRejection,
  mergePage,
  type FeedEntry,
  type FeedPage,
  type FeedWindow,
  type HermesNotification,
} from "../domain/feed";
import { idLink, note, section, shortId, toneBadge } from "./bits";

const POLL_MS = 15000;
const PAGE_LIMIT = 50;
const MAX_PAGES_PER_TICK = 5;
const NOTIFY_CAP = 50;

type Phase = "anchoring" | "live" | "reanchor_required" | "error";

function readCursor(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeCursor(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the feed still works, anchoring each load.
  }
}

const CLASS_LABEL: Record<string, string> = {
  completed: "job completed",
  failed: "job failed",
  timed_out: "timed out",
  dead_lettered: "dead-lettered",
  approval_required: "approval required",
  submit_rejected: "submit rejected",
};

const CLASS_TONE: Record<string, string> = {
  completed: "ok",
  failed: "danger",
  timed_out: "warn",
  dead_lettered: "danger",
  approval_required: "approval",
  submit_rejected: "intake",
};

export interface FeedProps {
  environment: string;
  onOpenGoal: (id: string) => void;
  onOpenJob: (id: string) => void;
}

export function SupervisorFeed(props: FeedProps): unknown {
  const { hooks } = sdk();
  const [entries, setEntries] = hooks.useState<FeedEntry[]>([]);
  const [notifications, setNotifications] = hooks.useState<
    HermesNotification[]
  >([]);
  const [phase, setPhase] = hooks.useState<Phase>("anchoring");
  const [lastRefresh, setLastRefresh] = hooks.useState<string | null>(
    null,
  );
  const [feedWindow, setFeedWindow] = hooks.useState<FeedWindow | null>(
    null,
  );
  const [unmapped, setUnmapped] = hooks.useState<number | null>(null);
  const [message, setMessage] = hooks.useState<string | null>(null);

  const storageKey = cursorStorageKey(props.environment);
  const cursorRef = hooks.useRef<string | null>(null);
  const backfillRef = hooks.useRef(true);
  const busyRef = hooks.useRef(false);
  const phaseRef = hooks.useRef<Phase>("anchoring");
  const entriesRef = hooks.useRef<FeedEntry[]>([]);

  const setPhaseBoth = hooks.useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const poll = hooks.useCallback(async () => {
    if (busyRef.current) return;
    if (phaseRef.current === "reanchor_required") return;
    busyRef.current = true;
    try {
      for (let i = 0; i < MAX_PAGES_PER_TICK; i++) {
        const params = new URLSearchParams({
          limit: String(PAGE_LIMIT),
        });
        if (cursorRef.current) params.set("cursor", cursorRef.current);
        const res = await readOp<FeedPage>(`/events?${params}`);
        if (res.kind === "unconfigured") {
          setPhaseBoth("error");
          setMessage("Preston link not configured (fail closed)");
          return;
        }
        if (res.kind === "error") {
          if (res.error === "cursor_invalid") {
            setPhaseBoth("reanchor_required");
            setMessage(
              "stored feed cursor is invalid - re-anchor to resume",
            );
          } else {
            setPhaseBoth("error");
            setMessage(`feed read failed: ${res.error}`);
          }
          return;
        }
        const page = res.data;
        if (!page.ok) {
          // Platform verdict (distinct from transport): cursor_invalid
          // is NOT an empty feed and NEVER silently reset.
          if (page.error === "cursor_invalid") {
            setPhaseBoth("reanchor_required");
            setMessage(
              "stored feed cursor is invalid - re-anchor to resume",
            );
          } else {
            setPhaseBoth("error");
            setMessage(`feed read failed: ${page.error ?? "unknown"}`);
          }
          return;
        }
        const events = page.events ?? [];
        const receivedAt = new Date().toISOString();
        const merged = mergePage(entriesRef.current, events, {
          backfill: backfillRef.current,
          receivedAt,
        });
        entriesRef.current = merged.entries;
        setEntries(merged.entries);
        const fresh = deriveNotifications(merged.added);
        if (fresh.length > 0) {
          setNotifications((n) =>
            [...fresh].reverse().concat(n).slice(0, NOTIFY_CAP),
          );
        }
        if (page.next_cursor) {
          cursorRef.current = page.next_cursor;
          writeCursor(storageKey, page.next_cursor);
        }
        if (page.window) setFeedWindow(page.window);
        if (typeof page.unmapped_states === "number") {
          setUnmapped(page.unmapped_states);
        }
        setLastRefresh(page.generated_at ?? receivedAt);
        if (events.length < PAGE_LIMIT) break;
      }
      backfillRef.current = false;
      setPhaseBoth("live");
      setMessage(null);
    } finally {
      busyRef.current = false;
    }
  }, [storageKey, setPhaseBoth]);

  hooks.useEffect(() => {
    cursorRef.current = readCursor(storageKey);
    // No stored cursor => the first drain replays window HISTORY
    // (backfill), which must never turn into notifications.
    backfillRef.current = cursorRef.current === null;
    const kickoff = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => {
      if (phaseRef.current !== "reanchor_required") void poll();
    }, POLL_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [poll, storageKey]);

  const reanchor = hooks.useCallback(() => {
    cursorRef.current = null;
    writeCursor(storageKey, null);
    backfillRef.current = true;
    setPhaseBoth("anchoring");
    setMessage(
      "re-anchoring: replayed window history is marked, not notified",
    );
    void poll();
  }, [poll, storageKey, setPhaseBoth]);

  const newestFirst = [...entries].reverse();
  const phaseLabel =
    phase === "live"
      ? "LIVE"
      : phase === "anchoring"
        ? "ANCHORING"
        : phase === "reanchor_required"
          ? "RE-ANCHOR REQUIRED"
          : "FEED ERROR";
  const phaseTone =
    phase === "live" ? "ok" : phase === "anchoring" ? "muted" : "warn";

  const feedRows = newestFirst.map((entry) => {
    const e = entry.event;
    const rejected = isSubmitRejection(e);
    return h(
      "div",
      {
        key: e.event_id,
        className: "ps-feed-row" + (entry.backfill ? " ps-dim" : ""),
      },
      toneBadge(e.kind),
      entry.backfill ? toneBadge("history", "muted") : null,
      h("span", { className: "ps-ts" }, e.occurred_at),
      rejected
        ? h(
            "span",
            { className: "ps-intake-note" },
            "submit-time rejection (never entered the runtime)" +
              (e.correlation_id ? ` - ${e.correlation_id}` : ""),
          )
        : h(
            "span",
            { className: "ps-ids" },
            e.goal_id
              ? idLink(`goal ${shortId(e.goal_id)}`, () =>
                  props.onOpenGoal(e.goal_id as string),
                )
              : null,
            " ",
            e.job_id
              ? idLink(`job ${shortId(e.job_id)}`, () =>
                  props.onOpenJob(e.job_id as string),
                )
              : null,
          ),
      e.provider_role
        ? h("span", { className: "ps-muted" }, e.provider_role)
        : null,
      e.failure_reason
        ? h("span", { className: "ps-danger" }, e.failure_reason)
        : null,
    );
  });

  const w = feedWindow;
  const bool = (v: boolean | undefined, yes: string, no: string) =>
    w ? (v ? yes : no) : "UNKNOWN";
  const diagnostics =
    `window: goals covered ${w ? w.goals_covered : "UNKNOWN"}` +
    ` | goals ${w ? w.goals_state : "UNKNOWN"}` +
    ` | jobs ${w ? w.jobs_state : "UNKNOWN"}` +
    ` | approvals ${w ? w.approvals_state : "UNKNOWN"}` +
    ` | controls ${bool(w?.controls_readable, "readable", "UNREADABLE")}` +
    ` | rejections ${bool(w?.rejections_readable, "readable", "UNREADABLE")}` +
    ` | migration ${bool(w?.migration_applied, "applied", "ABSENT")}` +
    ` | unmapped states ${unmapped === null ? "UNKNOWN" : unmapped}`;

  const feedCard = section(
    "Supervisor activity",
    null,
    h(
      "div",
      { className: "ps-row ps-gap" },
      toneBadge(phaseLabel, phaseTone),
      lastRefresh
        ? h("span", { className: "ps-muted" }, `last refresh ${lastRefresh}`)
        : null,
    ),
    message ? note(message, "warn") : null,
    phase === "reanchor_required"
      ? h(
          "button",
          {
            className: "ps-btn ps-btn-warn",
            onClick: reanchor,
            type: "button",
          },
          "Re-anchor feed",
        )
      : null,
    newestFirst.length === 0
      ? note("no events in the covered window yet")
      : h("div", { className: "ps-feed" }, ...feedRows),
    h("p", { className: "ps-diagnostics" }, diagnostics),
  );

  const notificationCard = section(
    `Notifications (${notifications.length})`,
    "IN-DASHBOARD ONLY",
    note(
      "derived from authoritative supervisor events. External " +
        "delivery (Telegram/SMS/email/push) is a later owner-gated " +
        "slice and is NOT active.",
    ),
    notifications.length > 0
      ? h(
          "button",
          {
            className: "ps-btn",
            onClick: () => setNotifications([]),
            type: "button",
          },
          "Clear",
        )
      : null,
    notifications.length === 0
      ? note("no new notifications since this page opened")
      : h(
          "div",
          { className: "ps-feed" },
          ...notifications.map((n) =>
            h(
              "div",
              { key: n.id, className: "ps-feed-row" },
              toneBadge(CLASS_LABEL[n.cls] ?? n.cls, CLASS_TONE[n.cls]),
              h("span", { className: "ps-ts" }, n.occurred_at),
              h(
                "span",
                { className: "ps-ids" },
                n.goal_id ? `goal ${shortId(n.goal_id)} ` : "",
                n.job_id ? `job ${shortId(n.job_id)} ` : "",
                n.approval_id ? `approval ${n.approval_id}` : "",
              ),
              n.failure_reason
                ? h("span", { className: "ps-danger" }, n.failure_reason)
                : null,
            ),
          ),
        ),
  );

  return h(
    "div",
    { className: "ps-grid-2" },
    feedCard,
    notificationCard,
  );
}
