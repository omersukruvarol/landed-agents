import type { Outcome } from "@landed/core";
import { newUlid } from "@landed/shared";
import { describe, expect, it } from "vitest";
import { memoryDb, NOW, sessionInput, T0, T1 } from "../test-helpers";
import { listOutcomes, outcomeDistribution, outcomeSubjectKey, upsertOutcomes } from "./outcomes";
import { upsertRepo } from "./repos";
import { upsertSession } from "./sessions";

function setup() {
  const { db } = memoryDb();
  const repo = upsertRepo(db, { rootPath: "/r/app" }, NOW);
  const codex = upsertSession(db, sessionInput(), NOW);
  const claude = upsertSession(
    db,
    sessionInput({ provider: "claude-code", providerSessionId: "c1" }),
    NOW,
  );
  const outcome = (o: Partial<Outcome>): Outcome => ({
    id: newUlid(),
    scope: "session-file",
    sessionId: codex.id,
    repoId: repo.id,
    relPath: "src/a.ts",
    class: "landed",
    survival: "surviving",
    fracCommitted: 1,
    fracOnDefaultBranch: 1,
    fracInWorkingTree: 1,
    firstCommit: { sha: "abc1234", time: T1, subject: "feat: x" },
    commitLagSeconds: 3600,
    lineCount: 4,
    provenance: "derived",
    computedAt: T1,
    engineVersion: "outcomes@1",
    ...o,
  });
  return { db, repo, codex, claude, outcome };
}

describe("outcomes repository", () => {
  it("round-trips outcomes, including unknown ones with a reason", () => {
    const { db, outcome } = setup();
    const landed = outcome({});
    const unknown = outcome({
      relPath: "src/b.ts",
      class: "unknown",
      unknownReason: "git-error",
      survival: "unknown",
      fracCommitted: 0,
      fracOnDefaultBranch: 0,
      fracInWorkingTree: 0,
      lineCount: 0,
    });
    delete (unknown as Partial<Outcome>).firstCommit;
    delete (unknown as Partial<Outcome>).commitLagSeconds;
    upsertOutcomes(db, [landed, unknown]);
    expect(
      listOutcomes(db).sort((a, b) => (a.relPath ?? "").localeCompare(b.relPath ?? "")),
    ).toEqual([landed, unknown]);
  });

  it("updates in place on recomputation, keeping the first id", () => {
    const { db, outcome } = setup();
    const first = outcome({
      class: "uncommitted",
      survival: "unknown",
      fracCommitted: 0,
      fracOnDefaultBranch: 0,
    });
    delete (first as Partial<Outcome>).firstCommit;
    delete (first as Partial<Outcome>).commitLagSeconds;
    upsertOutcomes(db, [first]);
    upsertOutcomes(db, [outcome({ computedAt: "2026-10-02T00:00:00.000Z" })]);
    const all = listOutcomes(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first.id, class: "landed" });
  });

  it("derives subject keys per scope", () => {
    expect(outcomeSubjectKey({ scope: "patch", patchId: "p1", sessionId: "s" })).toBe("p1");
    expect(
      outcomeSubjectKey({ scope: "session-file", sessionId: "s", repoId: "r", relPath: "a.ts" }),
    ).toBe("s:r:a.ts");
    expect(() => outcomeSubjectKey({ scope: "patch", sessionId: "s" })).toThrow();
  });

  it("computes distributions by provider and session start time", () => {
    const { db, outcome, claude } = setup();
    upsertOutcomes(
      db,
      [
        outcome({ relPath: "a.ts" }),
        outcome({ relPath: "b.ts" }),
        outcome({
          relPath: "c.ts",
          sessionId: claude.id,
          class: "lost",
          survival: "unknown",
          fracCommitted: 0,
          fracOnDefaultBranch: 0,
          fracInWorkingTree: 0,
        }),
      ].map((o) =>
        o.class === "lost" ? (({ firstCommit: _f, commitLagSeconds: _c, ...rest }) => rest)(o) : o,
      ),
    );
    expect(outcomeDistribution(db, { scope: "session-file" })).toEqual({ landed: 2, lost: 1 });
    expect(outcomeDistribution(db, { scope: "session-file", provider: "claude-code" })).toEqual({
      lost: 1,
    });
    expect(outcomeDistribution(db, { scope: "session-file", from: T1 })).toEqual({});
    expect(outcomeDistribution(db, { scope: "session-file", from: T0 })).toEqual({
      landed: 2,
      lost: 1,
    });
  });
});
