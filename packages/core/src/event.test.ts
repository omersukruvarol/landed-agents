import { describe, expect, it } from "vitest";
import { NormalizedEventSchema } from "./event";
import { minimalEvent } from "./test-helpers";

describe("NormalizedEventSchema", () => {
  it("accepts a minimal event with only required fields", () => {
    expect(NormalizedEventSchema.safeParse(minimalEvent()).success).toBe(true);
  });

  it("accepts a fully populated event", () => {
    const e = minimalEvent({
      providerEventId: "evt-1",
      providerVersion: "0.144.3",
      parentSessionId: "parent-1",
      sequence: 42,
      status: "failure",
      cwd: "/Users/dev/repo",
      repoRoot: "/Users/dev/repo",
      gitBranch: "feat/x",
      gitHead: "abc1234",
      model: "gpt-x",
      tool: { name: "exec", category: "shell", callId: "call_1" },
      command: { executable: "pnpm", display: "pnpm test", exitCode: 1 },
      file: { path: "/Users/dev/repo/a.ts", operation: "modify" },
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, reasoningTokens: 1 },
      error: { code: "E1", message: "boom" },
      sourceRef: { file: "/x/rollout.jsonl", offset: 1024, parserVersion: "codex@1" },
    });
    expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
  });

  it("keeps unknown vendor events as eventType 'unknown' instead of rejecting them", () => {
    const e = minimalEvent({ providerEventType: "some_future_line_type", eventType: "unknown" });
    expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
  });

  it("rejects an unknown provider value", () => {
    const e = { ...minimalEvent(), provider: "cursor" };
    expect(NormalizedEventSchema.safeParse(e).success).toBe(false);
  });

  it.each([
    ["no offset", "2026-10-01T09:00:00"],
    ["date only", "2026-10-01"],
    ["space separator", "2026-10-01 09:00:00Z"],
    ["month 13", "2026-13-01T09:00:00Z"],
    ["Feb 30", "2026-02-30T09:00:00Z"],
    ["garbage", "yesterday"],
  ])("rejects invalid timestamp: %s", (_label, ts) => {
    expect(NormalizedEventSchema.safeParse(minimalEvent({ timestamp: ts })).success).toBe(false);
  });

  it.each([
    ["UTC Z", "2026-10-01T09:00:00Z"],
    ["millis", "2026-10-01T09:00:00.123Z"],
    ["positive offset", "2026-10-01T12:00:00+03:00"],
    ["leap day", "2028-02-29T00:00:00Z"],
  ])("accepts valid timestamp: %s", (_label, ts) => {
    expect(NormalizedEventSchema.safeParse(minimalEvent({ timestamp: ts })).success).toBe(true);
  });

  it("rejects unknown keys so raw vendor fields cannot leak into storage", () => {
    const e = { ...minimalEvent(), tool_input: { command: "cat .env" } };
    expect(NormalizedEventSchema.safeParse(e).success).toBe(false);
    const nested = minimalEvent({ tool: { name: "Bash" } });
    (nested.tool as Record<string, unknown>).input = { command: "x" };
    expect(NormalizedEventSchema.safeParse(nested).success).toBe(false);
  });

  it("rejects a non-ULID id and negative counts", () => {
    expect(NormalizedEventSchema.safeParse(minimalEvent({ id: "1" })).success).toBe(false);
    expect(NormalizedEventSchema.safeParse(minimalEvent({ sequence: -1 })).success).toBe(false);
    expect(
      NormalizedEventSchema.safeParse(minimalEvent({ usage: { inputTokens: -5 } })).success,
    ).toBe(false);
  });

  describe("privacy invariants", () => {
    it("rejects prompt content when prompt capture is off", () => {
      const r = NormalizedEventSchema.safeParse(
        minimalEvent({ content: { prompt: "secret plan" } }),
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(["content", "prompt"]);
    });

    it("rejects tool arguments/results when their capture is off", () => {
      expect(
        NormalizedEventSchema.safeParse(minimalEvent({ content: { toolArguments: { a: 1 } } }))
          .success,
      ).toBe(false);
      expect(
        NormalizedEventSchema.safeParse(minimalEvent({ content: { toolResult: "out" } })).success,
      ).toBe(false);
    });

    it("accepts content only when the matching flag is on", () => {
      const e = minimalEvent({ content: { prompt: "hi" } });
      e.privacy.promptCaptured = true;
      expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
    });
  });
});
