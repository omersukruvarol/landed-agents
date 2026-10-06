import { describe, expect, it } from "vitest";
import { sessions } from "../schema";
import { event, memoryDb, NOW, sessionInput, T0, T1, T2 } from "../test-helpers";
import {
  countSessionEvents,
  deleteEventsBySourceFile,
  insertEvents,
  latestSessionEvents,
  listEvents,
} from "./events";
import { upsertSession } from "./sessions";

function setup() {
  const handle = memoryDb();
  const session = upsertSession(handle.db, sessionInput(), NOW);
  return { ...handle, session };
}

describe("insertEvents", () => {
  it("is idempotent: re-importing the same events inserts nothing", () => {
    const { db, session } = setup();
    const batch = [
      event({ providerEventId: "e1", timestamp: T0 }),
      event({ providerEventId: "e2", timestamp: T1, eventType: "command.failed" }),
    ];
    expect(insertEvents(db, session.id, batch)).toEqual({ inserted: 2, duplicates: 0 });
    // Same source events re-normalized on a later scan get fresh ids and receivedAt.
    const rescan = batch.map((e) =>
      event({ ...e, id: event().id, receivedAt: "2026-10-02T00:00:00.000Z" }),
    );
    expect(insertEvents(db, session.id, rescan)).toEqual({ inserted: 0, duplicates: 2 });
    expect(listEvents(db, { sessionId: session.id })).toHaveLength(2);
  });

  it("dedupes within a single batch", () => {
    const { db, session } = setup();
    const e = event({ providerEventId: "same" });
    expect(insertEvents(db, session.id, [e, { ...e, id: event().id }])).toEqual({
      inserted: 1,
      duplicates: 1,
    });
  });

  it("round-trips a fully populated event without loss", () => {
    const { db, session } = setup();
    const e = event({
      providerEventId: "evt-9",
      providerVersion: "0.144.3",
      parentSessionId: "parent-1",
      userId: "u1",
      sequence: 3,
      status: "failure",
      cwd: "/r/app",
      repoRoot: "/r/app",
      repoRemoteHash: "abc",
      projectName: "app",
      gitBranch: "main",
      gitHead: "aaa1111",
      model: "m-1",
      tool: { name: "exec", category: "shell", callId: "call_1" },
      command: { executable: "pnpm", display: "pnpm test", exitCode: 1 },
      file: { path: "/r/app/a.ts", operation: "modify" },
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        costConfidence: "estimated",
        estimatedCostUsd: 0.01,
        pricingVersion: "p1",
      },
      error: { code: "E", message: "failed" },
      sourceRef: { file: "/x/rollout.jsonl", offset: 77, parserVersion: "codex@1" },
    });
    insertEvents(db, session.id, [e]);
    expect(listEvents(db, { sessionId: session.id })).toEqual([e]);
  });

  it("rejects events for another session and writes nothing from that batch", () => {
    const { db, session } = setup();
    const good = event({ providerEventId: "ok" });
    const foreign = event({ sessionId: "other-session" });
    expect(() => insertEvents(db, session.id, [good, foreign])).toThrow(/belongs to/);
    expect(listEvents(db)).toHaveLength(0);
  });

  it("enforces privacy invariants at the storage boundary", () => {
    const { db, session } = setup();
    const leaky = event({ content: { prompt: "my secret plan" } });
    expect(() => insertEvents(db, session.id, [leaky])).toThrow();
    expect(listEvents(db)).toHaveLength(0);
  });

  it("rejects unknown sessions", () => {
    const { db } = memoryDb();
    expect(() => insertEvents(db, "01K6F00000000000000000NONE", [event()])).toThrow(
      /unknown session/,
    );
  });

  it("removes a session's events when the session is deleted", () => {
    const { db, session } = setup();
    insertEvents(db, session.id, [event({ providerEventId: "x" })]);
    db.delete(sessions).run();
    expect(listEvents(db)).toHaveLength(0);
  });
});

describe("listEvents", () => {
  it("filters by time range and type, in chronological order", () => {
    const { db, session } = setup();
    insertEvents(db, session.id, [
      event({ providerEventId: "c", timestamp: T2, eventType: "command.failed" }),
      event({ providerEventId: "a", timestamp: T0 }),
      event({ providerEventId: "b", timestamp: T1, eventType: "command.failed" }),
    ]);
    const ids = (l: { providerEventId?: string | undefined }[]) => l.map((e) => e.providerEventId);
    expect(ids(listEvents(db))).toEqual(["a", "b", "c"]);
    expect(ids(listEvents(db, { from: T1 }))).toEqual(["b", "c"]);
    expect(ids(listEvents(db, { from: T0, to: T2 }))).toEqual(["a", "b"]);
    expect(ids(listEvents(db, { eventTypes: ["command.failed"] }))).toEqual(["b", "c"]);
  });
});

describe("session event helpers", () => {
  it("counts events and failures, lists newest first, deletes by source file", () => {
    const { db, session } = setup();
    const src = (file: string) => ({ file, offset: 0, parserVersion: "codex@1" });
    insertEvents(db, session.id, [
      event({ providerEventId: "a", timestamp: T0, sourceRef: src("/x/a.jsonl") }),
      event({
        providerEventId: "b",
        timestamp: T1,
        status: "failure",
        sourceRef: src("/x/a.jsonl"),
      }),
      event({ providerEventId: "c", timestamp: T2, sourceRef: src("/x/b.jsonl") }),
    ]);
    expect(countSessionEvents(db, session.id)).toEqual({ events: 3, failures: 1 });
    expect(latestSessionEvents(db, session.id, 2).map((e) => e.providerEventId)).toEqual([
      "c",
      "b",
    ]);
    expect(deleteEventsBySourceFile(db, "/x/a.jsonl")).toBe(2);
    expect(countSessionEvents(db, session.id)).toEqual({ events: 1, failures: 0 });
  });
});
