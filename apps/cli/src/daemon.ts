import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting } from "@landed/db";
import { createLiveCollector, runScan } from "@landed/ingest";
import { createHub, createNotifier, DEFAULT_PORT, startServer } from "@landed/server";
import { assetDir, openContext } from "./context";
import { bold, cyan, dim, green, yellow } from "./print";

const out = (s = "") => process.stdout.write(`${s}\n`);
export const LAUNCH_AGENT_LABEL = "dev.landed.collector";

/** The persistent secret agent hooks send to /v1/ingest/* (0600 in the data dir). */
export function loadOrCreateIngestToken(dataDir: string): string {
  const path = join(dataDir, "ingest-token");
  if (!existsSync(path))
    writeFileSync(path, `${randomBytes(24).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return readFileSync(path, "utf8").trim();
}

const pidFile = (dataDir: string) => join(dataDir, "collector.pid");
export const url = (port: number) => `http://127.0.0.1:${port}`;

export async function isHealthy(port: number): Promise<boolean> {
  try {
    const r = await fetch(`${url(port)}/v1/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Foreground collector + dashboard. Used directly, by `landed start`, and by the LaunchAgent. */
export async function serveCommand(opts: { port?: number; browser?: boolean }): Promise<void> {
  const ctx = openContext();
  const { db } = ctx.handle;
  const port = opts.port ?? DEFAULT_PORT;
  const hub = createHub();
  const live = createLiveCollector({
    db,
    fingerprinter: ctx.fingerprinter,
    onEvent: hub.publish,
    notify: createNotifier(db),
  });
  const web = assetDir("web");
  const { app } = await startServer({
    db,
    dbPath: ctx.dbPath,
    dataDir: ctx.dataDir,
    fingerprinter: ctx.fingerprinter,
    port,
    live,
    hub,
    ingestToken: loadOrCreateIngestToken(ctx.dataDir),
    ...(web ? { webRoot: web } : {}),
  });
  live.start();
  out(
    `${bold("Landed")} is collecting live at ${cyan(url(port))} ${dim("(local only — Ctrl+C to stop)")}`,
  );
  if (!getSetting(db, "lastScan")) {
    out(dim("First run: reading your agent history in the background…"));
    void live
      .exclusive(() => runScan({ db, fingerprinter: ctx.fingerprinter }))
      .then(() => hub.publish({ type: "analysis", at: new Date().toISOString() }));
  }
  if (opts.browser !== false && process.platform === "darwin")
    spawn("open", [url(port)], { stdio: "ignore", detached: true }).unref();
  const shutdown = async () => {
    setTimeout(() => process.exit(0), 3000).unref(); // never hang on the way out
    live.stop();
    await app.close().catch(() => {});
    ctx.handle.close();
    rmSync(pidFile(ctx.dataDir), { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export const bundlePath = () => fileURLToPath(import.meta.url);

/**
 * A node path that survives upgrades: Homebrew's versioned Cellar path changes with every update,
 * so prefer a stable symlink that resolves to the same binary.
 */
export function stableNodePath(execPath = process.execPath): string {
  if (!execPath.includes("/Cellar/")) return execPath;
  const real = realpathSync(execPath);
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    try {
      if (realpathSync(candidate) === real) return candidate;
    } catch {}
  }
  return execPath;
}

export async function startCommand(opts: { port?: number }): Promise<number> {
  const ctx = openContext();
  const port = opts.port ?? DEFAULT_PORT;
  ctx.handle.close();
  if (await isHealthy(port)) {
    out(`Already running at ${cyan(url(port))}`);
    return 0;
  }
  const log = openSync(join(ctx.dataDir, "collector.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [bundlePath(), "serve", "--no-browser", "--port", String(port)],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  writeFileSync(pidFile(ctx.dataDir), String(child.pid), { mode: 0o600 });
  for (let i = 0; i < 100; i++) {
    if (await isHealthy(port)) {
      out(
        `${green("✓")} Landed is collecting in the background at ${cyan(url(port))} ${dim(`(pid ${child.pid})`)}`,
      );
      return 0;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  out(
    yellow(
      `Started (pid ${child.pid}) but it is not answering yet; see ${join(ctx.dataDir, "collector.log")}`,
    ),
  );
  return 1;
}

export async function stopCommand(opts: { port?: number }): Promise<number> {
  const ctx = openContext();
  ctx.handle.close();
  const file = pidFile(ctx.dataDir);
  const pid = existsSync(file) ? Number(readFileSync(file, "utf8")) : undefined;
  if (!pid || !alive(pid)) {
    rmSync(file, { force: true });
    out(
      (await isHealthy(opts.port ?? DEFAULT_PORT))
        ? yellow(
            "A Landed server is running but was not started by `landed start` (stop it where it runs).",
          )
        : "Landed is not running.",
    );
    return 0;
  }
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  rmSync(file, { force: true });
  out(alive(pid) ? yellow(`Process ${pid} did not stop.`) : `${green("✓")} Stopped.`);
  return 0;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function statusCommand(opts: { port?: number }): Promise<number> {
  const port = opts.port ?? DEFAULT_PORT;
  const ctx = openContext();
  const pidPath = pidFile(ctx.dataDir);
  const pid = existsSync(pidPath) ? Number(readFileSync(pidPath, "utf8")) : undefined;
  const healthy = await isHealthy(port);
  out(bold("Landed"));
  out(
    `Collector      ${healthy ? green("running") : dim("stopped")}${pid && alive(pid) ? dim(` · pid ${pid}`) : ""}`,
  );
  out(`Dashboard      ${healthy ? cyan(url(port)) : dim("—")}`);
  if (healthy) {
    const live = (await (await fetch(`${url(port)}/v1/live`)).json()) as {
      live: boolean;
      lastActivityAt: string | null;
      since: string;
    };
    const today = (await (await fetch(`${url(port)}/v1/today`)).json()) as {
      running: unknown[];
      brief: { activity: { sessions: number }; openLoops: { open: number } };
    };
    out(
      `Live           ${live.live ? green("watching agent history") : dim("off (started with `landed open`?)")}`,
    );
    out(
      `Last activity  ${live.lastActivityAt ? new Date(live.lastActivityAt).toLocaleString() : dim("none since start")}`,
    );
    out(`Running now    ${today.running.length} session(s)`);
    out(
      `Today          ${today.brief.activity.sessions} sessions · ${today.brief.openLoops.open} open loops`,
    );
  }
  out(`Autostart      ${existsSync(launchAgentPath()) ? green("on") : dim("off")}`);
  ctx.handle.close();
  return 0;
}

export function launchAgentPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string,
  );

/** LaunchAgent: start at login, restart only after a crash (a clean `landed stop` stays stopped). */
export function launchAgentPlist(
  nodePath: string,
  bundle: string,
  logPath: string,
  port: number,
): string {
  const args = [nodePath, bundle, "serve", "--no-browser", "--port", String(port)]
    .map((a) => `    <string>${xml(a)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

export async function autostartCommand(
  mode: string,
  opts: { yes?: boolean; port?: number },
): Promise<number> {
  if (process.platform !== "darwin") {
    out(
      yellow(
        "Autostart uses a macOS LaunchAgent; on other systems run `landed start` from your login scripts.",
      ),
    );
    return 1;
  }
  const plist = launchAgentPath();
  const domain = `gui/${process.getuid?.() ?? 501}`;
  if (mode === "off") {
    try {
      execFileSync("launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`], {
        stdio: "ignore",
      });
    } catch {}
    rmSync(plist, { force: true });
    out(`${green("✓")} Autostart off. ${dim(`Removed ${plist}`)}`);
    return 0;
  }
  if (mode !== "on") throw new Error("Use `landed autostart on` or `landed autostart off`.");
  const ctx = openContext();
  ctx.handle.close();
  const node = stableNodePath();
  const content = launchAgentPlist(
    node,
    bundlePath(),
    join(ctx.dataDir, "collector.log"),
    opts.port ?? DEFAULT_PORT,
  );
  out(bold("This will add a LaunchAgent so Landed collects in the background after you log in:"));
  out(dim(`  ${plist}`));
  out(dim(`  runs: ${node} ${bundlePath()} serve --no-browser`));
  out(dim("  Undo any time with `landed autostart off`."));
  if (!opts.yes) {
    out(yellow("Re-run with --yes to apply."));
    return 0;
  }
  await stopCommand({});
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(plist, content, { mode: 0o644 });
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["bootstrap", domain, plist], { stdio: "ignore" });
  // Start it now rather than at next login, then confirm it actually answers.
  execFileSync("launchctl", ["kickstart", `${domain}/${LAUNCH_AGENT_LABEL}`], { stdio: "ignore" });
  const port = opts.port ?? DEFAULT_PORT;
  for (let i = 0; i < 100; i++) {
    if (await isHealthy(port)) {
      out(`${green("✓")} Autostart on. Landed is running at ${cyan(url(port))}`);
      return 0;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  out(
    yellow(
      `Autostart is installed, but Landed is not answering yet; see ${join(ctx.dataDir, "collector.log")}`,
    ),
  );
  return 1;
}
