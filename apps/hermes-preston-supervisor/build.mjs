// Preston Supervisor - plugin bundle build. Emits the drop-in files
// the Hermes dashboard loads directly:
//   dashboard/dist/index.js  (single IIFE; React comes from the SDK
//                             global, so nothing is bundled but our
//                             own source)
//   dashboard/dist/style.css (copied verbatim)
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "dashboard", "src");
const dist = join(here, "dashboard", "dist");

mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(src, "index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: join(dist, "index.js"),
  legalComments: "none",
  logLevel: "info",
});

copyFileSync(join(src, "style.css"), join(dist, "style.css"));
console.log("preston-supervisor plugin bundle built");
