import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type DatabaseHandle,
  databasePath,
  type LandedDb,
  openDatabase,
  resolveDataDir,
} from "@landed/db";
import { codexImporter } from "@landed/ingest";
import {
  createMcpServer,
  createMemoryTools,
  MCP_INSTRUCTIONS,
  privacyFilter,
  serveStdio,
} from "@landed/server";
import { UsageError } from "./commands";
import { assetDir } from "./context";
import { bundlePath, stableNodePath } from "./daemon";
import { bold, dim, green, yellow } from "./print";

const out = (s = "") => process.stdout.write(`${s}\n`);
export const MCP_SERVER_NAME = "landed";

/**
 * `landed mcp`: the read-only memory server agents start over stdio (PRD v0.3). Stdout carries
 * only protocol messages. The database is opened lazily, so a server started before the first
 * scan begins answering once data exists; the connection refuses writes (query_only).
 */
export async function mcpServeCommand(version: string): Promise<void> {
  const dbPath = databasePath(resolveDataDir());
  let handle: DatabaseHandle | undefined;
  const db = (): LandedDb | undefined => {
    if (!handle && existsSync(dbPath)) {
      const migrations = assetDir("migrations");
      handle = openDatabase(dbPath, migrations ? { migrationsFolder: migrations } : {});
      handle.sqlite.pragma("query_only = ON");
    }
    return handle?.db;
  };
  const server = createMcpServer(
    { name: MCP_SERVER_NAME, version, instructions: MCP_INSTRUCTIONS },
    createMemoryTools({ db, cwd: process.cwd() }),
    { filter: privacyFilter },
  );
  await serveStdio(server, process.stdin, process.stdout);
  handle?.close();
}

export type Runner = (command: string, args: string[]) => void;
const realRunner: Runner = (command, args) => {
  execFileSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
};

/** How each agent CLI registers and removes a user-scoped stdio MCP server. */
export function mcpRegistration(target: string, server: readonly [string, ...string[]]) {
  const [command, ...args] = server;
  if (target === "claude")
    return {
      agent: "Claude Code",
      cli: "claude",
      add: ["mcp", "add", "--scope", "user", MCP_SERVER_NAME, "--", command, ...args],
      remove: ["mcp", "remove", "--scope", "user", MCP_SERVER_NAME],
    };
  if (target === codexImporter.provider)
    return {
      agent: "Codex",
      cli: codexImporter.provider,
      add: ["mcp", "add", MCP_SERVER_NAME, "--", command, ...args],
      remove: ["mcp", "remove", MCP_SERVER_NAME],
    };
  return undefined;
}

const serverCommand = (): [string, ...string[]] => [stableNodePath(), bundlePath(), "mcp"];

export function installMcp(target: string, opts: { yes?: boolean; run?: Runner } = {}): number {
  const reg = mcpRegistration(target, serverCommand());
  if (!reg) throw new UsageError("Use `landed mcp install claude` or `landed mcp install codex`.");
  out(bold(`Landed will register its read-only memory server with ${reg.agent}:`));
  out(dim(`  runs: ${reg.cli} ${reg.add.join(" ")}`));
  out(
    dim(
      "  Tools: active_sessions, recent_work, open_loops, prior_attempts, resume_packet (read-only).",
    ),
  );
  out(dim(`  Undo any time with \`landed mcp remove ${target}\`.`));
  if (!opts.yes) {
    out(yellow("Re-run with --yes to apply."));
    return 0;
  }
  const run = opts.run ?? realRunner;
  try {
    run(reg.cli, reg.remove); // re-installing replaces an older registration
  } catch {}
  run(reg.cli, reg.add);
  out(`${green("✓")} Registered. New ${reg.agent} sessions can use Landed's memory tools.`);
  return 0;
}

export function removeMcp(target: string, opts: { run?: Runner } = {}): number {
  const reg = mcpRegistration(target, serverCommand());
  if (!reg) throw new UsageError("Use `landed mcp remove claude` or `landed mcp remove codex`.");
  try {
    (opts.run ?? realRunner)(reg.cli, reg.remove);
  } catch {
    // Not registered.
  }
  out(`${green("✓")} Landed's memory server is no longer registered with ${reg.agent}.`);
  return 0;
}
