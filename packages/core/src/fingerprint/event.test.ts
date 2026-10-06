import { describe, expect, it } from "vitest";
import { minimalEvent } from "../test-helpers";
import { eventFingerprint } from "./event";

describe("eventFingerprint", () => {
  it("is deterministic and 128-bit hex", () => {
    const e = minimalEvent({ providerEventId: "uuid-1" });
    expect(eventFingerprint(e)).toBe(eventFingerprint({ ...e }));
    expect(eventFingerprint(e)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("ignores ingestion-time fields: id, receivedAt, sourceRef", () => {
    const a = minimalEvent({ providerEventId: "uuid-1" });
    const b = {
      ...a,
      id: minimalEvent().id,
      receivedAt: "2027-01-01T00:00:00Z",
      sourceRef: { file: "/moved/elsewhere.jsonl", offset: 99, parserVersion: "codex@2" },
    };
    expect(eventFingerprint(b)).toBe(eventFingerprint(a));
  });

  it("treats equivalent timestamps in different offsets as the same instant", () => {
    const a = minimalEvent({ timestamp: "2026-10-01T09:00:00Z" });
    const b = minimalEvent({ timestamp: "2026-10-01T12:00:00+03:00" });
    expect(eventFingerprint(a)).toBe(eventFingerprint(b));
  });

  it("does not depend on property order", () => {
    const a = minimalEvent({ tool: { name: "exec", callId: "c1" } });
    const b = { ...a, tool: { callId: "c1", name: "exec" } };
    expect(eventFingerprint(b)).toBe(eventFingerprint(a));
  });

  it.each([
    ["providerEventId", { providerEventId: "uuid-2" }],
    ["eventType", { eventType: "command.failed" as const }],
    ["timestamp", { timestamp: "2026-10-01T09:00:00.001Z" }],
    ["sequence", { sequence: 7 }],
    ["tool call id", { tool: { name: "exec", callId: "c2" } }],
    ["file path", { file: { path: "/r/b.ts" } }],
    ["command display", { command: { display: "pnpm lint" } }],
    ["session", { sessionId: "other-session" }],
    ["provider", { provider: "claude-code" as const }],
  ])("changes when %s changes", (_label, change) => {
    const base = minimalEvent({ providerEventId: "uuid-1" });
    expect(eventFingerprint({ ...base, ...change })).not.toBe(eventFingerprint(base));
  });

  it("distinguishes multiple tool calls emitted from one vendor line", () => {
    const line = minimalEvent({ providerEventId: "line-uuid", eventType: "tool.started" });
    const first = { ...line, tool: { name: "Edit", callId: "toolu_1" } };
    const second = { ...line, tool: { name: "Edit", callId: "toolu_2" } };
    expect(eventFingerprint(first)).not.toBe(eventFingerprint(second));
  });
});
