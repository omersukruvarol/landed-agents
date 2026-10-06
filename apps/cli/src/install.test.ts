import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchAgentPlist, stableNodePath } from "./daemon";
import {
  claudePluginDir,
  claudePluginFiles,
  codexHookCommand,
  type HooksFile,
  hookRelay,
  installClaudePlugin,
  installCodexHooks,
  MARKETPLACE,
  mergeCodexHooks,
  PLUGIN,
  removeClaudePlugin,
  removeCodexHooks,
  removeCodexHooksCommand,
} from "./install";

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "landed-install-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const quiet = () => vi.spyOn(process.stdout, "write").mockImplementation(() => true);

describe("Claude Code plugin", () => {
  it("declares fail-open HTTP hooks to the local collector", () => {
    const files = claudePluginFiles("tok", 47831);
    const hooks = JSON.parse(files[`plugins/${PLUGIN}/hooks/hooks.json`] as string).hooks;
    expect(Object.keys(hooks).sort()).toEqual([
      "Notification",
      "PermissionRequest",
      "SessionEnd",
      "SessionStart",
      "Stop",
    ]);
    expect(hooks.PermissionRequest[0].hooks[0]).toEqual({
      type: "http",
      url: "http://127.0.0.1:47831/v1/ingest/claude",
      headers: { "x-landed-ingest": "tok" },
      timeout: 2,
    });
    expect(hooks.Notification[0].matcher).toBe("permission_prompt");
    const market = JSON.parse(files[".claude-plugin/marketplace.json"] as string);
    expect(market).toMatchObject({
      name: MARKETPLACE,
      plugins: [{ name: PLUGIN, source: `./plugins/${PLUGIN}` }],
    });
  });

  it("previews without --yes, then installs through Claude's own CLI", () => {
    quiet();
    const data = temp();
    const calls: string[][] = [];
    const run = (c: string, a: string[]) => {
      calls.push([c, ...a]);
    };
    installClaudePlugin(data, { run });
    expect(calls).toEqual([]);
    expect(existsSync(claudePluginDir(data))).toBe(false);
    installClaudePlugin(data, { run, yes: true });
    expect(calls).toEqual([
      ["claude", "plugin", "marketplace", "add", claudePluginDir(data)],
      ["claude", "plugin", "install", `${PLUGIN}@${MARKETPLACE}`, "--scope", "user"],
    ]);
    const hooksFile = join(claudePluginDir(data), "plugins", PLUGIN, "hooks", "hooks.json");
    expect(statSync(hooksFile).mode & 0o777).toBe(0o600);
    removeClaudePlugin(data, { run });
    expect(calls.slice(2).map((c) => c[2])).toEqual(["uninstall", "marketplace"]);
    expect(existsSync(claudePluginDir(data))).toBe(false);
  });
});

describe("Codex hooks", () => {
  const user: HooksFile = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "my-guard.sh", timeout: 5 }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "notify-me", statusMessage: "done" }] }],
    },
    extra: { keep: true },
  };
  const cmd = codexHookCommand("/opt/node", "/x/landed.mjs");

  it("appends after existing hooks, keeping their positions, and is idempotent", () => {
    const once = mergeCodexHooks(user, cmd);
    expect(once.hooks.Stop?.[0]).toEqual(user.hooks.Stop?.[0]); // index 0 unchanged → trust kept
    expect(once.hooks.Stop?.[1]?.hooks[0]).toEqual({ type: "command", command: cmd, timeout: 2 });
    expect(once.hooks.PreToolUse).toEqual(user.hooks.PreToolUse);
    expect(Object.keys(once.hooks).sort()).toEqual([
      "PermissionRequest",
      "PreToolUse",
      "SessionEnd",
      "SessionStart",
      "Stop",
    ]);
    expect(mergeCodexHooks(once, cmd)).toEqual(once);
    expect(once.extra).toEqual({ keep: true });
  });

  it("removal restores the user's file semantically", () => {
    expect(removeCodexHooks(mergeCodexHooks(user, cmd))).toEqual(user);
  });

  it("installs with a backup, uninstalls cleanly, and never touches an unparseable file", () => {
    quiet();
    const dir = temp();
    const path = join(dir, "hooks.json");
    writeFileSync(path, JSON.stringify(user));
    installCodexHooks({ path, command: cmd });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(user); // preview only
    installCodexHooks({ path, command: cmd, yes: true });
    expect(readdirSync(dir).some((f) => f.startsWith("hooks.json.landed-backup-"))).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).hooks.SessionStart[0].hooks[0].command).toBe(cmd);
    removeCodexHooksCommand({ path });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(user);

    writeFileSync(path, "{ not json");
    expect(() => installCodexHooks({ path, command: cmd, yes: true })).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });
});

describe("hook relay", () => {
  it("forwards the payload with the ingest token, and stays silent when the collector is down", async () => {
    const data = temp();
    writeFileSync(join(data, "ingest-token"), "tok\n");
    let got: { headers: Record<string, unknown>; body: string } | undefined;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        got = { headers: req.headers, body };
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(47994, "127.0.0.1", r));
    await hookRelay(
      "codex",
      data,
      47994,
      Readable.from([Buffer.from('{"session_id":"t1","hook_event_name":"Stop"}')]),
    );
    server.close();
    expect(got?.headers["x-landed-ingest"]).toBe("tok");
    expect(JSON.parse(got?.body ?? "{}")).toEqual({ session_id: "t1", hook_event_name: "Stop" });
    const started = Date.now();
    await hookRelay("codex", data, 47993, Readable.from([Buffer.from("{}")]));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("LaunchAgent", () => {
  it("keeps a node path that is not a versioned Homebrew Cellar path", () => {
    expect(stableNodePath("/usr/local/custom/node")).toBe("/usr/local/custom/node");
  });

  it("runs the collector at login and only restarts after crashes", () => {
    const plist = launchAgentPlist("/opt/node", "/a b/landed.mjs", "/data/collector.log", 47831);
    expect(plist).toContain("<string>dev.landed.collector</string>");
    expect(plist).toContain("<string>/a b/landed.mjs</string>");
    expect(plist).toContain("<key>SuccessfulExit</key>\n    <false/>");
    expect(plist).toContain("<string>serve</string>");
  });
});
