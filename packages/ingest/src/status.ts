import type { NormalizedEvent, SessionStatus } from "@landed/core";

const STARTED = new Set(["tool.started", "command.started", "subagent.started"]);
const FINISHED = new Set([
  "tool.completed",
  "tool.failed",
  "command.completed",
  "command.failed",
  "subagent.ended",
  "approval.resolved",
]);

/**
 * Status from normalized lifecycle evidence, newest event first (PRD §11.1). `completed` needs a
 * turn completion with no tool call left open after it; anything ambiguous stays `unknown`.
 * Vendor-neutral: works for any importer that emits the shared event types. Does not depend on
 * the relative order of events that share a timestamp.
 */
export function deriveSessionStatus(newestFirst: readonly NormalizedEvent[]): SessionStatus {
  const awaitingCalls = new Set(
    newestFirst
      .filter((e) => e.eventType === "session.awaiting-user" && e.tool?.callId)
      .map((e) => e.tool?.callId),
  );
  const finishedCalls = new Set<string>();
  let newerActivity = false;
  for (const e of newestFirst) {
    const callId = e.tool?.callId;
    if (e.eventType === "agent.interrupted") return "interrupted";
    if (FINISHED.has(e.eventType)) {
      if (callId) finishedCalls.add(callId);
      newerActivity = true;
      continue;
    }
    if (STARTED.has(e.eventType)) {
      // The newest still-open call decides: waiting on the user, or cut off mid-tool.
      if (callId && !finishedCalls.has(callId))
        return awaitingCalls.has(callId) ? "awaiting-user" : "unknown";
      continue;
    }
    // A permission request with no answer after it: the agent is blocked on you.
    // A permission request is decisive only while nothing happened after it: once the agent moved
    // on, the request was answered (hooks do not always say which call it was for).
    if (e.eventType === "approval.requested") {
      if (newerActivity || (callId && finishedCalls.has(callId))) continue;
      return "awaiting-user";
    }
    if (e.eventType === "error") return "failed";
    if (e.eventType === "turn.completed") return "completed";
    if (e.eventType === "prompt.submitted") return "unknown"; // the last prompt got no answer
  }
  return "unknown";
}
