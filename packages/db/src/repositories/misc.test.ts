import { describe, expect, it } from "vitest";
import { memoryDb, NOW, sessionInput, T0, T1 } from "../test-helpers";
import { countIngestionFailures, MAX_FAILURE_MESSAGE, recordIngestionFailure } from "./failures";
import { getRepoByRoot, listRepos, markRepoMissing, upsertRepo } from "./repos";
import { upsertSession } from "./sessions";
import { getSetting, setSetting } from "./settings";
import { getCheckpoint, listSources, saveCheckpoint, upsertSource } from "./sources";
import { insertUsageRecords, sessionUsageTotals } from "./usage";

describe("usage records", () => {
  it("never counts the same provider usage key twice (PRD §17)", () => {
    const { db } = memoryDb();
    const s = upsertSession(db, sessionInput(), NOW);
    // A Claude API message split across several transcript lines repeats the same usage.
    const msg = {
      usageKey: "msg_01",
      timestamp: T0,
      inputTokens: 100,
      outputTokens: 40,
      cachedInputTokens: 900,
    };
    expect(insertUsageRecords(db, s.id, [msg, msg, msg])).toEqual({ inserted: 1, duplicates: 2 });
    insertUsageRecords(db, s.id, [
      { usageKey: "msg_02", timestamp: T1, inputTokens: 10, outputTokens: 5 },
    ]);
    expect(insertUsageRecords(db, s.id, [msg])).toEqual({ inserted: 0, duplicates: 1 });
    expect(sessionUsageTotals(db, s.id)).toEqual({
      records: 2,
      inputTokens: 110,
      outputTokens: 45,
      cachedInputTokens: 900,
      reasoningTokens: 0,
    });
  });

  it("keeps the largest value per field when a streamed message is rewritten", () => {
    const { db } = memoryDb();
    const s = upsertSession(db, sessionInput(), NOW);
    const partial = { usageKey: "msg_01", timestamp: T0, inputTokens: 100, outputTokens: 3 };
    const final = { ...partial, outputTokens: 250, model: "m-1" };
    insertUsageRecords(db, s.id, [partial, final]);
    insertUsageRecords(db, s.id, [partial]); // re-import of the earlier line must not shrink it
    expect(sessionUsageTotals(db, s.id)).toMatchObject({
      records: 1,
      inputTokens: 100,
      outputTokens: 250,
    });
  });

  it("rejects negative token counts", () => {
    const { db } = memoryDb();
    const s = upsertSession(db, sessionInput(), NOW);
    expect(() =>
      insertUsageRecords(db, s.id, [{ usageKey: "k", timestamp: T0, inputTokens: -1 }]),
    ).toThrow();
  });
});

describe("sources and checkpoints", () => {
  it("registers sources idempotently", () => {
    const { db } = memoryDb();
    const a = upsertSource(db, { provider: "codex", rootPath: "/h/.codex/sessions" }, NOW);
    const b = upsertSource(db, { provider: "codex", rootPath: "/h/.codex/sessions" }, NOW + 1);
    expect(b.id).toBe(a.id);
    expect(listSources(db)).toHaveLength(1);
  });

  it("stores and advances per-file checkpoints", () => {
    const { db } = memoryDb();
    const src = upsertSource(db, { provider: "claude-code", rootPath: "/h/.claude/projects" }, NOW);
    const cp = {
      sourceId: src.id,
      path: "/h/.claude/projects/p/s.jsonl",
      inode: 42,
      size: 1000,
      mtimeMs: NOW,
      byteOffset: 500,
      parserVersion: "claude@1",
    };
    expect(getCheckpoint(db, cp.path)).toBeUndefined();
    saveCheckpoint(db, cp, NOW);
    saveCheckpoint(db, { ...cp, size: 2000, byteOffset: 2000 }, NOW + 1);
    expect(getCheckpoint(db, cp.path)).toEqual({ ...cp, size: 2000, byteOffset: 2000 });
  });

  it("rejects an offset beyond the file size", () => {
    const { db } = memoryDb();
    const src = upsertSource(db, { provider: "codex", rootPath: "/s" }, NOW);
    expect(() =>
      saveCheckpoint(db, {
        sourceId: src.id,
        path: "/s/f",
        inode: 1,
        size: 10,
        mtimeMs: NOW,
        byteOffset: 11,
        parserVersion: "v",
      }),
    ).toThrow(RangeError);
  });
});

describe("repos", () => {
  it("upserts by root path and clears the missing flag when seen again", () => {
    const { db } = memoryDb();
    const r = upsertRepo(db, { rootPath: "/r/app" }, NOW);
    markRepoMissing(db, r.id);
    expect(getRepoByRoot(db, "/r/app")?.missing).toBe(true);
    const again = upsertRepo(db, { rootPath: "/r/app", defaultBranch: "main" }, NOW + 1);
    expect(again).toMatchObject({
      id: r.id,
      missing: false,
      defaultBranch: "main",
      lastSeenAt: NOW + 1,
    });
    expect(listRepos(db)).toHaveLength(1);
  });

  it("does not erase known metadata when a later upsert omits it", () => {
    const { db } = memoryDb();
    upsertRepo(db, { rootPath: "/r/app", remoteHash: "h1", defaultBranch: "main" }, NOW);
    expect(upsertRepo(db, { rootPath: "/r/app" }, NOW + 1)).toMatchObject({
      remoteHash: "h1",
      defaultBranch: "main",
    });
  });
});

describe("ingestion failures", () => {
  it("records each (file, offset, parser) once and truncates messages", () => {
    const { db, sqlite } = memoryDb();
    const f = {
      provider: "codex" as const,
      sourceFile: "/x/r.jsonl",
      offset: 5,
      parserVersion: "codex@1",
      reasonCode: "invalid-json",
      message: "x".repeat(1000),
    };
    expect(recordIngestionFailure(db, f, NOW)).toBe(true);
    expect(recordIngestionFailure(db, f, NOW)).toBe(false);
    expect(recordIngestionFailure(db, { ...f, parserVersion: "codex@2" }, NOW)).toBe(true);
    expect(countIngestionFailures(db)).toBe(2);
    expect(countIngestionFailures(db, "/other")).toBe(0);
    const row = sqlite.prepare("select message from ingestion_failures limit 1").get() as {
      message: string;
    };
    expect(row.message).toHaveLength(MAX_FAILURE_MESSAGE);
  });
});

describe("settings", () => {
  it("stores JSON values by key", () => {
    const { db } = memoryDb();
    expect(getSetting(db, "privacy")).toBeUndefined();
    setSetting(db, "privacy", { promptCapture: false }, NOW);
    setSetting(db, "privacy", { promptCapture: false, retention: "30d" }, NOW + 1);
    expect(getSetting(db, "privacy")).toEqual({ promptCapture: false, retention: "30d" });
  });
});

describe("pruneSessions", () => {
  it("removes old sessions and keeps recent ones", async () => {
    const { pruneSessions } = await import("./maintenance");
    const { db } = memoryDb();
    upsertSession(
      db,
      sessionInput({
        providerSessionId: "old",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastEventAt: "2026-01-01T01:00:00.000Z",
      }),
      NOW,
    );
    upsertSession(db, sessionInput({ providerSessionId: "new" }), NOW);
    expect(pruneSessions(db, Date.parse("2026-06-01T00:00:00.000Z"))).toBe(1);
  });
});
