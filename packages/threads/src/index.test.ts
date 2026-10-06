import { WorkThreadSchema } from "@landed/core";
import { describe, expect, it } from "vitest";
import { buildThreads, humanizeBranch } from "./index";
import { HOUR, iso, outcome, patch, session, T0 } from "./test-helpers";

const defaults = new Map([["01K6FREP00000000000000000A", "main"]]);
const now = T0 + 1000 * HOUR;

describe("buildThreads", () => {
  it("links sessions on the same feature branch across agents and records why", () => {
    const a = session({ startH: 0, gitBranchStart: "feat/webhook-retry", provider: "claude-code" });
    const b = session({ startH: 20, gitBranchStart: "feat/webhook-retry" });
    const threads = buildThreads({
      sessions: [a, b],
      patches: [],
      outcomes: [],
      defaultBranches: defaults,
      nowMs: now,
    });
    expect(threads).toHaveLength(1);
    const t = threads[0];
    expect(t).toMatchObject({
      id: a.id,
      sessionIds: [a.id, b.id],
      title: "webhook retry",
      titleProvenance: "observed",
      branch: "feat/webhook-retry",
    });
    expect(new Set(t?.providers)).toEqual(new Set(["claude-code", "codex"]));
    expect(t?.linkEvidence).toEqual([
      {
        kind: "same-branch",
        fromSessionId: a.id,
        toSessionId: b.id,
        detail: { branch: "feat/webhook-retry" },
      },
    ]);
    expect(WorkThreadSchema.safeParse(t).success).toBe(true);
  });

  it("links by file overlap or edited lines, but not across the 72 h gap or the default branch", () => {
    const a = session({ startH: 0, gitBranchStart: "main" });
    const b = session({ startH: 5, gitBranchStart: "main" });
    const c = session({ startH: 200, gitBranchStart: "main" });
    const d = session({ startH: 210, gitBranchStart: "main" });
    const patches = [
      patch(a, "src/a.ts", ["x1", "x2"]),
      patch(b, "src/a.ts", ["y1"]),
      patch(c, "src/a.ts", ["z1"]),
      patch(d, "src/other.ts", ["w1"], ["z1"]),
    ];
    const threads = buildThreads({
      sessions: [a, b, c, d],
      patches,
      outcomes: [],
      defaultBranches: defaults,
      nowMs: now,
    });
    const groups = threads.map((t) => t.sessionIds).sort((x, y) => x.length - y.length);
    expect(groups).toEqual(
      [
        [a.id, b.id],
        [c.id, d.id],
      ].sort((x, y) => x.length - y.length),
    );
    const kinds = threads.flatMap((t) => t.linkEvidence.map((l) => l.kind)).sort();
    expect(kinds).toEqual(["file-overlap", "line-overlap"]);
  });

  it("puts subagents in their parent's thread", () => {
    const parent = session({ startH: 0 });
    const sub = session({ startH: 0.5, parentSessionId: parent.id });
    const threads = buildThreads({
      sessions: [parent, sub],
      patches: [],
      outcomes: [],
      defaultBranches: defaults,
      nowMs: now,
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.linkEvidence[0]?.kind).toBe("continuation");
  });

  it("derives status from outcomes and recency", () => {
    const mk = (startH: number) => session({ startH });
    const [a, b, c, d, e] = [mk(0), mk(100), mk(200), mk(999.5), mk(300)];
    const outcomes = [
      outcome(a as never, "x.ts", "uncommitted"),
      outcome(b as never, "y.ts", "landed"),
      outcome(c as never, "z.ts", "lost"),
    ];
    const threads = buildThreads({
      sessions: [a, b, c, d, e] as never,
      patches: [],
      outcomes,
      defaultBranches: defaults,
      nowMs: now,
    });
    const statusOf = (s: { id: string }) =>
      threads.find((t) => t.sessionIds.includes(s.id))?.status;
    expect(statusOf(a as never)).toBe("dangling");
    expect(statusOf(b as never)).toBe("landed");
    expect(statusOf(c as never)).toBe("abandoned");
    expect(statusOf(d as never)).toBe("active");
    expect(statusOf(e as never)).toBe("unknown"); // old, but it never edited anything
  });

  it("titles from commit subjects, then directories", () => {
    const a = session({ startH: 0, gitBranchStart: "main" });
    const b = session({ startH: 100, gitBranchStart: "main" });
    const threads = buildThreads({
      sessions: [a, b],
      patches: [patch(b, "apps/web/src/page.tsx", ["q"])],
      outcomes: [outcome(a, "x.ts", "landed")],
      defaultBranches: defaults,
      nowMs: now,
    });
    expect(threads.map((t) => [t.title, t.titleProvenance])).toEqual([
      ["feat: retries", "observed"],
      ["Work in apps/web", "derived"],
    ]);
  });
});

describe("buildThreads — long-lived work", () => {
  it("does not chain sessions through a trunk-like branch or beyond 7 days", () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session({ startH: i * 48, gitBranchStart: "mobil" }),
    );
    const threads = buildThreads({
      sessions,
      patches: [],
      outcomes: [],
      defaultBranches: defaults,
      nowMs: now,
    });
    expect(threads).toHaveLength(12); // "mobil" spans 22 days → trunk-like → no branch links
    const chained = Array.from({ length: 6 }, (_, i) =>
      session({ startH: i * 48, gitBranchStart: "main" }),
    );
    const patches = chained.map((s) => patch(s, "src/shared.ts", [`l${s.id}`]));
    const t2 = buildThreads({
      sessions: chained,
      patches,
      outcomes: [],
      defaultBranches: defaults,
      nowMs: now,
    });
    expect(Math.max(...t2.map((t) => t.sessionIds.length))).toBeLessThanOrEqual(4); // ≤ 7 days per thread
  });

  it("treats origin/main and main alike as the default branch", () => {
    const a = session({ startH: 0, gitBranchStart: "main" });
    const b = session({ startH: 5, gitBranchStart: "main" });
    const threads = buildThreads({
      sessions: [a, b],
      patches: [],
      outcomes: [],
      defaultBranches: new Map([["01K6FREP00000000000000000A", "origin/main"]]),
      nowMs: now,
    });
    expect(threads).toHaveLength(2);
  });
});

describe("humanizeBranch", () => {
  it.each([
    ["feat/webhook-retry", "webhook retry"],
    ["codex/fix_login", "fix login"],
    ["release-2026", "release 2026"],
  ])("%s → %s", (b, t) => expect(humanizeBranch(b)).toBe(t));
});

void iso;
