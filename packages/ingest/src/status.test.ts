import type { EventType, NormalizedEvent } from "@landed/core";
import { describe, expect, it } from "vitest";
import { deriveSessionStatus } from "./status";

let n = 0;
function e(eventType: EventType, callId?: string): NormalizedEvent {
  n++;
  return {
    id: `01K6F0000000000000000000${String(n).padStart(2, "0")}`,
    schemaVersion: 1,
    provider: "unknown",
    providerEventType: "x",
    sessionId: "s",
    timestamp: "2026-10-01T00:00:00Z",
    receivedAt: "2026-10-01T00:00:00Z",
    eventType,
    ...(callId ? { tool: { name: "t", callId } } : {}),
    privacy: {
      promptCaptured: false,
      argumentsCaptured: false,
      resultCaptured: false,
      redactionsApplied: 0,
    },
  };
}
/** Builds newest-first input from an oldest-first story. */
const story = (...events: NormalizedEvent[]) => deriveSessionStatus([...events].reverse());

describe("deriveSessionStatus", () => {
  it("is completed after a turn completion with no open calls", () => {
    expect(
      story(
        e("prompt.submitted"),
        e("command.started", "c1"),
        e("command.completed", "c1"),
        e("turn.completed"),
      ),
    ).toBe("completed");
  });

  it("ignores trailing events that carry no lifecycle meaning", () => {
    expect(story(e("turn.completed"), e("unknown"), e("edit.applied"))).toBe("completed");
  });

  it("is unknown when a tool call was left open, even after an earlier turn completed", () => {
    expect(story(e("turn.completed"), e("prompt.submitted"), e("command.started", "c9"))).toBe(
      "unknown",
    );
  });

  it("is awaiting-user when the open call asked the user, regardless of same-timestamp order", () => {
    expect(story(e("tool.started", "ask"), e("session.awaiting-user", "ask"))).toBe(
      "awaiting-user",
    );
    expect(story(e("session.awaiting-user", "ask"), e("tool.started", "ask"))).toBe(
      "awaiting-user",
    );
  });

  it("is no longer awaiting once the question was answered", () => {
    expect(
      story(
        e("tool.started", "ask"),
        e("session.awaiting-user", "ask"),
        e("tool.completed", "ask"),
        e("turn.completed"),
      ),
    ).toBe("completed");
  });

  it("is interrupted or failed from direct evidence", () => {
    expect(story(e("turn.completed"), e("prompt.submitted"), e("agent.interrupted"))).toBe(
      "interrupted",
    );
    expect(story(e("prompt.submitted"), e("error"))).toBe("failed");
  });

  it("is awaiting-user while a permission request is unanswered", () => {
    expect(story(e("turn.completed"), e("prompt.submitted"), e("approval.requested", "c1"))).toBe(
      "awaiting-user",
    );
    expect(
      story(e("approval.requested", "c1"), e("approval.resolved", "c1"), e("turn.completed")),
    ).toBe("completed");
  });

  it("is unknown when the last prompt got no answer or there is no evidence", () => {
    expect(story(e("turn.completed"), e("prompt.submitted"))).toBe("unknown");
    expect(story()).toBe("unknown");
  });
});
