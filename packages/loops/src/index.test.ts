import { CollisionSchema, OpenLoopSchema, type WorkThread } from "@landed/core";
import { describe, expect, it } from "vitest";
import { HOUR, outcome, patch, session, T0 } from "../../threads/src/test-helpers";
import { detectCollisions, detectOpenLoops, normalizeIgnorePaths } from "./index";

const now = T0 + 1000 * HOUR;
const thread = (ids: string[], lastH: number, extra: Partial<WorkThread> = {}): WorkThread => ({
  id: ids[0] as string,
  repoId: "01K6FREP00000000000000000A",
  sessionIds: ids,
  providers: ["codex"],
  startedAt: new Date(T0).toISOString(),
  lastActivityAt: new Date(T0 + lastH * HOUR).toISOString(),
  title: "t",
  titleProvenance: "derived",
  status: "unknown",
  linkEvidence:
    ids.length > 1
      ? [{ kind: "same-branch", fromSessionId: ids[0] as string, toSessionId: ids[1] as string }]
      : [],
  ...extra,
});

describe("detectOpenLoops", () => {
  it("finds uncommitted output older than a day, grouped by thread", () => {
    const a = session({ startH: 0 });
    const b = session({ startH: 2 });
    const loops = detectOpenLoops({
      sessions: [a, b],
      threads: [thread([a.id, b.id], 3)],
      patches: [patch(a, "x.ts", ["1"]), patch(b, "y.ts", ["2"])],
      outcomes: [outcome(a, "x.ts", "uncommitted"), outcome(b, "y.ts", "uncommitted")],
      nowMs: now,
    });
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({
      type: "uncommitted-output",
      key: `uncommitted-output:${a.id}`,
      size: { files: 2, lines: 60 },
      provenance: "derived",
    });
    expect(OpenLoopSchema.safeParse(withoutKey(loops[0])).success).toBe(true);
  });

  it("ignores fresh uncommitted work", () => {
    const a = session({ startH: 990 });
    const loops = detectOpenLoops({
      sessions: [a],
      threads: [],
      patches: [patch(a, "x.ts", ["1"])],
      outcomes: [outcome(a, "x.ts", "uncommitted")],
      nowMs: now,
    });
    expect(loops).toEqual([]);
  });

  it("finds unmerged agent branches, lost work, awaiting-user and failed sessions", () => {
    const side = session({ startH: 0, gitBranchStart: "feat/x" });
    const lost = session({ startH: 10 });
    const waiting = session({ startH: 20, status: "awaiting-user" });
    const failed = session({ startH: 30, status: "failed" });
    const loops = detectOpenLoops({
      sessions: [side, lost, waiting, failed],
      threads: [thread([side.id], 1, { branch: "feat/x" })],
      patches: [],
      outcomes: [
        outcome(side, "a.ts", "landed", { fracOnDefaultBranch: 0 }),
        outcome(lost, "b.ts", "lost"),
      ],
      nowMs: now,
    });
    const byType = Object.fromEntries(loops.map((l) => [l.type, l]));
    expect(Object.keys(byType).sort()).toEqual([
      "awaiting-user",
      "failed-unresolved",
      "lost-work",
      "unmerged-agent-branch",
    ]);
    expect(byType["unmerged-agent-branch"]).toMatchObject({
      size: { commits: 1 },
      evidence: { branch: "feat/x" },
    });
    expect(byType["awaiting-user"]?.provenance).toBe("inferred");
    for (const l of loops) expect(OpenLoopSchema.safeParse(withoutKey(l)).success).toBe(true);
  });

  it("groups unmerged work by the branch git found, even when sessions recorded none", () => {
    // Subagents started outside the repo: no session branch, separate threads.
    const subs = [0, 2, 4].map((h) => session({ startH: h }));
    const onBranch = (s: (typeof subs)[number], sha: string) =>
      outcome(s, `${sha}.ts`, "landed", {
        fracOnDefaultBranch: 0,
        firstCommit: { sha, time: s.lastEventAt, branch: "agent/control-plane" },
      });
    const loops = detectOpenLoops({
      sessions: subs,
      threads: subs.map((s) => thread([s.id], 1)),
      patches: [],
      outcomes: subs.map((s, i) => onBranch(s, `abc000${i}`)),
      nowMs: now,
    });
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({
      type: "unmerged-agent-branch",
      size: { files: 3, commits: 3 },
      evidence: { branch: "agent/control-plane" },
    });
    expect(loops[0]?.sessionIds).toHaveLength(3);
  });

  it("skips uncommitted output and unmerged branches under 10 lines", () => {
    const a = session({ startH: 0 });
    const b = session({ startH: 10, gitBranchStart: "fix/typo" });
    const loops = detectOpenLoops({
      sessions: [a, b],
      threads: [thread([a.id], 1), thread([b.id], 11, { branch: "fix/typo" })],
      patches: [],
      outcomes: [
        outcome(a, "x.ts", "uncommitted", { lineCount: 9 }),
        outcome(b, "y.ts", "landed", { fracOnDefaultBranch: 0, lineCount: 2 }),
      ],
      nowMs: now,
    });
    expect(loops).toEqual([]);
  });

  it("ignores agent reports and plans under excluded folders", () => {
    const a = session({ startH: 0 });
    const input = {
      sessions: [a],
      threads: [thread([a.id], 1)],
      patches: [
        patch(a, "output/pdf/weekly-report.md", ["1"]),
        patch(a, "src/output/format.ts", ["2"]),
      ],
      outcomes: [
        outcome(a, "output/pdf/weekly-report.md", "uncommitted"),
        outcome(a, ".planning/phase-2-plan.md", "lost"),
      ],
      nowMs: now,
    };
    expect(detectOpenLoops(input)).toEqual([]); // default exclusions
    expect(
      detectOpenLoops({ ...input, ignorePaths: [] })
        .map((l) => l.type)
        .sort(),
    ).toEqual(["lost-work", "uncommitted-output"]);
    // Only at the repo root: a nested src/output/ folder is real code.
    const nested = outcome(a, "src/output/format.ts", "uncommitted");
    expect(detectOpenLoops({ ...input, outcomes: [nested] })).toHaveLength(1);
  });

  it("normalizes exclusions to safe, relative folder prefixes", () => {
    expect(
      normalizeIgnorePaths([" output ", "./.planning/", "a//", "../x", "/abs", "", "output"]),
    ).toEqual(["output/", ".planning/", "a/"]);
  });

  it("does not flag a failed session that a later session in its thread fixed", () => {
    const failed = session({ startH: 0, status: "failed" });
    const fix = session({ startH: 5 });
    const loops = detectOpenLoops({
      sessions: [failed, fix],
      threads: [thread([failed.id, fix.id], 6)],
      patches: [],
      outcomes: [outcome(fix, "a.ts", "landed")],
      nowMs: now,
    });
    expect(loops.map((l) => l.type)).toEqual([]);
  });
});

describe("detectCollisions", () => {
  it("detects concurrent edits by unrelated sessions within an hour", () => {
    const a = session({ startH: 0, provider: "claude-code" });
    const b = session({ startH: 0 });
    const found = detectCollisions({
      sessions: [a, b],
      patches: [patch(a, "src/auth.ts", ["1"], [], 0), patch(b, "src/auth.ts", ["2"], [], 0.5)],
      outcomes: [],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "concurrent-edit",
      sessionA: a.id,
      sessionB: b.id,
      evidence: { minutesApart: 30 },
    });
    expect(CollisionSchema.safeParse(withoutKey(found[0])).success).toBe(true);
  });

  it("treats a handoff (one session ends, the next starts) as no collision", () => {
    const a = session({ startH: 0, endH: 0.4, provider: "claude-code" });
    const b = session({ startH: 0.5, endH: 1 });
    const found = detectCollisions({
      sessions: [a, b],
      patches: [patch(a, "src/auth.ts", ["1"], [], 0.3), patch(b, "src/auth.ts", ["2"], [], 0.6)],
      outcomes: [],
    });
    expect(found).toEqual([]);
  });

  it("upgrades to overwrite when unlanded lines were removed by the other session", () => {
    const a = session({ startH: 0 });
    const b = session({ startH: 0 });
    const found = detectCollisions({
      sessions: [a, b],
      patches: [
        patch(a, "src/auth.ts", ["l1", "l2"], [], 0),
        patch(b, "src/auth.ts", ["l3"], ["l1"], 0.2),
      ],
      outcomes: [outcome(a, "src/auth.ts", "lost")],
    });
    expect(found.map((c) => [c.kind, c.evidence])).toEqual([
      ["overwrite", { overwrittenLines: 1 }],
    ]);
  });

  it("ignores parent/subagent pairs, the same session, and edits far apart", () => {
    const parent = session({ startH: 0 });
    const sub = session({ startH: 0, parentSessionId: parent.id });
    const later = session({ startH: 50 });
    const found = detectCollisions({
      sessions: [parent, sub, later],
      patches: [
        patch(parent, "a.ts", ["1"], [], 0),
        patch(sub, "a.ts", ["2"], [], 0.1),
        patch(later, "a.ts", ["3"], [], 50),
      ],
      outcomes: [],
    });
    expect(found).toEqual([]);
  });
});

function withoutKey<T extends { key: string }>(d: T | undefined): Omit<T, "key"> | undefined {
  if (!d) return d;
  const { key: _key, ...rest } = d;
  return rest;
}
