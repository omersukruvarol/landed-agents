import { describe, expect, it } from "vitest";
import { createCommandSummarizer, parseSummary } from "./index";

describe("parseSummary", () => {
  it("accepts strict JSON, JSON inside text, and CLI result envelopes", () => {
    expect(parseSummary('{"summary":"Two threads landed.","attention":[]}')).toEqual({
      summary: "Two threads landed.",
      attention: [],
    });
    expect(parseSummary('Here you go:\n{"summary":"ok"}\nthanks')).toEqual({
      summary: "ok",
      attention: [],
    });
    expect(
      parseSummary(JSON.stringify({ result: '{"summary":"wrapped","attention":["x"]}' })),
    ).toEqual({ summary: "wrapped", attention: ["x"] });
  });

  it("rejects anything that does not validate", () => {
    expect(parseSummary("no json")).toBeUndefined();
    expect(parseSummary('{"summary":""}')).toBeUndefined();
    expect(parseSummary('{"summary":"x","extra":1}')).toBeUndefined();
  });
});

describe("createCommandSummarizer", () => {
  it("returns undefined when the command is missing or fails", async () => {
    const missing = createCommandSummarizer({
      command: "definitely-not-a-real-binary-xyz",
      args: [],
    });
    expect(await missing.summarizeDay({})).toBeUndefined();
    const failing = createCommandSummarizer({ command: "sh", args: ["-c", "exit 3"] });
    expect(await failing.summarizeDay({})).toBeUndefined();
  });

  it("reads the reply of a working command", async () => {
    const echo = createCommandSummarizer({
      command: "sh",
      args: ["-c", `cat >/dev/null; printf '{"summary":"fine"}'`],
    });
    expect(await echo.summarizeDay({ a: 1 })).toEqual({ summary: "fine", attention: [] });
  });
});
