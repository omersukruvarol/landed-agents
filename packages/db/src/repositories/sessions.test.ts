import { describe, expect, it } from "vitest";
import { threadSessions, threads } from "../schema";
import { memoryDb, NOW, sessionInput, T0, T1, T2 } from "../test-helpers";
import { upsertRepo } from "./repos";
import {
  getSessionByProviderId,
  listSessions,
  setSessionOutcomeSummary,
  upsertSession,
} from "./sessions";

describe("upsertSession", () => {
  it("inserts once per (provider, providerSessionId) and keeps the id on update", () => {
    const { db } = memoryDb();
    const a = upsertSession(db, sessionInput(), NOW);
    const b = upsertSession(
      db,
      sessionInput({ status: "completed", eventCount: 5, lastEventAt: T2 }),
      NOW + 1,
    );
    expect(b.id).toBe(a.id);
    expect(b.status).toBe("completed");
    expect(b.eventCount).toBe(5);
    expect(listSessions(db)).toHaveLength(1);
  });

  it("treats the same vendor id under another provider as a different session", () => {
    const { db } = memoryDb();
    upsertSession(db, sessionInput(), NOW);
    upsertSession(db, sessionInput({ provider: "claude-code" }), NOW);
    expect(listSessions(db)).toHaveLength(2);
  });

  it("validates input against the domain schema", () => {
    const { db } = memoryDb();
    expect(() =>
      upsertSession(db, sessionInput({ endedAt: "2026-09-01T00:00:00.000Z" }), NOW),
    ).toThrow();
    expect(listSessions(db)).toHaveLength(0);
  });

  it("does not let an importer re-scan wipe fields owned by later stages", () => {
    const { db } = memoryDb();
    const s = upsertSession(db, sessionInput(), NOW);
    setSessionOutcomeSummary(db, s.id, { landed: 3, lost: 1 }, NOW);
    const again = upsertSession(db, sessionInput({ eventCount: 9 }), NOW + 1);
    expect(again.outcomeSummary).toEqual({ landed: 3, lost: 1 });
    expect(again.eventCount).toBe(9);
  });

  it("round-trips every optional field", () => {
    const { db } = memoryDb();
    const repo = upsertRepo(db, { rootPath: "/r/app" }, NOW);
    const input = sessionInput({
      endedAt: T2,
      lastEventAt: T2,
      status: "completed",
      cwd: "/r/app/sub",
      repoId: repo.id,
      repoRoot: "/r/app",
      projectName: "app",
      gitBranchStart: "main",
      gitBranchEnd: "feat/x",
      gitHeadStart: "aaa1111",
      gitHeadEnd: "bbb2222",
      model: "m-1",
      title: "feat/x",
      titleProvenance: "observed",
      eventCount: 10,
      failureCount: 2,
      changedFileCount: 3,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 20,
      reasoningTokens: 5,
      usageCoverage: "partial",
      sourceFiles: ["/x/a.jsonl", "/x/b.jsonl"],
    });
    const saved = upsertSession(db, input, NOW);
    expect(getSessionByProviderId(db, "codex", "sess-1")).toEqual({ ...input, id: saved.id });
  });
});

describe("listSessions", () => {
  function seed() {
    const handle = memoryDb();
    const { db } = handle;
    const repoA = upsertRepo(db, { rootPath: "/r/a" }, NOW);
    const repoB = upsertRepo(db, { rootPath: "/r/b" }, NOW);
    // yesterday, ended
    upsertSession(
      db,
      sessionInput({
        providerSessionId: "s-yesterday",
        startedAt: "2026-09-30T10:00:00.000Z",
        lastEventAt: "2026-09-30T11:00:00.000Z",
        endedAt: "2026-09-30T11:00:00.000Z",
        repoId: repoA.id,
        status: "completed",
      }),
      NOW,
    );
    // started yesterday evening, ran past midnight
    upsertSession(
      db,
      sessionInput({
        provider: "claude-code",
        providerSessionId: "s-overnight",
        startedAt: "2026-09-30T23:00:00.000Z",
        lastEventAt: "2026-10-01T01:00:00.000Z",
        repoId: repoB.id,
      }),
      NOW,
    );
    // today
    upsertSession(
      db,
      sessionInput({
        providerSessionId: "s-today",
        startedAt: T0,
        lastEventAt: T1,
        repoId: repoA.id,
        status: "failed",
      }),
      NOW,
    );
    return { ...handle, repoA, repoB };
  }

  const ids = (list: { providerSessionId: string }[]) => list.map((s) => s.providerSessionId);

  it("returns sessions active during a day, including ones that started the day before", () => {
    const { db } = seed();
    const today = listSessions(db, {
      activeFrom: "2026-10-01T00:00:00.000Z",
      activeTo: "2026-10-02T00:00:00.000Z",
    });
    expect(ids(today)).toEqual(["s-today", "s-overnight"]);
  });

  it("filters by provider, project (repo) and status", () => {
    const { db, repoA, repoB } = seed();
    expect(ids(listSessions(db, { provider: "claude-code" }))).toEqual(["s-overnight"]);
    expect(ids(listSessions(db, { repoId: repoA.id }))).toEqual(["s-today", "s-yesterday"]);
    expect(ids(listSessions(db, { repoId: repoB.id }))).toEqual(["s-overnight"]);
    expect(ids(listSessions(db, { status: "failed" }))).toEqual(["s-today"]);
  });

  it("paginates most-recent first", () => {
    const { db } = seed();
    expect(ids(listSessions(db, { limit: 1 }))).toEqual(["s-today"]);
    expect(ids(listSessions(db, { limit: 1, offset: 1 }))).toEqual(["s-overnight"]);
  });

  it("exposes thread membership", () => {
    const { db, repoA } = seed();
    const s = listSessions(db, { status: "failed" })[0];
    if (!s) throw new Error("seed missing");
    const threadId = "01K6F0000000000000000THRD0";
    db.insert(threads)
      .values({
        id: threadId,
        repoId: repoA.id,
        startedAt: NOW,
        lastActivityAt: NOW,
        title: "t",
        titleProvenance: "observed",
        status: "active",
        providers: ["codex"],
        linkEvidence: [],
      })
      .run();
    db.insert(threadSessions).values({ threadId, sessionId: s.id }).run();
    expect(listSessions(db, { status: "failed" })[0]?.threadId).toBe(threadId);
  });
});
