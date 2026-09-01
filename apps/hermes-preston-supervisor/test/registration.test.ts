import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Preston Supervisor - plugin registration + render smoke against the
// BUILT bundle (dashboard/dist/index.js), exercising the documented
// Hermes load sequence: SDK global present -> script executes ->
// window.__HERMES_PLUGINS__.register(name, Component). The fake SDK
// implements just enough of the documented surface (React.
// createElement, hooks, components, fetchJSON) to mount the root
// component and walk its tree - no real React needed because the
// plugin renders exclusively through SDK.React.createElement.

const DASH = join(__dirname, "..", "dashboard");
const BUNDLE = join(DASH, "dist", "index.js");

interface Node {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown[];
}

function makeSdk(fetchResults: Record<string, unknown>) {
  const paths: string[] = [];
  const sdk = {
    React: {
      createElement: (
        type: unknown,
        props: Record<string, unknown> | null,
        ...children: unknown[]
      ): Node => ({ type, props, children }),
      Fragment: "fragment",
    },
    hooks: {
      useState: <T>(init: T): [T, (v: T) => void] => [init, () => {}],
      useEffect: () => {},
      useCallback: <T>(fn: T) => fn,
      useMemo: <T>(fn: () => T) => fn(),
      useRef: <T>(init: T) => ({ current: init }),
    },
    components: new Proxy(
      {},
      { get: (_t, name) => `component:${String(name)}` },
    ),
    fetchJSON: async (path: string) => {
      paths.push(path);
      return fetchResults[path] ?? { linked: false, ok: false };
    },
    utils: {},
  };
  return { sdk, paths };
}

// Walk a fake element tree and collect every string that appears.
function strings(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) strings(child, out);
    return out;
  }
  if (typeof node === "object") {
    const n = node as Node;
    strings(n.children, out);
    // Function components in the tree are invoked with their props to
    // keep the walk honest (SupervisorFeed, detail views).
    if (typeof n.type === "function") {
      try {
        strings((n.type as (p: unknown) => unknown)(n.props ?? {}), out);
      } catch {
        out.push(`__render_error:${String(n.type)}`);
      }
    }
  }
  return out;
}

let registered: Record<string, unknown> = {};

beforeAll(() => {
  const code = readFileSync(BUNDLE, "utf8");
  registered = {};
  const { sdk } = makeSdk({});
  const windowObject = {
    __HERMES_PLUGIN_SDK__: sdk,
    __HERMES_PLUGINS__: {
      register: (name: string, component: unknown) => {
        registered[name] = component;
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  // Execute the IIFE exactly as the dashboard would: with `window`
  // in scope carrying the SDK + registry globals.
  // eslint-disable-next-line no-new-func
  new Function("window", code)(windowObject);
});

describe("plugin registration (documented Hermes load sequence)", () => {
  it("the built bundle exists (run npm run build first)", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("registers under the manifest name with a component", () => {
    const manifest = JSON.parse(
      readFileSync(join(DASH, "manifest.json"), "utf8"),
    ) as { name: string; entry: string; css?: string };
    expect(Object.keys(registered)).toEqual([manifest.name]);
    expect(typeof registered[manifest.name]).toBe("function");
    expect(existsSync(join(DASH, manifest.entry))).toBe(true);
    if (manifest.css) {
      expect(existsSync(join(DASH, manifest.css))).toBe(true);
    }
  });

  it("bundle bundles no React of its own (SDK-only)", () => {
    const code = readFileSync(BUNDLE, "utf8");
    expect(code.includes("__HERMES_PLUGIN_SDK__")).toBe(true);
    expect(code.includes("react.production")).toBe(false);
    expect(code.includes("react-dom")).toBe(false);
  });

  it("root component renders the read-only shell without throwing", () => {
    const component = registered["preston-supervisor"] as () => unknown;
    const text = strings(component()).join(" | ");
    expect(text).toContain("Preston");
    expect(text).toContain("READ ONLY");
    expect(text).not.toContain("__render_error");
    // Loading state on first paint: nothing invented before data.
    expect(text).toContain("loading Preston status...");
    // No decision affordances exist anywhere in the shell.
    for (const banned of ["Approve", "Reject", "Cancel goal"]) {
      expect(text.includes(banned)).toBe(false);
    }
  });
});
