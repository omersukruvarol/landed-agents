#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { resolveDataDir } from "@landed/db";
import { codexImporter, InstallSecretMismatchError } from "@landed/ingest";
import { DEFAULT_PORT } from "@landed/server";
import {
  briefCommand,
  doctorCommand,
  exportCommand,
  loopsCommand,
  pruneCommand,
  reportCommand,
  resetCommand,
  scanCommand,
  UsageError,
} from "./commands";
import {
  autostartCommand,
  isHealthy,
  serveCommand,
  startCommand,
  statusCommand,
  stopCommand,
  url,
} from "./daemon";
import {
  hookRelay,
  installClaudePlugin,
  installCodexHooks,
  removeClaudePlugin,
  removeCodexHooksCommand,
} from "./install";
import { installMcp, mcpServeCommand, removeMcp } from "./mcp";
import { bold, dim, red } from "./print";
import { uninstallCommand } from "./uninstall";

export const VERSION = "0.3.0";

const HELP = `${bold("landed")} — did your AI agents' work actually land?

${bold("Look back")}
  landed scan                      Read Claude Code + Codex history, match edits to git, find open loops
  landed brief [--date D] [--json] Print the Daily Brief
  landed loops                     List open loops
  landed report [--days 30] [--names] [--out FILE]
                                   Write a shareable Retro Report (no names unless --names)
  landed export [--date D] [--md]  Export a day's brief as JSON (or Markdown)

${bold("Live")}
  landed open                      Open the dashboard (starts live collection if it is not running)
  landed start | stop | status     Run the live collector in the background
  landed autostart on|off [--yes]  Start it at login (macOS LaunchAgent)
  landed plugin install|remove claude [--yes]
                                   Claude Code plugin: live permission-wait and session-end signals
  landed hooks install|remove codex [--yes]
                                   Codex hooks with the same signals (appended; your hooks are kept)

${bold("Agent memory")}
  landed mcp install|remove claude|codex [--yes]
                                   Let agents ask Landed what other agents did here (read-only MCP)
  landed mcp                       Run the MCP server over stdio (agents start this themselves)

${bold("Maintenance")}
  landed doctor [--verbose]        Check the installation
  landed data prune --older-than 30d
  landed data reset [--yes]        Delete Landed's database (agent history is never touched)
  landed uninstall [--yes]         Remove autostart, MCP, plugin and hooks, then all Landed data

${dim("Landed only reads agent session files and git; installing the plugin, hooks or MCP server is the one opt-in change, and it previews first.")}
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      date: { type: "string" },
      days: { type: "string" },
      port: { type: "string" },
      out: { type: "string" },
      "older-than": { type: "string" },
      names: { type: "boolean" },
      json: { type: "boolean" },
      md: { type: "boolean" },
      yes: { type: "boolean" },
      quiet: { type: "boolean" },
      verbose: { type: "boolean" },
      "no-browser": { type: "boolean" },
    },
  });
  switch (command) {
    case "scan":
      await scanCommand({ quiet: values.quiet === true });
      return 0;
    case "open": {
      const port = values.port ? Number(values.port) : DEFAULT_PORT;
      if (await isHealthy(port)) {
        process.stdout.write(`Landed is running at ${url(port)}\n`);
        if (values["no-browser"] !== true && process.platform === "darwin")
          spawn("open", [url(port)], { stdio: "ignore", detached: true }).unref();
        return 0;
      }
      await serveCommand({ port, browser: values["no-browser"] !== true });
      return -1; // keep running
    }
    case "serve":
      await serveCommand({
        ...(values.port ? { port: Number(values.port) } : {}),
        browser: values["no-browser"] !== true,
      });
      return -1;
    case "start":
      return startCommand({ ...(values.port ? { port: Number(values.port) } : {}) });
    case "stop":
      return stopCommand({ ...(values.port ? { port: Number(values.port) } : {}) });
    case "status":
      return statusCommand({ ...(values.port ? { port: Number(values.port) } : {}) });
    case "autostart":
      return autostartCommand(positionals[0] ?? "", {
        yes: values.yes === true,
        ...(values.port ? { port: Number(values.port) } : {}),
      });
    case "plugin": {
      const [action, target] = positionals;
      if (target !== "claude")
        throw new UsageError(
          "Use `landed plugin install claude` or `landed plugin remove claude`.",
        );
      if (action === "install")
        return installClaudePlugin(resolveDataDir(), { yes: values.yes === true });
      if (action === "remove") return removeClaudePlugin(resolveDataDir());
      throw new UsageError("Use `landed plugin install claude` or `landed plugin remove claude`.");
    }
    case "hooks": {
      const [action, target] = positionals;
      if (target !== codexImporter.provider)
        throw new UsageError("Use `landed hooks install codex` or `landed hooks remove codex`.");
      if (action === "install") return installCodexHooks({ yes: values.yes === true });
      if (action === "remove") return removeCodexHooksCommand();
      throw new UsageError("Use `landed hooks install codex` or `landed hooks remove codex`.");
    }
    case "mcp": {
      const [action, target] = positionals;
      if (action === undefined) {
        await mcpServeCommand(VERSION);
        return 0;
      }
      const usage = "Use `landed mcp install claude|codex` or `landed mcp remove claude|codex`.";
      if (action === "install") {
        if (!target) throw new UsageError(usage);
        return installMcp(target, { yes: values.yes === true });
      }
      if (action === "remove") {
        if (!target) throw new UsageError(usage);
        return removeMcp(target);
      }
      throw new UsageError(usage);
    }
    case "hook":
      // Runs inside an agent hook: silent, fast, always exits 0.
      await hookRelay(positionals[0] ?? "", resolveDataDir());
      return 0;
    case "brief":
      briefCommand({ ...(values.date ? { date: values.date } : {}), json: values.json === true });
      return 0;
    case "loops":
      loopsCommand();
      return 0;
    case "report":
      reportCommand({
        ...(values.days ? { days: Number(values.days) } : {}),
        names: values.names === true,
        ...(values.out ? { out: values.out } : {}),
      });
      return 0;
    case "export":
      exportCommand({ ...(values.date ? { date: values.date } : {}), md: values.md === true });
      return 0;
    case "doctor":
      return doctorCommand({ verbose: values.verbose === true });
    case "data":
      if (positionals[0] === "prune") {
        pruneCommand(values["older-than"] ?? "");
        return 0;
      }
      if (positionals[0] === "reset") {
        await resetCommand({ yes: values.yes === true });
        return 0;
      }
      throw new UsageError("Use `landed data prune --older-than 30d` or `landed data reset`.");
    case "uninstall":
      return uninstallCommand({ yes: values.yes === true });
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      throw new UsageError(`Unknown command "${command}". Run \`landed help\`.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (error: unknown) => {
    if (error instanceof UsageError || error instanceof InstallSecretMismatchError) {
      process.stderr.write(`${red("Error:")} ${error.message}\n`);
      process.exit(2);
    }
    process.stderr.write(
      `${red("Unexpected error:")} ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
