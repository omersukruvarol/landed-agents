import type { AgentPatch } from "@landed/core";
import { newUlid } from "@landed/shared";
import { describe, expect, it } from "vitest";
import { patchLineFps } from "../schema";
import { memoryDb, NOW, sessionInput, T0 } from "../test-helpers";
import {
  countSessionChangedFiles,
  deletePatchesBySourceFile,
  insertPatches,
  listPatches,
} from "./patches";
import { upsertRepo } from "./repos";
import { upsertSession } from "./sessions";

const fp = (n: number) => n.toString(16).padStart(16, "0");

function setup() {
  const handle = memoryDb();
  const session = upsertSession(handle.db, sessionInput(), NOW);
  const repo = upsertRepo(handle.db, { rootPath: "/r/app" }, NOW);
  const patch = (overrides: Partial<AgentPatch> = {}): AgentPatch => ({
    id: newUlid(),
    sessionId: session.id,
    provider: "codex",
    toolCallId: "item_1",
    timestamp: T0,
    repoId: repo.id,
    path: "/r/app/src/a.ts",
    relPath: "src/a.ts",
    operation: "modify",
    addedLineFps: [fp(3), fp(1), fp(2)],
    removedLineFps: [fp(9)],
    addedLineCountRaw: 5,
    removedLineCountRaw: 1,
    sourceRef: { file: "/x/rollout.jsonl", offset: 10, parserVersion: "codex@1" },
    ...overrides,
  });
  return { ...handle, session, repo, patch };
}

describe("insertPatches", () => {
  it("round-trips a patch, preserving fingerprint order", () => {
    const { db, patch } = setup();
    const p = patch();
    insertPatches(db, [p]);
    expect(listPatches(db)).toEqual([p]);
  });

  it("is idempotent even when re-imported from a moved source file", () => {
    const { db, patch } = setup();
    const p = patch();
    expect(insertPatches(db, [p])).toEqual({ inserted: 1, duplicates: 0 });
    const moved = {
      ...p,
      id: newUlid(),
      sourceRef: { ...p.sourceRef, file: "/moved/rollout.jsonl" },
    };
    expect(insertPatches(db, [moved])).toEqual({ inserted: 0, duplicates: 1 });
    expect(listPatches(db)).toHaveLength(1);
  });

  it("keeps one tool call's edits to different files as separate patches", () => {
    const { db, patch } = setup();
    insertPatches(db, [patch(), patch({ path: "/r/app/src/b.ts", relPath: "src/b.ts" })]);
    expect(listPatches(db)).toHaveLength(2);
    expect(listPatches(db, { relPath: "src/b.ts" })).toHaveLength(1);
  });

  it("stores large fingerprint sets across insert chunks", () => {
    const { db, patch } = setup();
    const many = Array.from({ length: 1234 }, (_, i) => fp(i + 1));
    const p = patch({ addedLineFps: many, addedLineCountRaw: many.length });
    insertPatches(db, [p]);
    expect(listPatches(db)[0]?.addedLineFps).toEqual(many);
  });

  it("validates patches and requires an existing session", () => {
    const { db, patch } = setup();
    expect(() => insertPatches(db, [patch({ path: "relative/a.ts" })])).toThrow();
    expect(() => insertPatches(db, [patch({ sessionId: newUlid() })])).toThrow(/FOREIGN KEY/);
    expect(listPatches(db)).toHaveLength(0);
  });
});

describe("patch helpers", () => {
  it("counts distinct changed files and deletes by source file", () => {
    const { db, patch, session } = setup();
    insertPatches(db, [
      patch(),
      patch({ toolCallId: "item_2", timestamp: "2026-10-01T09:05:00.000Z" }),
      patch({
        path: "/r/app/src/b.ts",
        relPath: "src/b.ts",
        sourceRef: { file: "/x/other.jsonl", offset: 0, parserVersion: "codex@1" },
      }),
    ]);
    expect(countSessionChangedFiles(db, session.id)).toBe(2);
    expect(deletePatchesBySourceFile(db, "/x/rollout.jsonl")).toBe(2);
    expect(listPatches(db)).toHaveLength(1);
    // fingerprint rows of the deleted patches went with them (3 added + 1 removed remain)
    expect(db.select().from(patchLineFps).all()).toHaveLength(4);
  });
});
