import {
  type EventType,
  type HookSignal,
  type NormalizedEvent,
  NormalizedEventSchema,
} from "@landed/core";
import { newUlid } from "@landed/shared";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/**
 * Turns a Claude Code hook payload into a live signal. Only ids and event names are read; the
 * payload's prompt, tool input and messages are ignored.
 */
export function normalizeClaudeHook(payload: unknown, receivedAt: string): HookSignal | undefined {
  if (!isObj(payload)) return undefined;
  const sessionId = str(payload.session_id);
  const hookEvent = str(payload.hook_event_name);
  if (!sessionId || !hookEvent) return undefined;
  const agentId = str(payload.agent_id);
  const psid = agentId ? `${sessionId}:${agentId}` : sessionId;
  const transcriptPath = str(payload.agent_transcript_path) ?? str(payload.transcript_path);

  const event = (eventType: EventType, extra: Partial<NormalizedEvent> = {}): NormalizedEvent =>
    NormalizedEventSchema.parse({
      id: newUlid(Date.parse(receivedAt)),
      schemaVersion: 1,
      provider: "claude-code",
      providerEventType: `hook:${hookEvent}`,
      sessionId: psid,
      ...(agentId ? { parentSessionId: sessionId } : {}),
      timestamp: receivedAt,
      receivedAt,
      eventType,
      ...(str(payload.cwd) ? { cwd: str(payload.cwd) } : {}),
      privacy: {
        promptCaptured: false,
        argumentsCaptured: false,
        resultCaptured: false,
        redactionsApplied: 0,
      },
      ...extra,
    });

  const events: NormalizedEvent[] = [];
  if (hookEvent === "PermissionRequest") {
    const toolName = str(payload.tool_name) ?? "unknown";
    const callId = str(payload.tool_use_id);
    events.push(
      event("approval.requested", {
        status: "started",
        tool: { name: toolName, ...(callId ? { callId } : {}) },
      }),
    );
  } else if (hookEvent === "Notification" && payload.notification_type === "permission_prompt") {
    events.push(event("approval.requested", { status: "started" }));
  } else if (hookEvent === "SessionEnd") {
    events.push(
      event("session.ended", {
        providerEventType: `hook:SessionEnd:${str(payload.reason) ?? "other"}`,
      }),
    );
  }
  return {
    provider: "claude-code",
    providerSessionId: psid,
    hookEvent,
    ...(transcriptPath ? { transcriptPath } : {}),
    events,
  };
}

/** Hook events Landed's plugin subscribes to. */
export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "Stop",
  "PermissionRequest",
  "Notification",
] as const;
