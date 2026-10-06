import { describe, expect, it } from "vitest";
import { normalizeCodexHook } from "./hooks";

describe("normalizeCodexHook", () => {
  it("maps permission requests and session end, ignoring tool input", () => {
    const at = "2026-10-06T10:00:00.000Z";
    const p = normalizeCodexHook(
      {
        session_id: "t1",
        hook_event_name: "PermissionRequest",
        tool_name: "exec",
        tool_input: { cmd: "CANARY" },
        transcript_path: "/h/r.jsonl",
      },
      at,
    );
    expect(p).toMatchObject({
      provider: "codex",
      providerSessionId: "t1",
      transcriptPath: "/h/r.jsonl",
    });
    expect(p?.events[0]?.eventType).toBe("approval.requested");
    expect(JSON.stringify(p)).not.toContain("CANARY");
    expect(
      normalizeCodexHook({ session_id: "t1", hook_event_name: "SessionEnd" }, at)?.events[0]
        ?.eventType,
    ).toBe("session.ended");
    expect(normalizeCodexHook({ session_id: "t1", hook_event_name: "Stop" }, at)?.events).toEqual(
      [],
    );
  });
});
