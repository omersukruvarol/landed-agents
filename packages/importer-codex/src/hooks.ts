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

/** Turns a Codex hook payload into a live signal. Only ids and event names are read. */
export function normalizeCodexHook(payload: unknown, receivedAt: string): HookSignal | undefined {
  if (!isObj(payload)) return undefined;
  const sessionId = str(payload.session_id);
  const hookEvent = str(payload.hook_event_name);
  if (!sessionId || !hookEvent) return undefined;
  const transcriptPath = str(payload.transcript_path);
  const event = (eventType: EventType, extra: Partial<NormalizedEvent> = {}): NormalizedEvent =>
    NormalizedEventSchema.parse({
      id: newUlid(Date.parse(receivedAt)),
      schemaVersion: 1,
      provider: "codex",
      providerEventType: `hook:${hookEvent}`,
      sessionId,
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
    const callId = str(payload.tool_use_id);
    events.push(
      event("approval.requested", {
        status: "started",
        tool: { name: str(payload.tool_name) ?? "unknown", ...(callId ? { callId } : {}) },
      }),
    );
  } else if (hookEvent === "SessionEnd") {
    events.push(event("session.ended"));
  }
  return {
    provider: "codex",
    providerSessionId: sessionId,
    hookEvent,
    ...(transcriptPath ? { transcriptPath } : {}),
    events,
  };
}

/** Hook events Landed registers for Codex. */
export const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "Stop",
  "PermissionRequest",
] as const;
