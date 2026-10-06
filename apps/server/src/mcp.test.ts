import { PassThrough } from "node:stream";
import type { AgentPatch, NormalizedEvent } from "@landed/core";
import {
  insertEvents,
  insertPatches,
  type LandedDb,
  openDatabase,
  replaceThreads,
  syncOpenLoops,
  upsertOutcomes,
  upsertRepo,
  upsertSession,
} from "@landed/db";
import { newUlid } from "@landed/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer, createMemoryTools, MCP_INSTRUCTIONS, serveStdio } from "./mcp";
import { privacyFilter, queryTerms } from "./memory";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ROOT = "/Users/dev/acme-app";
const CANARY_TOKEN = `ghp_${"C".repeat(36)}`;

function seed() {
  const { db } = openDatabase(":memory:");
  const repo = upsertRepo(db, { rootPath: ROOT });
  const session = (o: Parameters<typeof upsertSession>[1]) => upsertSession(db, o);
  const base = {
    status: "completed" as const,
    eventCount: 3,
    failureCount: 0,
    changedFileCount: 1,
    sourceFiles: ["/x"],
    repoId: repo.id,
    repoRoot: ROOT,
  };
  // Running now, on a feature branch, editing the retry code.
  const live = session({
    ...base,
    provider: "claude-code",
    providerSessionId: "live-1",
    startedAt: ago(30),
    lastEventAt: ago(1),
    status: "active",
    gitBranchStart: "feat/webhook-retry",
    title: "Fix webhook retries",
    titleProvenance: "observed",
  });
  // Two days ago: an attempt at backoff that never landed and kept failing tests.
  const old = session({
    ...base,
    provider: "codex",
    providerSessionId: "old-1",
    startedAt: ago(2 * 1440 + 60),
    lastEventAt: ago(2 * 1440),
    gitBranchStart: "feat/exponential-backoff",
    title: `Try exponential backoff with ${CANARY_TOKEN}`,
    titleProvenance: "observed",
  });
  const patch = (sessionId: string, rel: string, minutesAgo: number): AgentPatch => ({
    id: newUlid(),
    sessionId,
    provider: sessionId === live.id ? "claude-code" : "codex",
    toolCallId: newUlid(),
    timestamp: ago(minutesAgo),
    repoId: repo.id,
    path: `${ROOT}/${rel}`,
    relPath: rel,
    operation: "modify",
    addedLineFps: [],
    removedLineFps: [],
    addedLineCountRaw: 3,
    removedLineCountRaw: 1,
    sourceRef: { file: "/x", offset: 0, parserVersion: "test@1" },
  });
  insertPatches(db, [
    patch(live.id, "src/webhooks/retry.ts", 20),
    patch(live.id, "src/webhooks/queue.ts", 5),
    patch(old.id, "src/webhooks/backoff.ts", 2 * 1440 + 30),
  ]);
  const outcome = (sessionId: string, relPath: string, cls: "landed" | "uncommitted" | "lost") => ({
    id: newUlid(),
    scope: "session-file" as const,
    sessionId,
    repoId: repo.id,
    relPath,
    class: cls,
    survival: cls === "landed" ? ("surviving" as const) : ("unknown" as const),
    fracCommitted: cls === "landed" ? 1 : 0,
    fracOnDefaultBranch: 0,
    fracInWorkingTree: cls === "uncommitted" ? 1 : 0,
    ...(cls === "landed"
      ? { firstCommit: { sha: "abcdef1234567", time: ago(10), subject: "feat: retry webhooks" } }
      : {}),
    lineCount: 3,
    provenance: "derived" as const,
    computedAt: ago(0),
    engineVersion: "outcomes@3",
  });
  upsertOutcomes(db, [
    outcome(live.id, "src/webhooks/retry.ts", "landed"),
    outcome(live.id, "src/webhooks/queue.ts", "uncommitted"),
    outcome(old.id, "src/webhooks/backoff.ts", "lost"),
  ]);
  const failed = (i: number): NormalizedEvent => ({
    id: newUlid(),
    schemaVersion: 1,
    provider: "codex",
    providerEventType: "item_completed",
    sessionId: "old-1",
    timestamp: ago(2 * 1440 + 20 - i),
    receivedAt: ago(0),
    eventType: "command.failed",
    command: { executable: "pnpm", display: "pnpm test webhooks", exitCode: 1 },
    privacy: {
      promptCaptured: false,
      argumentsCaptured: false,
      resultCaptured: false,
      redactionsApplied: 0,
    },
  });
  insertEvents(db, old.id, [failed(0), failed(1), failed(2)]);
  const thread = (id: string, s: typeof live, title: string, branch: string) => ({
    id,
    repoId: repo.id,
    sessionIds: [s.id],
    providers: [s.provider],
    startedAt: s.startedAt,
    lastActivityAt: s.lastEventAt,
    title,
    titleProvenance: "observed" as const,
    branch,
    status: "dangling" as const,
    linkEvidence: [],
  });
  replaceThreads(db, [
    thread(live.id, live, "webhook retry", "feat/webhook-retry"),
    thread(old.id, old, "exponential backoff", "feat/exponential-backoff"),
  ]);
  syncOpenLoops(
    db,
    [
      {
        key: "k1",
        id: newUlid(),
        type: "uncommitted-output",
        repoId: repo.id,
        threadId: live.id,
        sessionIds: [live.id],
        since: ago(5),
        size: { files: 1, lines: 3 },
        evidence: {},
        provenance: "derived",
        state: "open",
      },
    ],
    NOW,
  );
  return { db, repo, live, old };
}

function server(db: LandedDb | undefined, cwd = `${ROOT}/src`) {
  return createMcpServer(
    { name: "landed", version: "0.3.0", instructions: MCP_INSTRUCTIONS },
    createMemoryTools({ db: () => db, cwd, now: () => NOW }),
    { filter: privacyFilter },
  );
}

/** The official MCP client, talking to our server — a protocol conformance check. */
async function connect(db: LandedDb | undefined, cwd?: string) {
  const s = server(db, cwd);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  serverSide.onmessage = (m) => {
    const r = s.handle(m);
    if (r) void serverSide.send(r as never);
  };
  await serverSide.start();
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  return client;
}

const structured = (r: unknown) =>
  (r as { structuredContent: Record<string, unknown> }).structuredContent;

describe("MCP server", () => {
  it("speaks MCP to the official client and lists read-only tools", async () => {
    const client = await connect(seed().db);
    expect(client.getServerVersion()).toEqual({ name: "landed", version: "0.3.0" });
    expect(client.getInstructions()).toContain("read-only");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "active_sessions",
      "open_loops",
      "prior_attempts",
      "recent_work",
      "resume_packet",
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("recent_work: sessions in the working directory's repo with per-file outcomes", async () => {
    const client = await connect(seed().db);
    const r = structured(await client.callTool({ name: "recent_work", arguments: {} }));
    expect(r.repo).toBe("acme-app");
    const sessions = r.sessions as { agent: string; running: boolean; files: unknown[] }[];
    expect(sessions.map((s) => s.agent)).toEqual(["Claude Code", "Codex"]);
    expect(sessions[0]?.running).toBe(true);
    expect(sessions[0]?.files).toEqual([
      expect.objectContaining({ path: "src/webhooks/queue.ts", outcome: "uncommitted" }),
      expect.objectContaining({
        path: "src/webhooks/retry.ts",
        outcome: "landed",
        commit: { sha: "abcdef1", subject: "feat: retry webhooks" },
      }),
    ]);

    const narrowed = structured(
      await client.callTool({
        name: "recent_work",
        arguments: { path: `${ROOT}/src/webhooks/backoff.ts`, days: 7 },
      }),
    );
    expect(narrowed.path).toBe("src/webhooks/backoff.ts");
    expect((narrowed.sessions as unknown[]).length).toBe(1);
  });

  it("active_sessions: flags other sessions editing the paths you plan to touch", async () => {
    const client = await connect(seed().db);
    const r = structured(
      await client.callTool({
        name: "active_sessions",
        arguments: { repo: ROOT, paths: ["src/webhooks"] },
      }),
    );
    const active = r.activeSessions as { agent: string; overlapsWithYourPaths: string[] }[];
    expect(active).toHaveLength(1); // the two-day-old session is not active
    expect(active[0]?.overlapsWithYourPaths.sort()).toEqual([
      "src/webhooks/queue.ts",
      "src/webhooks/retry.ts",
    ]);
    expect(r.conflicts).toBe(1);
  });

  it("open_loops: describes dangling work with a thread to resume", async () => {
    const { db, live } = seed();
    const client = await connect(db);
    const r = structured(
      await client.callTool({ name: "open_loops", arguments: { repo: "acme-app" } }),
    );
    const loops = r.openLoops as { threadId: string; description: string }[];
    expect(loops).toHaveLength(1);
    expect(loops[0]?.threadId).toBe(live.id);
  });

  it("prior_attempts: finds an attempt that did not land and what kept failing", async () => {
    const { db, old } = seed();
    const client = await connect(db);
    const r = structured(
      await client.callTool({
        name: "prior_attempts",
        arguments: { query: "exponential backoff" },
      }),
    );
    const [first] = r.attempts as {
      threadId: string;
      result: string;
      failedCommands: { command: string; failures: number }[];
      notLanded: { path: string; outcome: string }[];
    }[];
    expect(first?.threadId).toBe(old.id);
    expect(first?.result).toMatch(/^Did not land/);
    expect(first?.failedCommands).toEqual([
      expect.objectContaining({ command: "pnpm test webhooks", failures: 3 }),
    ]);
    expect(first?.notLanded).toEqual([{ path: "src/webhooks/backoff.ts", outcome: "lost" }]);

    const byFile = structured(
      await client.callTool({ name: "prior_attempts", arguments: { query: "retry.ts" } }),
    );
    expect((byFile.attempts as { matchedOn: string[] }[])[0]?.matchedOn).toContain("file");
  });

  it("resume_packet: a readable handoff, defaulting to the latest edited thread", async () => {
    const { db, live } = seed();
    const client = await connect(db);
    const r = await client.callTool({ name: "resume_packet", arguments: {} });
    const p = structured(r);
    expect(p.threadId).toBe(live.id);
    expect(p.uncommitted).toEqual(["src/webhooks/queue.ts"]);
    const text = (r.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain('Resume: "webhook retry" in acme-app (branch feat/webhook-retry)');
    expect(text).toContain("abcdef1 feat: retry webhooks");
    expect(text).toContain("Uncommitted (only in the working tree):\n  - src/webhooks/queue.ts");
  });

  it("returns tool errors, not crashes, for unknown repos and missing data", async () => {
    const outside = await connect(seed().db, "/Users/dev/elsewhere");
    const r = await outside.callTool({ name: "recent_work", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]?.text).toContain("no agent history");

    const empty = await connect(undefined);
    const e = await empty.callTool({ name: "open_loops", arguments: {} });
    expect(e.isError).toBe(true);
    expect((e.content as { text: string }[])[0]?.text).toContain("landed scan");

    const bad = await outside.callTool({ name: "recent_work", arguments: { days: 0 } });
    expect(bad.isError).toBe(true);
    await expect(outside.callTool({ name: "drop_tables", arguments: {} })).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it("privacy: secrets are redacted and no absolute paths are returned", async () => {
    const client = await connect(seed().db);
    const outputs = [];
    for (const [name, args] of [
      ["recent_work", {}],
      ["active_sessions", { paths: ["src"] }],
      ["open_loops", {}],
      ["prior_attempts", { query: "backoff" }],
      ["resume_packet", {}],
    ] as const)
      outputs.push(JSON.stringify(await client.callTool({ name, arguments: args })));
    const all = outputs.join("\n");
    expect(all).toContain("exponential backoff");
    expect(all).not.toContain(CANARY_TOKEN);
    expect(all).not.toContain(ROOT);
  });
});

describe("MCP protocol edges", () => {
  it("ignores notifications, rejects unknown methods, and reports parse errors over stdio", async () => {
    const s = server(seed().db);
    expect(s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(s.handle({ jsonrpc: "2.0", id: 1, method: "resources/list" })).toMatchObject({
      error: { code: -32601 },
    });
    expect(
      s.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      }),
    ).toMatchObject({ result: { protocolVersion: "2025-11-25" } });

    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (c) => chunks.push(String(c)));
    const done = serveStdio(s, input, output);
    input.end('not json\n{"jsonrpc":"2.0","id":7,"method":"ping"}\n');
    await done;
    const lines = chunks
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: 7, result: {} },
    ]);
  });

  it("privacy filter: redacts secrets, hides home directories, caps length", () => {
    const out = privacyFilter({
      command: `cd /Users/jane/work/app && TOKEN=${CANARY_TOKEN} pnpm test`,
      other: "/home/jane/x.sh failed",
      list: ["ls /Users/jane", "src/a.ts"],
      long: "x".repeat(900),
      text: "y".repeat(900),
    });
    expect(out.command).toBe("cd ~/work/app && TOKEN=[REDACTED] pnpm test");
    expect(out.other).toBe("~/x.sh failed");
    expect(out.list).toEqual(["ls ~", "src/a.ts"]);
    expect(out.long).toHaveLength(501);
    expect(out.text).toHaveLength(900);
  });

  it("splits queries into useful terms", () => {
    expect(queryTerms("Fix the webhook retry in retry.ts")).toEqual([
      "webhook",
      "retry",
      "retry.ts",
    ]);
    expect(queryTerms("a b")).toEqual([]);
  });
});
