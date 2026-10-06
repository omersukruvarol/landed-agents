import type { NormalizedEvent } from "@landed/core";
import { newUlid } from "@landed/shared";
import { type DatabaseHandle, openDatabase } from "./connection";
import type { SessionInput } from "./repositories/sessions";

export const T0 = "2026-10-01T09:00:00.000Z";
export const T1 = "2026-10-01T10:00:00.000Z";
export const T2 = "2026-10-01T11:00:00.000Z";
export const NOW = Date.parse("2026-10-01T12:00:00.000Z");

export function memoryDb(): DatabaseHandle {
  return openDatabase(":memory:");
}

export function sessionInput(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    provider: "codex",
    providerSessionId: "sess-1",
    startedAt: T0,
    lastEventAt: T1,
    status: "unknown",
    eventCount: 0,
    failureCount: 0,
    changedFileCount: 0,
    sourceFiles: ["/x/rollout-1.jsonl"],
    ...overrides,
  };
}

export function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: newUlid(),
    schemaVersion: 1,
    provider: "codex",
    providerEventType: "item_completed",
    sessionId: "sess-1",
    timestamp: T0,
    receivedAt: T2,
    eventType: "command.completed",
    privacy: {
      promptCaptured: false,
      argumentsCaptured: false,
      resultCaptured: false,
      redactionsApplied: 0,
    },
    ...overrides,
  };
}
