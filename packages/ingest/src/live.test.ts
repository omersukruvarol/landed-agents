import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import { getSessionByProviderId, listSessions, openDatabase } from "@landed/db";
import { describe, expect, it } from "vitest";
import { createLiveCollector, type LiveEvent, type Notice } from "./live";
import { tempDir } from "./test-helpers";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/claude/2.1");
const MAIN = "11111111-1111-4111-8111-111111111111";
const AWAIT = "22222222-2222-4222-8222-222222222222";
const fingerprinter = createLineFingerprinter(parseInstallSecret("q".repeat(43)));

async function until(cond: () => boolean, ms = 25_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for the collector");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A second, unrelated session editing the same file while the first is still running. */
function otherEditor(repo: string): string {
  const base = {
    sessionId: "55555555-5555-4555-8555-555555555555",
    cwd: repo,
    version: "2.1.281",
    isSidechain: false,
  };
  // Runs while the main session is still active (08:00–08:03): a real collision, not a handoff.
  return [
    {
      ...base,
      type: "user",
      uuid: "o1",
      timestamp: "2026-09-30T08:02:00.000Z",
      message: { role: "user", content: "CANARY_OTHER" },
    },
    {
      ...base,
      type: "assistant",
      uuid: "o2",
      timestamp: "2026-09-30T08:02:05.000Z",
      message: {
        id: "msg_o1",
        model: "m",
        content: [
          {
            type: "tool_use",
            id: "toolu_o1",
            name: "Edit",
            input: { file_path: `${repo}/src/retry.ts` },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      ...base,
      type: "user",
      uuid: "o3",
      timestamp: "2026-09-30T08:02:06.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_o1", content: "ok" }],
      },
      toolUseResult: {
        filePath: `${repo}/src/retry.ts`,
        structuredPatch: [{ lines: ["+const otherAgentLine = computeSomething(1);"] }],
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n")
    .concat("\n");
}

describe("live collector", () => {
  it("imports changed files within seconds and raises each notice once", {
    timeout: 30_000,
  }, async () => {
    const home = tempDir();
    const repo = join(home, "app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const project = join(home, "claude", "projects", "-app");
    mkdirSync(project, { recursive: true });
    mkdirSync(join(home, "codex", "sessions"), { recursive: true });
    const { db } = openDatabase(":memory:");
    const events: LiveEvent[] = [];
    const notices: Notice[] = [];
    const live = createLiveCollector({
      db,
      fingerprinter,
      claudeRoot: join(home, "claude", "projects"),
      codexRoot: join(home, "codex", "sessions"),
      onEvent: (e) => events.push(e),
      notify: (n) => notices.push(n),
      importDebounceMs: 100,
      analysisQuietMs: 60_000,
      // Live notices only consider the last hour; both fixture edits fall inside it.
      now: () => Date.parse("2026-09-30T08:30:00.000Z"),
    });
    live.start();
    try {
      const fx = (name: string) =>
        readFileSync(join(FIXTURES, name), "utf8").replaceAll("{{REPO}}", repo);
      // touch() is what the watcher calls; using it keeps this test independent of FSEvents timing
      // (the watcher itself is covered separately below).
      writeFileSync(join(project, `${MAIN}.jsonl`), fx("session-main.jsonl"));
      live.touch(join(project, `${MAIN}.jsonl`));
      await until(() => events.some((e) => e.type === "import"));
      expect(getSessionByProviderId(db, "claude-code", MAIN)?.eventCount).toBe(22);

      writeFileSync(join(project, `${AWAIT}.jsonl`), fx("session-awaiting.jsonl"));
      live.touch(join(project, `${AWAIT}.jsonl`));
      await until(() => notices.some((n) => n.kind === "awaiting-user"));

      appendFileSync(
        join(project, "55555555-5555-4555-8555-555555555555.jsonl"),
        otherEditor(repo),
      );
      await until(() => notices.some((n) => n.kind === "collision"));
      expect(notices.find((n) => n.kind === "collision")?.message).toContain("src/retry.ts");
      // Structured fields let each surface word the notice in the user's language.
      expect(notices.find((n) => n.kind === "collision")).toMatchObject({
        relPath: "src/retry.ts",
        repo: "app",
      });

      // Nothing new: touching a file again must not repeat notices.
      live.touch(join(project, `${AWAIT}.jsonl`));
      await live.flush();
      expect(notices.filter((n) => n.kind === "awaiting-user")).toHaveLength(1);
      expect(JSON.stringify(notices)).not.toMatch(/CANARY_/);
      expect(listSessions(db)).toHaveLength(3);
    } finally {
      live.stop();
    }
  });

  it("does not announce what was already there when it starts", async () => {
    const home = tempDir();
    mkdirSync(join(home, "claude", "projects"), { recursive: true });
    const { db } = openDatabase(":memory:");
    const notices: Notice[] = [];
    const live = createLiveCollector({
      db,
      fingerprinter,
      claudeRoot: join(home, "claude", "projects"),
      codexRoot: join(home, "nope"),
      notify: (n) => notices.push(n),
    });
    live.start();
    live.stop();
    expect(notices).toEqual([]);
  });

  it("serializes work through exclusive()", async () => {
    const { db } = openDatabase(":memory:");
    const live = createLiveCollector({
      db,
      fingerprinter,
      claudeRoot: "/nonexistent/a",
      codexRoot: "/nonexistent/b",
    });
    const order: string[] = [];
    await Promise.all([
      live.exclusive(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push("first");
      }),
      live.exclusive(async () => {
        order.push("second");
      }),
    ]);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("live collector — file watcher", () => {
  it("picks up a new session file without being told", { timeout: 60_000 }, async () => {
    const home = tempDir();
    const project = join(home, "claude", "projects", "-app");
    mkdirSync(project, { recursive: true });
    const { db } = openDatabase(":memory:");
    const events: LiveEvent[] = [];
    const live = createLiveCollector({
      db,
      fingerprinter,
      claudeRoot: join(home, "claude", "projects"),
      codexRoot: join(home, "codex"),
      onEvent: (e) => events.push(e),
      importDebounceMs: 100,
    });
    live.start();
    try {
      const file = join(project, `${MAIN}.jsonl`);
      const lines = readFileSync(join(FIXTURES, "session-main.jsonl"), "utf8").split("\n");
      writeFileSync(file, `${lines.slice(0, 10).join("\n")}\n`);
      // FSEvents can coalesce or delay events under heavy load; a second write re-triggers it.
      await until(() => events.some((e) => e.type === "import"), 15_000).catch(() =>
        appendFileSync(file, `${lines.slice(10, 20).join("\n")}\n`),
      );
      await until(() => events.some((e) => e.type === "import"), 30_000);
      expect(listSessions(db)).toHaveLength(1);
    } finally {
      live.stop();
    }
  });
});

describe("live collector — hooks", () => {
  it("records a permission request as awaiting-user and notifies once", async () => {
    const home = tempDir();
    const repo = join(home, "app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const project = join(home, "claude", "projects", "-app");
    mkdirSync(project, { recursive: true });
    const transcript = join(project, `${MAIN}.jsonl`);
    writeFileSync(
      transcript,
      readFileSync(join(FIXTURES, "session-main.jsonl"), "utf8").replaceAll("{{REPO}}", repo),
    );
    const { db } = openDatabase(":memory:");
    const notices: Notice[] = [];
    const live = createLiveCollector({
      db,
      fingerprinter,
      claudeRoot: join(home, "claude", "projects"),
      codexRoot: join(home, "codex", "sessions"),
      notify: (n) => notices.push(n),
      now: () => Date.parse("2026-09-30T08:30:00.000Z"),
    });
    const { normalizeClaudeHook } = await import("@landed/importer-claude");
    const signal = normalizeClaudeHook(
      {
        session_id: MAIN,
        transcript_path: transcript,
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "x" },
      },
      "2026-09-30T08:29:00.000Z",
    );
    if (!signal) throw new Error("no signal");
    await live.recordHook(signal);
    expect(getSessionByProviderId(db, "claude-code", MAIN)?.status).toBe("awaiting-user");
    expect(notices.map((n) => n.kind)).toEqual(["awaiting-user"]);
    await live.recordHook(signal);
    expect(notices).toHaveLength(1);
    live.stop();
  });
});
