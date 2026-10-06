import { InsightSchema } from "@landed/core";
import { describe, expect, it } from "vitest";
import { outcome, session } from "../../threads/src/test-helpers";
import { detectInsights, formatTokens } from "./index";

describe("detectInsights", () => {
  it("reports repeated failures, failed/interrupted sessions and tokens on non-landed work", () => {
    const failing = session({ startH: 0, status: "failed" });
    const heavy = session({ startH: 1, inputTokens: 300_000, outputTokens: 20_000 });
    const fine = session({ startH: 2, inputTokens: 900_000 });
    const found = detectInsights({
      sessions: [failing, heavy, fine],
      outcomes: [
        outcome(heavy, "a.ts", "lost"),
        outcome(heavy, "b.ts", "uncommitted"),
        outcome(fine, "c.ts", "landed"),
      ],
      failureGroups: [
        {
          sessionId: failing.id,
          signature: "pnpm test",
          count: 4,
          firstAt: failing.startedAt,
          lastAt: failing.lastEventAt,
        },
        {
          sessionId: failing.id,
          signature: "ls",
          count: 2,
          firstAt: failing.startedAt,
          lastAt: failing.lastEventAt,
        },
      ],
    });
    expect(found.map((i) => i.type).sort()).toEqual([
      "failed-session",
      "repeated-failure",
      "tokens-on-non-landed",
    ]);
    expect(found.find((i) => i.type === "repeated-failure")?.message).toBe(
      "`pnpm test` failed 4 times in one session",
    );
    expect(found.find((i) => i.type === "tokens-on-non-landed")?.message).toContain("320k tokens");
    for (const i of found) expect(InsightSchema.safeParse(withoutKey(i)).success).toBe(true);
  });

  it("keys are stable across runs", () => {
    const s = session({ startH: 0, status: "interrupted" });
    const run = () =>
      detectInsights({ sessions: [s], outcomes: [], failureGroups: [] }).map((i) => i.key);
    expect(run()).toEqual(run());
  });
});

describe("formatTokens", () => {
  it.each([
    [950, "950"],
    [12_400, "12k"],
    [3_200_000, "3.2M"],
    [9_627_738_368, "9.6B"],
  ])("%d → %s", (n, s) => expect(formatTokens(n)).toBe(s));
});

function withoutKey<T extends { key: string }>(d: T | undefined): Omit<T, "key"> | undefined {
  if (!d) return d;
  const { key: _key, ...rest } = d;
  return rest;
}
