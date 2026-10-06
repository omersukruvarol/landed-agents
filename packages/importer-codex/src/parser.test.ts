import { NormalizedEventSchema } from "@landed/core";
import { describe, expect, it } from "vitest";
import { CODEX_PARSER_VERSION, commandText } from "./parser";
import {
  FINGERPRINTER,
  FORK,
  FORK_FILE,
  fixture,
  MAIN,
  MAIN_FILE,
  parseText,
} from "./test-helpers";

const mainPath = `/h/.codex/sessions/2026/09/29/${MAIN_FILE}`;
const forkPath = `/h/.codex/sessions/2026/09/29/${FORK_FILE}`;

describe("Codex parser — main rollout", () => {
  const out = parseText(fixture(MAIN_FILE), mainPath);

  it("emits the expected event sequence", () => {
    expect(out.events.map((e) => e.eventType)).toEqual([
      "session.started",
      "prompt.submitted",
      "command.failed",
      "edit.applied", // retry.ts
      "edit.applied", // added.ts
      "edit.applied", // old.ts (delete)
      "command.completed",
      "approval.resolved", // declined patch
      "tool.failed", // MCP
      "subagent.started",
      "turn.completed",
      "unknown", // future event_msg
      "unknown", // future item type
    ]);
  });

  it("produces schema-valid events with source refs", () => {
    for (const e of out.events) {
      expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
      expect(e).toMatchObject({ provider: "codex", sessionId: MAIN });
      expect(e.sourceRef?.parserVersion).toBe(CODEX_PARSER_VERSION);
    }
  });

  it("never emits prompts, model output, command output, file contents or the remote URL", () => {
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/CANARY_/);
    expect(serialized).not.toContain("sk-");
  });

  it("keeps exit codes and a redacted first-line command", () => {
    const failed = out.events.find((e) => e.eventType === "command.failed");
    expect(failed).toMatchObject({
      status: "failure",
      tool: { name: "exec", category: "shell", callId: "call_cmd1" },
      command: { executable: "pnpm", display: "OPENAI_API_KEY=[REDACTED] pnpm test", exitCode: 1 },
      privacy: { redactionsApplied: 1 },
    });
    const ok = out.events.find((e) => e.eventType === "command.completed");
    expect(ok?.command).toEqual({ executable: "pnpm", display: "pnpm test", exitCode: 0 });
  });

  it("extracts patches from FileChange items; a delete records the edit but no lines", () => {
    expect(
      out.patches.map((p) => [
        p.path,
        p.operation,
        p.addedLineCountRaw,
        p.removedLineCountRaw,
        p.toolCallId,
      ]),
    ).toEqual([
      ["/Users/dev/app/src/retry.ts", "modify", 3, 1, "call_patch1"],
      ["/Users/dev/app/src/added.ts", "create", 3, 0, "call_patch1"],
    ]);
    // A content line starting with "+" ("++counter;") is an added line, not a diff header.
    expect(out.patches[0]?.addedLineFps).toEqual(
      FINGERPRINTER.fingerprintDiff(
        [
          "const retries = computeRetries(config);",
          "export const CANARY_CODE_codex = retries * 3;",
          "+counter;",
        ],
        ["const retries = 1;"],
      ).added,
    );
    const deleted = out.events.find((e) => e.file?.operation === "delete");
    expect(deleted?.file?.path).toBe("/Users/dev/app/src/old.ts");
  });

  it("derives usage from cumulative totals, ignoring repeated emissions", () => {
    expect(
      out.usage.map(
        ({ usageKey, inputTokens, cachedInputTokens, outputTokens, reasoningTokens }) => ({
          usageKey,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningTokens,
        }),
      ),
    ).toEqual([
      {
        usageKey: `${MAIN}:cum:1000`,
        inputTokens: 300,
        cachedInputTokens: 500,
        outputTokens: 200,
        reasoningTokens: 50,
      },
      {
        usageKey: `${MAIN}:cum:1600`,
        inputTokens: 0,
        cachedInputTokens: 400,
        outputTokens: 200,
        reasoningTokens: 30,
      },
    ]);
    // Reconciles with the vendor's final cumulative: input 1200 = 300 uncached + 900 cached; output 400.
    const sum = (k: "inputTokens" | "cachedInputTokens" | "outputTokens") =>
      out.usage.reduce((n, u) => n + (u[k] ?? 0), 0);
    expect(sum("inputTokens") + sum("cachedInputTokens")).toBe(1200);
    expect(sum("outputTokens")).toBe(400);
  });

  it("collects session facts from session_meta and turn_context", () => {
    expect(out.sessions).toEqual([
      {
        provider: "codex",
        providerSessionId: MAIN,
        sourceFile: mainPath,
        firstEventAt: "2026-09-29T10:00:00.000Z",
        lastEventAt: "2026-09-29T10:00:23.100Z",
        cwd: "/Users/dev/app",
        providerVersion: "0.154.0-alpha.6",
        gitBranchFirst: "feat/codex",
        gitBranchLast: "feat/codex",
        model: "gpt-5.5-codex",
      },
    ]);
    expect(out.events[0]).toMatchObject({ gitHead: "abc1234def", gitBranch: "feat/codex" });
  });

  it("skips heavy line types without counting them as unknown, and reports the broken line", () => {
    expect(out.stats.unknownTypes).toEqual({ "event_msg:hologram_sync": 1, "item:QuantumTool": 1 });
    expect(out.failures).toEqual([expect.objectContaining({ reasonCode: "invalid-json" })]);
  });
});

describe("Codex parser — forked subagent", () => {
  const out = parseText(fixture(FORK_FILE), forkPath);

  it("drops the copied parent history and links the parent", () => {
    expect(out.events.map((e) => e.eventType)).toEqual([
      "session.started",
      "prompt.submitted",
      "edit.applied",
      "agent.interrupted",
    ]);
    expect(out.sessions[0]).toMatchObject({
      providerSessionId: FORK,
      parentProviderSessionId: MAIN,
      model: "gpt-5.5-codex-mini",
    });
    expect(out.patches.map((p) => p.path)).toEqual(["/Users/dev/app/src/config.ts"]);
    expect(JSON.stringify(out)).not.toMatch(/CANARY_/);
  });

  it("does not count the inherited cumulative usage", () => {
    expect(
      out.usage.map((u) => [u.usageKey, u.inputTokens, u.cachedInputTokens, u.outputTokens]),
    ).toEqual([
      [`${FORK}:cum:1750`, 50, 50, 50],
      [`${FORK}:cum:1900`, 0, 50, 100],
    ]);
  });
});

describe("Codex parser — incremental pass", () => {
  it("knows its session from the file name when it starts mid-file", () => {
    const text = fixture(MAIN_FILE);
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => l.includes('"call_cmd2"'));
    const out = parseText(text, mainPath, idx);
    expect(out.events[0]).toMatchObject({ eventType: "command.completed", sessionId: MAIN });
    expect(out.events.some((e) => e.eventType === "session.started")).toBe(false);
    // The first cumulative value of a pass falls back to that call's own usage.
    expect(out.usage[0]).toMatchObject({
      usageKey: `${MAIN}:cum:1600`,
      inputTokens: 0,
      cachedInputTokens: 400,
      outputTokens: 200,
    });
  });
});

describe("commandText", () => {
  it.each([
    [["/bin/zsh", "-lc", "pnpm test"], "pnpm test"],
    [["bash", "-c", "ls -la"], "ls -la"],
    [["git", "status"], "git status"],
    ["echo hi", "echo hi"],
  ])("%j -> %j", (input, expected) => {
    expect(commandText(input)).toBe(expected);
  });

  it("rejects non-string argv", () => {
    expect(commandText([1, 2])).toBeUndefined();
    expect(commandText(undefined)).toBeUndefined();
  });
});

describe("Codex parser — thread-name index", () => {
  it("yields title-only facts, later names winning", () => {
    const text = [
      JSON.stringify({ id: MAIN, thread_name: "First name", updated_at: "2026-09-29T10:00:00Z" }),
      JSON.stringify({ id: FORK, thread_name: "Explore auth", updated_at: "2026-09-29T10:01:00Z" }),
      JSON.stringify({
        id: MAIN,
        thread_name: "Fix webhook retries",
        updated_at: "2026-09-29T11:00:00Z",
      }),
      "not json",
      "",
    ].join("\n");
    const out = parseText(text, "/h/.codex/session_index.jsonl");
    expect(out.sessions).toEqual([
      {
        provider: "codex",
        providerSessionId: MAIN,
        sourceFile: "/h/.codex/session_index.jsonl",
        title: "Fix webhook retries",
        titleProvenance: "generated",
      },
      {
        provider: "codex",
        providerSessionId: FORK,
        sourceFile: "/h/.codex/session_index.jsonl",
        title: "Explore auth",
        titleProvenance: "generated",
      },
    ]);
    expect(out.failures.map((f) => f.reasonCode)).toEqual(["invalid-json"]);
  });
});
