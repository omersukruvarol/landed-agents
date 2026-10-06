import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveDataDir } from "@landed/db";
import { codexImporter } from "@landed/ingest";
import { confirm, resetCommand } from "./commands";
import { autostartCommand, launchAgentPath } from "./daemon";
import {
  claudePluginDir,
  hasLandedCodexHooks,
  removeClaudePlugin,
  removeCodexHooksCommand,
} from "./install";
import { MCP_SERVER_NAME, mcpRegistration, removeMcp } from "./mcp";
import { bold, dim } from "./print";

const out = (s = "") => process.stdout.write(`${s}\n`);

/** One thing Landed may have added to this machine, and how to take it back out. */
export interface Integration {
  name: string;
  present: boolean;
  remove: () => Promise<unknown> | unknown;
}

/** True when `command args…` exits 0 (e.g. `claude mcp get landed`); false if absent or failing. */
export type Probe = (command: string, args: string[]) => boolean;
const realProbe: Probe = (command, args) => {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
};

/**
 * Everything `landed uninstall` reverses, in removal order: stop the collector first, then the
 * agent integrations, so nothing calls back into a half-removed install.
 */
export function integrations(probe: Probe = realProbe, dataDir = resolveDataDir()): Integration[] {
  const mcp = (target: string) => {
    const reg = mcpRegistration(target, ["node", "landed", "mcp"]);
    return {
      name: `MCP server registered with ${reg?.agent}`,
      present: !!reg && probe(reg.cli, ["mcp", "get", MCP_SERVER_NAME]),
      remove: () => removeMcp(target),
    };
  };
  return [
    {
      name: "Start-at-login LaunchAgent",
      present: existsSync(launchAgentPath()),
      remove: () => autostartCommand("off", {}),
    },
    mcp("claude"),
    mcp(codexImporter.provider),
    {
      name: "Claude Code plugin",
      present: existsSync(claudePluginDir(dataDir)),
      remove: () => removeClaudePlugin(dataDir),
    },
    {
      name: "Codex hooks",
      present: hasLandedCodexHooks(),
      remove: () => removeCodexHooksCommand(),
    },
  ];
}

/** `landed uninstall`: reverses every integration it finds, then deletes Landed's data folder. */
export async function uninstallCommand(
  opts: { yes?: boolean; probe?: Probe } = {},
): Promise<number> {
  const found = integrations(opts.probe).filter((i) => i.present);
  out(bold("Landed will remove:"));
  for (const i of found) out(`  - ${i.name}`);
  out(`  - All of Landed's data (${resolveDataDir()})`);
  out(
    dim("  Your agents' own history, their other settings, and your repositories are not touched."),
  );
  if (!opts.yes && !(await confirm('Type "delete" to continue: ', "delete"))) {
    out("Cancelled. Nothing was changed.");
    return 0;
  }
  for (const i of found) await i.remove();
  await resetCommand({ yes: true, everything: true });
  return 0;
}
