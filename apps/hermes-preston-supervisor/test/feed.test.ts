import { describe, expect, it } from "vitest";
import {
  FEED_CAP,
  cursorStorageKey,
  deriveNotifications,
  isSubmitRejection,
  mergePage,
  type FeedEntry,
  type FeedEvent,
} from "../dashboard/src/domain/feed";

// Ported from the staging-verified reference suite
// (feature/hermes-dashboard test/hermes-feed.test.ts). Pins:
// deterministic-id dedup, backfill suppression (the cursor_invalid /
// re-anchor discipline depends on it), the notification class map
// (submit rejections stay distinct from runtime failures), and
// per-environment cursor keys.

function ev(over: Partial<FeedEvent>): FeedEvent {
  return {
    event_id: "sup:job:j-1:completed:1000",
    kind: "completed",
    occurred_at: "2026-08-31T10:00:00.000Z",
    goal_id: "g-1",
    job_id: "j-1",
    job_kind: "code",
    prior_state: "running",
    new_state: "completed",
    provider_role: "claude",
    risk_class: "GREEN",
    requires_approval: false,
    approval_id: null,
    failure_reason: null,
    evidence_refs: [],
    correlation_id: "c-1",
    ...over,
  };
}

const AT = "2026-08-31T12:00:00.000Z";

describe("mergePage", () => {
  it("deduplicates by deterministic event id across pages", () => {
    const first = mergePage([], [ev({}), ev({})], {
      backfill: false,
      receivedAt: AT,
    });
    expect(first.entries).toHaveLength(1);
    const second = mergePage(first.entries, [ev({})], {
      backfill: false,
      receivedAt: AT,
    });
    expect(second.entries).toHaveLength(1);
    expect(second.added).toHaveLength(0);
  });

  it("drops malformed events without an id", () => {
    const bad = { ...ev({}), event_id: "" };
    const out = mergePage([], [bad], { backfill: false, receivedAt: AT });
    expect(out.entries).toHaveLength(0);
  });

  it("marks entries with the backfill flag they arrived under", () => {
    const anchor = mergePage([], [ev({})], {
      backfill: true,
      receivedAt: AT,
    });
    expect(anchor.entries[0].backfill).toBe(true);
    const live = mergePage(
      anchor.entries,
      [ev({ event_id: "sup:job:j-2:completed:2000", job_id: "j-2" })],
      { backfill: false, receivedAt: AT },
    );
    expect(live.added[0].backfill).toBe(false);
  });

  it("caps the feed at FEED_CAP keeping the newest entries", () => {
    let entries: FeedEntry[] = [];
    for (let i = 0; i < FEED_CAP + 25; i++) {
      const r = mergePage(
        entries,
        [ev({ event_id: `sup:job:j-${i}:completed:${i}` })],
        { backfill: false, receivedAt: AT },
      );
      entries = r.entries;
    }
    expect(entries).toHaveLength(FEED_CAP);
    expect(entries[entries.length - 1].event.event_id).toBe(
      `sup:job:j-${FEED_CAP + 24}:completed:${FEED_CAP + 24}`,
    );
  });
});

describe("deriveNotifications", () => {
  const mk = (kind: string, id: string, backfill = false): FeedEntry => ({
    event: ev({ event_id: id, kind }),
    backfill,
    received_at: AT,
  });

  it("maps the notification classes from authoritative kinds only", () => {
    const added = [
      mk("completed", "e1"),
      mk("failed", "e2"),
      mk("timed_out", "e3"),
      mk("dead_lettered", "e4"),
      mk("kind_not_eligible", "e5"),
      mk("approval_required", "e6"),
      mk("submit_rejected", "e7"),
      mk("task_kind_unresolved", "e8"),
      mk("queued", "e9"),
      mk("running", "e10"),
      mk("paused", "e11"),
    ];
    expect(deriveNotifications(added).map((n) => n.cls)).toEqual([
      "completed",
      "failed",
      "timed_out",
      "dead_lettered",
      "dead_lettered",
      "approval_required",
      "submit_rejected",
      "submit_rejected",
    ]);
  });

  it("NEVER notifies from backfill entries (re-anchor discipline)", () => {
    expect(
      deriveNotifications([
        mk("failed", "e1", true),
        mk("dead_lettered", "e2", true),
      ]),
    ).toEqual([]);
  });

  it("carries ids and reason codes for display", () => {
    const entry: FeedEntry = {
      event: ev({
        event_id: "sup:rej:req-1",
        kind: "submit_rejected",
        new_state: "submit_rejected",
        goal_id: null,
        job_id: null,
        failure_reason: "secret_in_request",
      }),
      backfill: false,
      received_at: AT,
    };
    const out = deriveNotifications([entry]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sup:rej:req-1");
    expect(out[0].goal_id).toBeNull();
    expect(out[0].failure_reason).toBe("secret_in_request");
  });
});

describe("isSubmitRejection", () => {
  it("distinguishes submit-time rejection from runtime failure", () => {
    expect(
      isSubmitRejection(
        ev({ kind: "submit_rejected", new_state: "submit_rejected" }),
      ),
    ).toBe(true);
    expect(
      isSubmitRejection(
        ev({
          kind: "task_kind_unresolved",
          new_state: "submit_rejected",
        }),
      ),
    ).toBe(true);
    expect(
      isSubmitRejection(ev({ kind: "failed", new_state: "failed" })),
    ).toBe(false);
  });
});

describe("cursorStorageKey", () => {
  it("scopes the cursor per Preston environment", () => {
    expect(cursorStorageKey("staging")).toBe(
      "hermes-preston.cursor.staging",
    );
    expect(cursorStorageKey("production")).toBe(
      "hermes-preston.cursor.production",
    );
  });

  it("sanitizes unexpected environment strings", () => {
    expect(cursorStorageKey("")).toBe("hermes-preston.cursor.unknown");
    expect(cursorStorageKey("We!rd Env")).toBe(
      "hermes-preston.cursor.unknown",
    );
  });
});
