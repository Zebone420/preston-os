import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Preston Supervisor - HARD SECURITY BOUNDARY (Phase 13). The Hermes
// dashboard itself carries powerful admin capability (config writes,
// API keys, MCP admin, cron, channels, gateway lifecycle, system
// operations). NONE of that is authority for Preston: this plugin may
// observe Preston Control's seven reads and nothing else. These pins
// fail the build before any bypass could ship:
//   - no direct Claude/Codex calls, no shell, no subprocess, no TUI
//   - no Hermes admin API usage (config/cron/mcp/system/keys/...)
//   - no protected Preston SSOT access, no write/consequential ops
//   - no approval decisions, no cancellation, no owner-confirmation
//   - no Preston credential in frontend code or browser storage
//   - no second orchestration engine

const ROOT = join(__dirname, "..", "dashboard");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "dist" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

interface Src {
  rel: string;
  text: string;
}

function sources(filterExt: (rel: string) => boolean): Src[] {
  return walk(ROOT)
    .map((p) => ({
      rel: p.slice(ROOT.length + 1).replace(/\\/g, "/"),
      text: readFileSync(p, "utf8"),
    }))
    .filter((f) => filterExt(f.rel));
}

const tsSources = () => sources((rel) => /^src\/.*\.ts$/.test(rel));
const pySources = () =>
  sources((rel) => rel.endsWith(".py") && !rel.startsWith("test_"));
const allSources = () =>
  sources(
    (rel) =>
      (/\.(ts|py|json|css)$/.test(rel) && !rel.startsWith("test_")) ||
      rel === "manifest.json",
  );

// Consequential Preston operations + execution machinery: banned
// EVERYWHERE in the plugin.
const BANNED_EVERYWHERE = [
  "preston_submit_goal",
  "preston_follow_up",
  "preston_decide_approval",
  "preston_cancel_goal",
  "decide_orchestration_approval",
  "submitPrestonGoal",
  "decidePrestonApproval",
  "cancelPrestonGoal",
  "owner" + "_confirmation",
  "service" + "_role",
  "child" + "_process",
  "execSync",
  "spawnSync",
];

// Hermes admin surfaces: existing FOR HERMES, never FOR PRESTON. The
// plugin must not touch any of them.
const BANNED_HERMES_ADMIN = [
  "/api/config",
  "/api/cron",
  "/api/mcp",
  "/api/system",
  "/api/keys",
  "/api/gateway",
  "/api/channels",
  "/api/webhooks",
  "/api/sessions",
  "/api/skills",
  "/api/chat",
  "config.yaml",
  "sessions.db",
];

// Python execution/backdoor surface.
const BANNED_PYTHON = [
  "subprocess",
  "os.system",
  "os.popen",
  "os.exec",
  "pty",
  "pexpect",
  "paramiko",
  "shutil",
  "eval(",
  "exec(",
  "__import__",
  "socketserver",
  "supabase",
];

describe("security boundary - bans hold across the whole plugin", () => {
  it("covers the plugin source set", () => {
    expect(allSources().length).toBeGreaterThanOrEqual(10);
  });

  for (const f of allSources()) {
    it(`${f.rel} carries no banned authority`, () => {
      for (const token of [...BANNED_EVERYWHERE, ...BANNED_HERMES_ADMIN]) {
        expect(
          f.text.includes(token),
          `${f.rel} must not contain ${token}`,
        ).toBe(false);
      }
    });
  }
});

describe("backend boundary - preston_client + plugin_api", () => {
  it("python sources spawn nothing and import no execution surface", () => {
    for (const f of pySources()) {
      for (const token of BANNED_PYTHON) {
        expect(
          f.text.includes(token),
          `${f.rel} must not contain ${token}`,
        ).toBe(false);
      }
      expect(f.text.includes("urllib")).toBe(f.rel.includes("client"));
      for (const lib of ["httpx", "requests"]) {
        expect(
          new RegExp(`import\\s+${lib}`).test(f.text),
          `${f.rel} must stay stdlib-only (no ${lib})`,
        ).toBe(false);
      }
    }
  });

  it("plugin_api exposes GET routes only", () => {
    const api = pySources().find((f) => f.rel === "plugin_api.py");
    expect(api).toBeTruthy();
    expect(api!.text.match(/@router\.get\(/g)?.length ?? 0).toBe(8);
    for (const verb of ["post", "put", "delete", "patch", "websocket"]) {
      expect(
        api!.text.includes(`@router.${verb}`),
        `plugin_api must not declare ${verb} routes`,
      ).toBe(false);
    }
  });

  it("the op allowlist is exactly the seven supported reads", () => {
    const client = pySources().find((f) => f.rel === "preston_client.py");
    expect(client).toBeTruthy();
    const paths = [
      ...client!.text.matchAll(/"(\/api\/control\/[^"]*)"/g),
    ].map((m) => m[1]);
    expect(paths.sort()).toEqual(
      [
        "/api/control/approvals",
        "/api/control/artifacts/{artifact_id}",
        "/api/control/events",
        "/api/control/evidence",
        "/api/control/goals/{goal_id}",
        "/api/control/jobs/{job_id}",
        "/api/control/status",
      ].sort(),
    );
    expect(client!.text.includes('method="GET"')).toBe(true);
  });
});

describe("frontend boundary", () => {
  it("frontend never sees the Preston credential or control URL", () => {
    for (const f of tsSources()) {
      expect(
        f.text.includes("HERMES_PRESTON_CONTROL_TOKEN"),
        `${f.rel} must not reference the token env`,
      ).toBe(false);
      expect(
        f.text.includes("/api/control"),
        `${f.rel} must reach Preston only via the plugin backend`,
      ).toBe(false);
      expect(
        /Bearer/i.test(f.text),
        `${f.rel} must not build auth headers`,
      ).toBe(false);
    }
  });

  it("every frontend API path stays inside this plugin's namespace", () => {
    for (const f of tsSources()) {
      const apiPaths = [...f.text.matchAll(/["'`](\/api\/[^"'`]*)/g)].map(
        (m) => m[1],
      );
      for (const path of apiPaths) {
        expect(
          path.startsWith("/api/plugins/preston-supervisor"),
          `${f.rel} fetches ${path} outside the plugin namespace`,
        ).toBe(true);
      }
    }
  });

  it("browser storage holds only the opaque feed cursor", () => {
    for (const f of tsSources()) {
      // Actual API usage, not a comment mentioning the term.
      if (!/localStorage\./.test(f.text)) continue;
      expect(f.rel).toBe("src/ui/feed.ts");
      expect(f.text.includes("hermes-preston.cursor.")).toBe(false);
      expect(f.text.includes("cursorStorageKey")).toBe(true);
      expect(/secret|bearer/i.test(f.text)).toBe(false);
    }
  });
});

describe("manifest pins", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  it("declares the documented drop-in shape", () => {
    expect(manifest["name"]).toBe("preston-supervisor");
    expect(manifest["label"]).toBe("Preston");
    expect((manifest["tab"] as Record<string, unknown>)["path"]).toBe(
      "/preston",
    );
    expect(manifest["entry"]).toBe("dist/index.js");
    expect(manifest["api"]).toBe("plugin_api.py");
  });

  it("does not override or hide any built-in Hermes page", () => {
    const tab = manifest["tab"] as Record<string, unknown>;
    expect(tab["override"]).toBeUndefined();
    expect(tab["hidden"]).toBeUndefined();
  });
});
