#!/usr/bin/env node
// Enforces package boundaries (docs/architecture.md, PRD §21.4 / §28).
//  1. A workspace package may only depend on the @landed/* packages listed in ALLOWED.
//  2. Every @landed/* import in src must be declared in that package's dependencies.
//  3. Vendor identifiers ("claude-code", "codex") may appear as string literals only in
//     core (the provider enum) and the importer-* packages. Core logic stays vendor-neutral.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const PURE = ["core", "shared"];
const ALL_PACKAGES = [
  "shared",
  "core",
  "db",
  "importer-claude",
  "importer-codex",
  "git-index",
  "outcomes",
  "threads",
  "loops",
  "insights",
  "brief",
  "summarizer",
  "ingest",
];

/** @type {Record<string, string[]>} package name (without scope) -> allowed @landed deps */
const ALLOWED = {
  shared: [],
  core: ["shared"],
  db: PURE,
  "importer-claude": PURE,
  "importer-codex": PURE,
  "git-index": PURE,
  outcomes: [...PURE, "git-index"],
  threads: PURE,
  loops: PURE,
  insights: PURE,
  brief: PURE,
  summarizer: PURE,
  // The pipelines compose storage with the importers and the outcome engine; both apps reuse them.
  ingest: [
    ...PURE,
    "db",
    "importer-claude",
    "importer-codex",
    "git-index",
    "outcomes",
    "threads",
    "loops",
    "insights",
  ],
  server: ALL_PACKAGES,
  // The CLI (published as `landed-agents`) embeds the server (`landed open`).
  "landed-agents": [...ALL_PACKAGES, "server"],
  web: PURE,
};

const VENDOR_LITERAL_OK = new Set(["core", "importer-claude", "importer-codex"]);
const VENDOR_LITERAL = /(["'`])(claude-code|codex)\1/;
// Tests and their helpers may name concrete providers as fixture data.
const TEST_FILE = /(\.test\.ts|test-helpers\.ts)$/;
const LANDED_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](@landed\/[a-z-]+)/g;

const errors = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(p);
  }
  return out;
}

for (const group of ["apps", "packages"]) {
  for (const dir of readdirSync(join(ROOT, group))) {
    const pkgDir = join(ROOT, group, dir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const short = pkg.name.replace(/^@landed\//, "");
    const allowed = ALLOWED[short];
    if (!allowed) {
      errors.push(`${pkg.name}: not registered in scripts/check-boundaries.mjs ALLOWED map`);
      continue;
    }
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter((d) => d.startsWith("@landed/"))
      .map((d) => d.replace(/^@landed\//, ""));
    for (const dep of declared) {
      if (!allowed.includes(dep)) errors.push(`${pkg.name}: may not depend on @landed/${dep}`);
    }
    for (const file of walk(join(pkgDir, "src"))) {
      const rel = relative(ROOT, file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(LANDED_IMPORT)) {
        const target = m[1].replace(/^@landed\//, "");
        if (target !== short && !declared.includes(target)) {
          errors.push(`${rel}: imports @landed/${target} which is not a declared dependency`);
        }
      }
      if (!VENDOR_LITERAL_OK.has(short) && !TEST_FILE.test(file)) {
        src.split("\n").forEach((line, i) => {
          if (VENDOR_LITERAL.test(line)) {
            errors.push(`${rel}:${i + 1}: vendor literal outside importer packages (PRD §28.5)`);
          }
        });
      }
    }
  }
}

if (errors.length) {
  console.error(`Package boundary violations (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("Package boundaries OK");
