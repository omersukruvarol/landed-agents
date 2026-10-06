import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const CLAUDE_MAIN = "11111111-1111-4111-8111-111111111111";
const CODEX_MAIN = "019a0000-aaaa-7000-8000-00000000000a";
let home: string;
const env = { ...process.env };

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "landed-cli-"));
  const repo = join(home, "app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const fx = (p: string) =>
    readFileSync(join(ROOT, "fixtures", p), "utf8").replaceAll("{{REPO}}", repo);
  const project = join(home, "claude", "projects", "-app");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${CLAUDE_MAIN}.jsonl`), fx("claude/2.1/session-main.jsonl"));
  const day = join(home, "codex", "sessions", "2026", "09", "29");
  mkdirSync(day, { recursive: true });
  const rollout = `rollout-2026-09-29T10-00-00-${CODEX_MAIN}.jsonl`;
  writeFileSync(join(day, rollout), fx(`codex/0.154/${rollout}`));
  process.env.LANDED_DATA_DIR = join(home, "data");
  process.env.CLAUDE_CONFIG_DIR = join(home, "claude");
  process.env.CODEX_HOME = join(home, "codex");
  process.env.NO_COLOR = "1";
});

afterAll(() => {
  process.env = env;
  rmSync(home, { recursive: true, force: true });
});

function capture() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
    chunks.push(String(c));
    return true;
  });
  return { text: () => chunks.join(""), restore: () => spy.mockRestore() };
}

describe("landed CLI", () => {
  it("scan reads both sources and summarizes outcomes and loops", async () => {
    const { scanCommand } = await import("./commands");
    const out = capture();
    await scanCommand({ quiet: true });
    out.restore();
    const text = out.text();
    expect(text).toMatch(/Claude Code\s+1 sessions/);
    expect(text).toMatch(/Codex\s+1 sessions/);
    expect(text).toContain("Prompt text   not stored");
    expect(text).toContain("Open loops");
    expect(text).not.toMatch(/CANARY_/);
  });

  it("doctor reports no failures after a scan", async () => {
    const { doctorCommand } = await import("./commands");
    const out = capture();
    const code = doctorCommand({});
    out.restore();
    expect(out.text()).not.toContain("FAIL");
    expect(code).toBe(0);
  });

  it("brief prints Markdown and JSON", async () => {
    const { briefCommand } = await import("./commands");
    let out = capture();
    briefCommand({ date: "2026-09-30" });
    out.restore();
    expect(out.text()).toContain("# Daily Brief — 2026-09-30");
    out = capture();
    briefCommand({ date: "2026-09-30", json: true });
    out.restore();
    expect(JSON.parse(out.text()).date).toBe("2026-09-30");
  });

  it("report writes a privacy-safe HTML file", async () => {
    const { reportCommand } = await import("./commands");
    const file = join(home, "report.html");
    const out = capture();
    reportCommand({ days: 3650, out: file });
    out.restore();
    const html = readFileSync(file, "utf8");
    expect(html).toContain("Agent Wrapped");
    expect(html).not.toContain(home);
    expect(html).not.toContain(">app<");
  });

  it("loops, prune and reset work without touching agent history", async () => {
    const { loopsCommand, pruneCommand, resetCommand } = await import("./commands");
    const out = capture();
    loopsCommand();
    pruneCommand("36500d");
    await resetCommand({ yes: true });
    out.restore();
    expect(out.text()).toContain("Removed 0 session(s)");
    expect(existsSync(join(home, "data", "landed.db"))).toBe(false);
    expect(existsSync(join(home, "claude", "projects", "-app", `${CLAUDE_MAIN}.jsonl`))).toBe(true);
  });

  it("rejects a malformed prune age", async () => {
    const { pruneCommand, UsageError } = await import("./commands");
    expect(() => pruneCommand("30")).toThrow(UsageError);
  });
});

describe("package", () => {
  it("reports the published package version", () => {
    // main.ts runs the CLI on import, so read the constant from source.
    const VERSION = /export const VERSION = "([^"]+)"/.exec(
      readFileSync(join(ROOT, "apps/cli/src/main.ts"), "utf8"),
    )?.[1];
    const pkg = JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8"));
    expect(pkg.name).toBe("landed-agents");
    expect(VERSION).toBe(pkg.version);
  });
});
