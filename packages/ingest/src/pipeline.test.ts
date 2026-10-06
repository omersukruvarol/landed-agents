import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLineFingerprinter, parseInstallSecret } from "@landed/core/fingerprint";
import {
  getCheckpoint,
  getSessionByProviderId,
  type LandedDb,
  listEvents,
  listPatches,
  listSessions,
  openDatabase,
  saveCheckpoint,
} from "@landed/db";
import { describe, expect, it } from "vitest";
import { claudeImporter } from "./claude";
import { importSource } from "./pipeline";
import { tempDir } from "./test-helpers";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/claude/2.1");
const MAIN = "11111111-1111-4111-8111-111111111111";
const AWAIT = "22222222-2222-4222-8222-222222222222";
const ERR = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-10-02T00:00:00.000Z");
const fingerprinter = createLineFingerprinter(parseInstallSecret("q".repeat(43)));

function setup() {
  const home = tempDir();
  const repo = join(home, "app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  const projects = join(home, "projects");
  const project = join(projects, "-tmp-app");
  const subDir = join(project, MAIN, "subagents");
  mkdirSync(subDir, { recursive: true });
  const fx = (name: string) =>
    readFileSync(join(FIXTURES, name), "utf8").replaceAll("{{REPO}}", repo);
  const mainFile = join(project, `${MAIN}.jsonl`);
  writeFileSync(mainFile, fx("session-main.jsonl"));
  writeFileSync(join(project, `${AWAIT}.jsonl`), fx("session-awaiting.jsonl"));
  writeFileSync(join(project, `${ERR}.jsonl`), fx("session-api-error.jsonl"));
  writeFileSync(join(subDir, "agent-a1b2c3.jsonl"), fx("subagent.jsonl"));
  writeFileSync(join(subDir, "agent-a1b2c3.meta.json"), fx("subagent.meta.json"));
  const { db, sqlite } = openDatabase(":memory:");
  const run = () =>
    importSource(claudeImporter, { db, fingerprinter, root: projects, now: () => NOW });
  return { db, sqlite, repo, mainFile, run };
}

const session = (db: LandedDb, id: string) => {
  const s = getSessionByProviderId(db, "claude-code", id);
  if (!s) throw new Error(`missing session ${id}`);
  return s;
};

describe("importSource(claude)", () => {
  it("imports sessions, events, patches and usage from a transcript tree", async () => {
    const { db, repo, run } = setup();
    const report = await run();
    expect(report).toMatchObject({
      filesSeen: 4,
      filesRead: 4,
      filesUnchanged: 0,
      failures: 1,
      eventsWithoutSession: 0,
      unknownTypes: { "hologram-sync": 1 },
      patches: { inserted: 3, duplicates: 0 },
    });
    expect(listSessions(db)).toHaveLength(4);

    const main = session(db, MAIN);
    expect(main).toMatchObject({
      status: "completed",
      repoRoot: repo,
      projectName: "app",
      title: "Webhook retry fix",
      titleProvenance: "observed",
      gitBranchStart: "feat/retry",
      eventCount: 22,
      failureCount: 2, // failed Bash + failed Edit; the denied call is not a failure
      changedFileCount: 2,
      inputTokens: 145,
      outputTokens: 300,
      cachedInputTokens: 18_800,
      usageCoverage: "complete",
      estimatedCostUsd: 1.25,
    });
    expect(main.repoId).toBeDefined();

    const sub = session(db, `${MAIN}:a1b2c3`);
    expect(sub).toMatchObject({
      parentSessionId: main.id,
      status: "completed",
      changedFileCount: 1,
    });
    expect(session(db, AWAIT).status).toBe("awaiting-user");
    expect(session(db, ERR).status).toBe("failed");

    const patches = listPatches(db, { repoId: main.repoId ?? "" });
    expect(new Set(patches.map((p) => p.relPath))).toEqual(
      new Set(["src/retry.ts", "src/backoff.ts", "src/config.ts"]),
    );
  });

  it("is idempotent: an unchanged tree imports nothing", async () => {
    const { db, run } = setup();
    await run();
    const before = listEvents(db).length;
    const again = await run();
    expect(again).toMatchObject({
      filesRead: 0,
      filesUnchanged: 4,
      events: { inserted: 0, duplicates: 0 },
    });
    expect(listEvents(db)).toHaveLength(before);
  });

  it("reads only appended lines and updates status", async () => {
    const { db, mainFile, run } = setup();
    await run();
    const offset = getCheckpoint(db, mainFile)?.byteOffset;
    const common = { sessionId: MAIN, cwd: "/x", version: "2.1.281", isSidechain: false };
    appendFileSync(
      mainFile,
      `${JSON.stringify({ ...common, type: "user", uuid: "n1", timestamp: "2026-09-30T12:00:00.000Z", message: { role: "user", content: "CANARY_NEW_PROMPT" } })}\n` +
        `${JSON.stringify({ ...common, type: "assistant", uuid: "n2", timestamp: "2026-09-30T12:00:05.000Z", message: { id: "msg_n", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "toolu_n", name: "Bash", input: { command: "pnpm lint" } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } } })}\n`,
    );
    const r = await run();
    expect(r).toMatchObject({ filesRead: 1, linesRead: 2, events: { inserted: 2, duplicates: 0 } });
    expect(getCheckpoint(db, mainFile)?.byteOffset).toBeGreaterThan(offset ?? 0);
    const main = session(db, MAIN);
    expect(main.status).toBe("unknown"); // a command is still open
    expect(main.lastEventAt).toBe("2026-09-30T12:00:05.000Z");
    expect(main.eventCount).toBe(24);
  });

  it("waits for a partial trailing line to be completed", async () => {
    const { db, mainFile, run } = setup();
    await run();
    const offset = getCheckpoint(db, mainFile)?.byteOffset;
    const line = JSON.stringify({
      type: "user",
      sessionId: MAIN,
      uuid: "p1",
      timestamp: "2026-09-30T13:00:00.000Z",
      message: { content: "hi" },
    });
    appendFileSync(mainFile, line.slice(0, 20));
    expect(await run()).toMatchObject({ linesRead: 0, events: { inserted: 0 } });
    expect(getCheckpoint(db, mainFile)?.byteOffset).toBe(offset);
    appendFileSync(mainFile, `${line.slice(20)}\n`);
    expect(await run()).toMatchObject({ linesRead: 1, events: { inserted: 1 } });
  });

  it("re-imports a rewritten file from scratch without duplicates", async () => {
    const { db, mainFile, run } = setup();
    await run();
    const lines = readFileSync(mainFile, "utf8").split("\n");
    writeFileSync(mainFile, `${lines.slice(0, 6).join("\n")}\n`); // shorter: truncated
    const r = await run();
    expect(r.filesReset).toBe(1);
    const main = session(db, MAIN);
    expect(listEvents(db, { sessionId: main.id }).length).toBe(main.eventCount);
    expect(main.eventCount).toBe(3); // prompt, command.started, command.failed
  });

  it("re-imports after a parser version change without duplicating rows", async () => {
    const { db, mainFile, run } = setup();
    await run();
    const before = { events: listEvents(db).length, patches: listPatches(db).length };
    const cp = getCheckpoint(db, mainFile);
    if (!cp) throw new Error("no checkpoint");
    saveCheckpoint(db, { ...cp, parserVersion: "claude-code@0" });
    const r = await run();
    expect(r.filesReset).toBe(1);
    expect({ events: listEvents(db).length, patches: listPatches(db).length }).toEqual(before);
  });

  it("stores no prompt, code, tool output or secrets anywhere in the database", async () => {
    const { sqlite, run } = setup();
    await run();
    const tables = sqlite
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite%' and name not like '\\_\\_%' escape '\\'",
      )
      .all() as { name: string }[];
    const dump = tables
      .map(({ name }) => JSON.stringify(sqlite.prepare(`select * from "${name}"`).all()))
      .join("\n");
    expect(dump.length).toBeGreaterThan(1000);
    expect(dump).not.toMatch(/CANARY_/);
    expect(dump).not.toContain("ghp_");
  });
});

describe("importSource(claude) — resumed sessions", () => {
  const RESUMED = "44444444-4444-4444-8444-444444444444";

  it("attributes copied history to the original session only", async () => {
    const { db, mainFile, run } = setup();
    // Claude writes a resumed session as a new file that repeats the old lines (same uuids,
    // timestamps, message and tool ids) under the new session id, then continues.
    const copied = readFileSync(mainFile, "utf8").replaceAll(MAIN, RESUMED);
    const common = { sessionId: RESUMED, cwd: "/x", version: "2.1.281", isSidechain: false };
    const fresh =
      `${JSON.stringify({ ...common, type: "user", uuid: "r1", timestamp: "2026-09-30T14:00:00.000Z", message: { role: "user", content: "CANARY_RESUMED_PROMPT" } })}\n` +
      `${JSON.stringify({ ...common, type: "assistant", uuid: "r2", timestamp: "2026-09-30T14:00:09.000Z", message: { id: "msg_r1", model: "claude-opus-5-5", content: [{ type: "text", text: "CANARY_R" }], stop_reason: "end_turn", usage: { input_tokens: 7, output_tokens: 11 } } })}\n`;
    await run(); // the original is imported first, as oldest-first listing guarantees
    const original = session(db, MAIN);
    writeFileSync(join(mainFile, "..", `${RESUMED}.jsonl`), copied + fresh);
    const r = await run();

    expect(r.copiedFromOtherSessions.events).toBe(22);
    expect(r.copiedFromOtherSessions.patches).toBe(2);
    expect(r.copiedFromOtherSessions.usage).toBe(8);
    expect(session(db, MAIN)).toMatchObject({
      eventCount: original.eventCount,
      outputTokens: original.outputTokens,
      changedFileCount: 2,
    });
    expect(session(db, RESUMED)).toMatchObject({
      startedAt: "2026-09-30T14:00:00.000Z",
      eventCount: 2,
      changedFileCount: 0,
      inputTokens: 7,
      outputTokens: 11,
      status: "completed",
    });
    expect(listPatches(db)).toHaveLength(3);
  });

  it("keeps ownership with the older session when both arrive in one scan", async () => {
    const { db, mainFile, run } = setup();
    const copied = readFileSync(mainFile, "utf8").replaceAll(MAIN, RESUMED);
    writeFileSync(join(mainFile, "..", `${RESUMED}.jsonl`), copied);
    await run();
    expect(session(db, MAIN).eventCount).toBe(22);
    expect(session(db, RESUMED).eventCount).toBe(0);
  });
});
