// Preston Supervisor DEV HARNESS. Provides a mock of the documented
// window.__HERMES_PLUGIN_SDK__ surface (React + hooks from the real
// React UMD, minimal shadcn-shaped components, fixture-backed
// fetchJSON) so the BUILT plugin bundle renders locally without a
// Hermes install. Visual verification only - never a substitute for
// registration against a real dashboard.

(function () {
  const F = window.__PRESTON_FIXTURES__;
  const R = window.React;
  const unconfigured = new URLSearchParams(location.search).has(
    "unconfigured",
  );

  function card(kind) {
    return function (props) {
      const cls = {
        Card: "hx-card",
        CardHeader: "hx-card-head",
        CardTitle: "hx-card-title",
        CardContent: "hx-card-body",
        Badge: "hx-badge",
        Separator: "hx-sep",
      }[kind] || "";
      const p = Object.assign({}, props, {
        className: cls + " " + (props && props.className ? props.className : ""),
      });
      const children = p.children;
      delete p.children;
      return R.createElement(kind === "Badge" ? "span" : "div", p, children);
    };
  }

  let eventPolls = 0;

  async function fetchJSON(path) {
    const url = new URL(path, location.origin);
    const p = url.pathname;
    const base = "/api/plugins/preston-supervisor";
    if (!p.startsWith(base)) throw new Error("out-of-namespace: " + p);
    const rest = p.slice(base.length);
    const wrap = (data) => ({ linked: true, ok: true, status: 200, data });
    if (unconfigured && rest !== "/link") {
      return { linked: false, ok: false,
        error: "preston_link_not_configured" };
    }
    if (rest === "/link") {
      return unconfigured ? { configured: false, host: "" } : F.link;
    }
    if (rest === "/status") return wrap(F.status);
    if (rest === "/approvals") {
      return wrap({ read_ok: true, approvals: F.APPROVALS });
    }
    if (rest.startsWith("/goals/")) {
      const g = F.goals[rest.slice("/goals/".length)];
      return wrap(g || { found: false, error: "not_found" });
    }
    if (rest.startsWith("/jobs/")) {
      const j = F.jobs[rest.slice("/jobs/".length)];
      return wrap(j || { found: false, error: "not_found" });
    }
    if (rest.startsWith("/artifacts/")) {
      const a = F.artifacts[rest.slice("/artifacts/".length)];
      return wrap(a || { found: false, error: "not_found" });
    }
    if (rest === "/events") {
      const cursor = url.searchParams.get("cursor") || "";
      eventPolls += 1;
      if (cursor && !cursor.startsWith("v1:")) {
        return wrap({ ok: false, error: "cursor_invalid" });
      }
      if (!cursor) {
        return wrap({
          ok: true, generated_at: new Date().toISOString(),
          events: F.EVENTS, next_cursor: F.FINAL_CURSOR,
          window: F.WINDOW, unmapped_states: 0,
        });
      }
      // Advanced cursor: one late event on the second live poll so
      // the notification center fires exactly once; then quiet.
      const late = eventPolls === 2 ? [F.LATE_EVENT] : [];
      return wrap({
        ok: true, generated_at: new Date().toISOString(),
        events: late,
        next_cursor: late.length ? "v1:1788299999000:" +
          late[0].event_id : null,
        window: F.WINDOW, unmapped_states: 0,
      });
    }
    return wrap({ ok: false, error: "unknown_path" });
  }

  window.__HERMES_PLUGIN_SDK__ = {
    React: R,
    hooks: {
      useState: R.useState,
      useEffect: R.useEffect,
      useCallback: R.useCallback,
      useMemo: R.useMemo,
      useRef: R.useRef,
      useContext: R.useContext,
      createContext: R.createContext,
    },
    components: {
      Card: card("Card"),
      CardHeader: card("CardHeader"),
      CardTitle: card("CardTitle"),
      CardContent: card("CardContent"),
      Badge: card("Badge"),
      Separator: card("Separator"),
      Button: card("Badge"),
    },
    fetchJSON,
    utils: {},
  };

  const registered = {};
  window.__HERMES_PLUGINS__ = {
    register: function (name, component) {
      registered[name] = component;
      mount();
    },
    registerSlot: function () {},
  };

  function mount() {
    const component = registered["preston-supervisor"];
    if (!component) return;
    const root = window.ReactDOM.createRoot(
      document.getElementById("plugin-root"),
    );
    root.render(R.createElement(component));
    document.getElementById("harness-state").textContent =
      "plugin registered + mounted" +
      (unconfigured ? " (unconfigured demo)" : " (fixture data)");
  }
})();
