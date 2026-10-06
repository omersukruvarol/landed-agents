import { newUlid } from "@landed/shared";
import type { NormalizedEvent } from "./event";

export const T0 = "2026-10-01T09:00:00.000Z";
export const T1 = "2026-10-01T10:30:00.000Z";

export function minimalEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: newUlid(),
    schemaVersion: 1,
    provider: "codex",
    providerEventType: "item_completed",
    sessionId: "019a2a0b-7087-79a3-bdb8-48ca581c213b",
    timestamp: T0,
    receivedAt: T1,
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
