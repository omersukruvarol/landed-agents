import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_HOOK_EVENTS } from "@landed/importer-claude";
import { CODEX_HOOK_EVENTS } from "@landed/importer-codex";
import { DEFAULT_PORT } from "@landed/server";
import { loadOrCreateIngestToken, url } from "./daemon";
import { bold, dim, green, yellow } from "./print";

const out = (s = "") => process.stdout.write(`${s}\n`);
export const MARKETPLACE = "landed-local";
export const PLUGIN = "landed";
/** Seconds an agent may wait for Landed before carrying on (hooks fail open). */
const HOOK_TIMEOUT = 2;

export type Runner = (command: string, args: string[]) => void;
const realRunner: Runner = (command, args) => {
  execFileSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
};

// ── Claude Code plugin ───────────────────────────────────────────────────────────────────

/** Files of a local marketplace holding the Landed plugin: HTTP hooks to the local collector. */
export function claudePluginFiles(
  ingestToken: string,
  port = DEFAULT_PORT,
): Record<string, string> {
  const hook = {
    type: "http",
    url: `${url(port)}/v1/ingest/claude`,
    headers: { "x-landed-ingest": ingestToken },
    timeout: HOOK_TIMEOUT,
  };
  const hooks: Record<string, unknown[]> = {};
  for (const event of CLAUDE_HOOK_EVENTS) {
    hooks[event] = [
      { matcher: event === "Notification" ? "permission_prompt" : "", hooks: [hook] },
    ];
  }
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  return {
    ".claude-plugin/marketplace.json": json({
      name: MARKETPLACE,
      owner: { name: "Landed (local)" },
      plugins: [
        {
          name: PLUGIN,
          source: `./plugins/${PLUGIN}`,
          version: "0.2.0",
          description:
            "Sends session lifecycle and permission-wait signals to your local Landed collector.",
        },
      ],
    }),
    [`plugins/${PLUGIN}/.claude-plugin/plugin.json`]: json({
      name: PLUGIN,
      version: "0.2.0",
      description:
        "Live signals for Landed: session start/end, turn end, and pending permission requests. Hooks only; never decides anything.",
    }),
    [`plugins/${PLUGIN}/hooks/hooks.json`]: json({ hooks }),
  };
}

export function claudePluginDir(dataDir: string): string {
  return join(dataDir, "claude-plugin");
}

export function installClaudePlugin(
  dataDir: string,
  opts: { yes?: boolean; run?: Runner; port?: number } = {},
): number {
  const dir = claudePluginDir(dataDir);
  const files = claudePluginFiles(loadOrCreateIngestToken(dataDir), opts.port);
  out(bold("Landed will install a Claude Code plugin through Claude's own plugin manager:"));
  out(dim(`  plugin files: ${dir}`));
  out(
    dim(
      `  hooks: ${CLAUDE_HOOK_EVENTS.join(", ")} → POST ${url(opts.port ?? DEFAULT_PORT)}/v1/ingest/claude (${HOOK_TIMEOUT}s timeout, fail-open)`,
    ),
  );
  out(
    dim(
      `  runs: claude plugin marketplace add ${dir} && claude plugin install ${PLUGIN}@${MARKETPLACE} --scope user`,
    ),
  );
  out(dim("  Your settings.json is not edited. Undo with `landed plugin remove claude`."));
  if (!opts.yes) {
    out(yellow("Re-run with --yes to apply."));
    return 0;
  }
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, rel), content, { mode: 0o600 });
  }
  const run = opts.run ?? realRunner;
  run("claude", ["plugin", "marketplace", "add", dir]);
  run("claude", ["plugin", "install", `${PLUGIN}@${MARKETPLACE}`, "--scope", "user"]);
  out(
    `${green("✓")} Plugin installed. New Claude Code sessions will report live; restart open ones (or run /reload-plugins).`,
  );
  return 0;
}

export function removeClaudePlugin(dataDir: string, opts: { run?: Runner } = {}): number {
  const run = opts.run ?? realRunner;
  for (const args of [
    ["plugin", "uninstall", `${PLUGIN}@${MARKETPLACE}`, "--scope", "user"],
    ["plugin", "marketplace", "remove", MARKETPLACE],
  ]) {
    try {
      run("claude", args);
    } catch {
      // Already gone.
    }
  }
  rmSync(claudePluginDir(dataDir), { recursive: true, force: true });
  out(`${green("✓")} Claude Code plugin removed.`);
  return 0;
}

// ── Codex hooks ──────────────────────────────────────────────────────────────────────────

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
  [k: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
  [k: string]: unknown;
}
export interface HooksFile {
  hooks: Record<string, HookGroup[]>;
  [k: string]: unknown;
}

const LANDED_MARK = " hook codex";
const isLanded = (h: HookEntry) =>
  typeof h.command === "string" && h.command.endsWith(LANDED_MARK) && h.command.includes("landed");

export function codexHookCommand(nodePath: string, bundle: string): string {
  return `${JSON.stringify(nodePath)} ${JSON.stringify(bundle)}${LANDED_MARK}`;
}

/**
 * Adds Landed's hook groups at the END of each event's list. Codex records its trust review per
 * position (event:group:hook), so appending keeps every existing hook's approval valid. Idempotent:
 * earlier Landed entries are replaced, nothing else is touched.
 */
export function mergeCodexHooks(existing: HooksFile, command: string): HooksFile {
  const next = removeCodexHooks(existing);
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = next.hooks[event] ?? [];
    groups.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT }] });
    next.hooks[event] = groups;
  }
  return next;
}

/** Removes only Landed's entries (and groups left empty by that). */
export function removeCodexHooks(existing: HooksFile): HooksFile {
  const copy = JSON.parse(JSON.stringify(existing)) as HooksFile;
  copy.hooks ??= {};
  for (const [event, groups] of Object.entries(copy.hooks)) {
    const kept: HookGroup[] = [];
    for (const g of groups) {
      const hooks = (g.hooks ?? []).filter((h) => !isLanded(h));
      if (hooks.length > 0 || (g.hooks ?? []).length === 0) kept.push({ ...g, hooks });
    }
    if (kept.length) copy.hooks[event] = kept;
    else delete copy.hooks[event];
  }
  return copy;
}

/** Whether the Codex hooks file contains any of Landed's entries. */
export function hasLandedCodexHooks(path: string = codexHooksPath()): boolean {
  try {
    const f = JSON.parse(readFileSync(path, "utf8")) as HooksFile;
    return Object.values(f.hooks ?? {}).some((groups) =>
      groups.some((g) => (g.hooks ?? []).some(isLanded)),
    );
  } catch {
    return false;
  }
}

export function codexHooksPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME ?? join(homedir(), ".codex"), "hooks.json");
}

/** Parse → merge → back up → atomic write. Aborts before any change if the file cannot be parsed. */
function rewrite(path: string, transform: (f: HooksFile) => HooksFile): string | undefined {
  let current: HooksFile = { hooks: {} };
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error(`${path} is not a JSON object; nothing was changed.`);
    current = parsed as HooksFile;
  }
  const next = transform(current);
  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}.landed-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.landed-tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, path);
  return backup;
}

export function installCodexHooks(
  opts: { yes?: boolean; path?: string; command?: string } = {},
): number {
  const path = opts.path ?? codexHooksPath();
  const command =
    opts.command ?? codexHookCommand(process.execPath, fileURLToPath(import.meta.url));
  out(bold("Landed will add hooks to Codex:"));
  out(dim(`  file: ${path} (backed up first; existing hooks are kept and stay in place)`));
  out(
    dim(
      `  events: ${CODEX_HOOK_EVENTS.join(", ")} → ${command} (${HOOK_TIMEOUT}s timeout, always exits 0)`,
    ),
  );
  out(dim("  Codex skips new hooks until you review them; open Codex to trust them."));
  if (!opts.yes) {
    out(yellow("Re-run with --yes to apply."));
    return 0;
  }
  const backup = rewrite(path, (f) => mergeCodexHooks(f, command));
  out(`${green("✓")} Codex hooks added.${backup ? dim(` Backup: ${backup}`) : ""}`);
  return 0;
}

export function removeCodexHooksCommand(opts: { path?: string } = {}): number {
  const path = opts.path ?? codexHooksPath();
  if (!existsSync(path)) {
    out("No Codex hooks file; nothing to remove.");
    return 0;
  }
  const backup = rewrite(path, removeCodexHooks);
  out(
    `${green("✓")} Landed's Codex hooks removed; your other hooks are unchanged.${backup ? dim(` Backup: ${backup}`) : ""}`,
  );
  return 0;
}

// ── Hook relay (runs inside the agent's hook) ────────────────────────────────────────────

/**
 * `landed hook codex`: reads the hook payload on stdin and forwards it to the local collector.
 * Prints nothing and always succeeds, so it can never block or steer the agent.
 */
export async function hookRelay(
  provider: string,
  dataDir: string,
  port = DEFAULT_PORT,
  input: AsyncIterable<Buffer> = process.stdin as AsyncIterable<Buffer>,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of input) {
      size += chunk.length;
      if (size > 8 * 2 ** 20) return;
      chunks.push(chunk);
    }
    const token = readFileSync(join(dataDir, "ingest-token"), "utf8").trim();
    await fetch(`${url(port)}/v1/ingest/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-landed-ingest": token },
      body: Buffer.concat(chunks).toString("utf8"),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Collector down or slow: the agent carries on regardless.
  }
}
