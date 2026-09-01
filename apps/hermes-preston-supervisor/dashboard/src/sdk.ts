// Preston Supervisor - Hermes Plugin SDK bridge. The dashboard shell
// exposes React, hooks, shadcn-style components, and an auth-aware
// fetch on window.__HERMES_PLUGIN_SDK__ (plugins never bundle React).
// This module is the ONLY place that touches the global, so every
// other file stays testable with an injected fake.

export interface HermesSdk {
  React: {
    createElement: (...args: unknown[]) => unknown;
    Fragment: unknown;
  };
  hooks: {
    useState: <T>(init: T) => [T, (v: T | ((p: T) => T)) => void];
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
    useCallback: <T>(fn: T, deps: unknown[]) => T;
    useMemo: <T>(fn: () => T, deps: unknown[]) => T;
    useRef: <T>(init: T) => { current: T };
  };
  components: Record<string, unknown>;
  fetchJSON: (path: string) => Promise<unknown>;
  utils?: { cn?: (...c: unknown[]) => string };
}

declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__?: HermesSdk;
    __HERMES_PLUGINS__?: {
      register: (name: string, component: unknown) => void;
      registerSlot?: (
        name: string,
        slot: string,
        component: unknown,
      ) => void;
    };
  }
}

export function sdk(): HermesSdk {
  const s = window.__HERMES_PLUGIN_SDK__;
  if (!s) throw new Error("hermes plugin sdk missing");
  return s;
}

// Element helper: h('div', {className:'x'}, ...children). Components
// pass through. Keeps the bundle JSX-free and type-light.
export function h(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): unknown {
  return sdk().React.createElement(type as never, props, ...children);
}

export function component(name: string): unknown {
  return sdk().components[name] ?? "div";
}
