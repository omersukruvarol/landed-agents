// Bundles the CLI (with server and pipelines) into dist/landed.mjs and copies migrations + web UI.
// Native and plugin-heavy modules stay external and resolve from this package's node_modules.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(dist, "landed.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["better-sqlite3", "fastify", "@fastify/static"],
  banner: {
    js: "import { createRequire as __landedRequire } from 'node:module'; const require = __landedRequire(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "warning",
});

cpSync(join(here, "../../packages/db/migrations"), join(dist, "migrations"), { recursive: true });
const web = join(here, "../web/dist");
if (existsSync(join(web, "index.html"))) cpSync(web, join(dist, "web"), { recursive: true });
else if (process.argv.includes("--release")) {
  console.error("web UI not built: run `pnpm build` from the repo root before packing.");
  process.exit(1);
} else
  console.warn(
    "web UI not built (run `pnpm --filter @landed/web build`); the CLI will serve the API only",
  );
// The npm package page and tarball carry the repo's README and license.
for (const f of ["README.md", "LICENSE"]) cpSync(join(here, "../..", f), join(here, f));
console.log("built dist/landed.mjs");
