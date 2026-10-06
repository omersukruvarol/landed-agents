import { NormalizedEventSchema } from "@landed/core";
import { describe, expect, it } from "vitest";
import { CLAUDE_PARSER_VERSION, categorizeTool } from "./parser";
import { FINGERPRINTER, fixture, parseText } from "./test-helpers";

const MAIN = "11111111-1111-4111-8111-111111111111";

describe("Claude parser — main session fixture", () => {
  const out = parseText(fixture("session-main.jsonl"));
  const types = out.events.map((e) => e.eventType);

  it("emits the expected event sequence", () => {
    expect(types).toEqual([
      "prompt.submitted",
      "command.started",
      "command.failed",
      "tool.started", // Edit
      "tool.completed",
      "edit.applied",
      "tool.started", // Write
      "tool.completed",
      "edit.applied",
      "tool.started", // Edit that fails
      "tool.failed",
      "tool.started", // Read
      "tool.completed",
      "subagent.started",
      "subagent.ended",
      "command.started", // rm -rf build, denied
      "approval.resolved",
      "agent.interrupted",
      "prompt.submitted",
      "turn.completed",
      "turn.completed", // synthetic "No response requested." line
      "unknown", // future line type
    ]);
  });

  it("produces schema-valid events tied to their source lines", () => {
    for (const e of out.events) {
      expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
      expect(e.sessionId).toBe(MAIN);
      expect(e.provider).toBe("claude-code");
      expect(e.sourceRef?.parserVersion).toBe(CLAUDE_PARSER_VERSION);
    }
  });

  it("never emits prompt, assistant, thinking, tool output or file content", () => {
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/CANARY_/);
    expect(serialized).not.toContain("ghp_");
  });

  it("keeps a redacted, first-line-only command display", () => {
    const started = out.events.find((e) => e.eventType === "command.started");
    expect(started?.command).toEqual({
      executable: "pnpm",
      display: "GITHUB_TOKEN=[REDACTED] pnpm test",
    });
    expect(started?.privacy.redactionsApplied).toBe(1);
    const failed = out.events.find((e) => e.eventType === "command.failed");
    expect(failed).toMatchObject({
      status: "failure",
      tool: { name: "Bash", callId: "toolu_bash1" },
    });
  });

  it("extracts patches as fingerprints, with moved lines excluded", () => {
    expect(
      out.patches.map((p) => [p.path, p.operation, p.addedLineCountRaw, p.removedLineCountRaw]),
    ).toEqual([
      ["/Users/dev/app/src/retry.ts", "modify", 2, 1],
      ["/Users/dev/app/src/backoff.ts", "create", 4, 0],
    ]);
    const edit = out.patches[0];
    expect(edit?.addedLineFps).toEqual(
      FINGERPRINTER.fingerprintDiff(
        ["const retries = computeRetries(config);", "export const CANARY_CODE_91bd = retries * 2;"],
        ["const retries = 1;"],
      ).added,
    );
    expect(edit?.toolCallId).toBe("toolu_edit1");
    // "}" is not significant, so the 4-line create yields 3 fingerprints.
    expect(out.patches[1]?.addedLineFps).toHaveLength(3);
  });

  it("does not create a patch for a failed edit", () => {
    expect(out.patches.some((p) => p.path.endsWith("missing.ts"))).toBe(false);
  });

  it("dedupes usage by message id, keeping the largest value per field", () => {
    const msg1 = out.usage.find((u) => u.usageKey === "msg_1");
    // input = input_tokens + cache_creation; output grew from 3 to 48 across split lines.
    expect(msg1).toMatchObject({ inputTokens: 110, outputTokens: 48, cachedInputTokens: 2000 });
    expect(out.usage.filter((u) => u.usageKey === "msg_1")).toHaveLength(1);
    expect(out.usage.find((u) => u.usageKey === "msg_8")?.outputTokens).toBe(90);
    expect(out.usage.some((u) => u.usageKey === "msg_syn")).toBe(false); // synthetic model
  });

  it("collapses a split message's turn completion onto the message id", () => {
    const turn = out.events.find((e) => e.eventType === "turn.completed");
    expect(turn?.providerEventId).toBe("msg_8");
  });

  it("collects session facts: time span, cwd, branches, model, user title, cost", () => {
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toEqual({
      provider: "claude-code",
      providerSessionId: MAIN,
      sourceFile: "/x/session.jsonl",
      firstEventAt: "2026-09-30T08:00:00.000Z",
      lastEventAt: "2026-09-30T08:03:20.000Z",
      cwd: "/Users/dev/app",
      gitBranchFirst: "feat/retry",
      gitBranchLast: "feat/retry",
      model: "claude-opus-5-5",
      providerVersion: "2.1.281",
      title: "Webhook retry fix",
      titleProvenance: "observed",
      estimatedCostUsd: 1.25,
    });
  });

  it("records a content-free failure for the broken line and counts unknown types", () => {
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({
      reasonCode: "invalid-json",
      sourceFile: "/x/session.jsonl",
    });
    expect(out.failures[0]?.message).toBeUndefined();
    expect(out.stats.unknownTypes).toEqual({ "hologram-sync": 1 });
    expect(out.stats.ignored).toBeGreaterThanOrEqual(4);
  });

  it("uses real byte offsets", () => {
    const text = fixture("session-main.jsonl");
    const first = out.events[0];
    expect(first?.sourceRef?.offset).toBe(text.indexOf('{"parentUuid"'));
  });
});

describe("Claude parser — other fixtures", () => {
  it("parses a subagent file as its own session linked to the parent", () => {
    const out = parseText(fixture("subagent.jsonl"));
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toMatchObject({
      providerSessionId: `${MAIN}:a1b2c3`,
      parentProviderSessionId: MAIN,
      model: "claude-sonnet-5-5",
    });
    expect(out.events.every((e) => e.parentSessionId === MAIN)).toBe(true);
    expect(out.patches).toHaveLength(1);
    expect(out.patches[0]?.providerSessionId).toBe(`${MAIN}:a1b2c3`);
    expect(JSON.stringify(out)).not.toMatch(/CANARY_/);
  });

  it("marks a pending AskUserQuestion as awaiting the user", () => {
    const out = parseText(fixture("session-awaiting.jsonl"));
    expect(out.events.map((e) => e.eventType)).toEqual([
      "prompt.submitted",
      "tool.started",
      "session.awaiting-user",
    ]);
  });

  it("turns an API error into an error event", () => {
    const out = parseText(fixture("session-api-error.jsonl"));
    expect(out.events.at(-1)).toMatchObject({
      eventType: "error",
      status: "failure",
      error: { code: "api-error" },
    });
  });

  it("infers the tool family when the tool_use was imported in an earlier pass", () => {
    const text = fixture("session-main.jsonl");
    const lines = text.split("\n");
    const resultLine = lines.findIndex((l) => l.includes('"uuid": "u3"'));
    const tail = `${lines.slice(resultLine, resultLine + 1).join("\n")}\n`;
    const out = parseText(tail, "/x/session.jsonl", 5000);
    expect(out.events.map((e) => e.eventType)).toEqual(["tool.completed", "edit.applied"]);
    expect(out.events[0]?.tool?.name).toBe("unknown");
    expect(out.patches).toHaveLength(1);
    expect(out.patches[0]?.sourceRef.offset).toBe(5000);
  });

  it("emits nothing for blank input and survives non-object JSON", () => {
    const out = parseText('\n[1,2]\n"str"\n');
    expect(out.events).toHaveLength(0);
    expect(out.failures.map((f) => f.reasonCode)).toEqual(["not-an-object", "not-an-object"]);
  });

  it("reports missing fields on conversational lines without crashing", () => {
    const out = parseText(
      '{"type":"user","message":{"content":"CANARY_X"}}\n{"type":"assistant","sessionId":"s","timestamp":"not-a-date"}\n',
    );
    expect(out.failures.map((f) => f.reasonCode)).toEqual(["missing-field", "invalid-timestamp"]);
    expect(JSON.stringify(out)).not.toMatch(/CANARY_/);
  });
});

describe("categorizeTool", () => {
  it.each([
    ["Bash", "shell"],
    ["Edit", "file"],
    ["Grep", "search"],
    ["WebFetch", "network"],
    ["mcp__github__create_pr", "mcp"],
    ["TodoWrite", "other"],
  ])("%s -> %s", (name, category) => {
    expect(categorizeTool(name)).toBe(category);
  });
});
