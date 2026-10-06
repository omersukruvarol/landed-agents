import { describe, expect, it } from "vitest";
import { normalizeClaudeHook } from "./hooks";

const at = "2026-10-06T10:00:00.000Z";
const base = {
  session_id: "s1",
  transcript_path: "/h/.claude/projects/p/s1.jsonl",
  cwd: "/r/app",
  permission_mode: "default",
};

describe("normalizeClaudeHook", () => {
  it("turns a permission request into approval.requested without keeping tool input", () => {
    const s = normalizeClaudeHook(
      {
        ...base,
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "CANARY_SECRET rm -rf /" },
      },
      at,
    );
    expect(s).toMatchObject({
      provider: "claude-code",
      providerSessionId: "s1",
      transcriptPath: base.transcript_path,
    });
    expect(s?.events.map((e) => [e.eventType, e.tool?.name])).toEqual([
      ["approval.requested", "Bash"],
    ]);
    expect(JSON.stringify(s)).not.toContain("CANARY");
  });

  it("maps permission notifications, session end, and subagent ids", () => {
    expect(
      normalizeClaudeHook(
        {
          ...base,
          hook_event_name: "Notification",
          notification_type: "permission_prompt",
          message: "CANARY_MSG",
        },
        at,
      )?.events[0]?.eventType,
    ).toBe("approval.requested");
    expect(
      normalizeClaudeHook(
        { ...base, hook_event_name: "Notification", notification_type: "idle_prompt" },
        at,
      )?.events,
    ).toEqual([]);
    expect(
      normalizeClaudeHook({ ...base, hook_event_name: "SessionEnd", reason: "clear" }, at)
        ?.events[0],
    ).toMatchObject({ eventType: "session.ended", providerEventType: "hook:SessionEnd:clear" });
    const sub = normalizeClaudeHook(
      { ...base, hook_event_name: "Stop", agent_id: "a9", agent_transcript_path: "/h/sub.jsonl" },
      at,
    );
    expect(sub).toMatchObject({
      providerSessionId: "s1:a9",
      transcriptPath: "/h/sub.jsonl",
      events: [],
    });
  });

  it("drops a prompt submission's text", () => {
    const s = normalizeClaudeHook(
      { ...base, hook_event_name: "UserPromptSubmit", prompt: "CANARY_PROMPT" },
      at,
    );
    expect(JSON.stringify(s)).not.toContain("CANARY");
  });

  it("rejects payloads without a session or event name", () => {
    expect(normalizeClaudeHook({ hook_event_name: "Stop" }, at)).toBeUndefined();
    expect(normalizeClaudeHook("nope", at)).toBeUndefined();
  });
});
