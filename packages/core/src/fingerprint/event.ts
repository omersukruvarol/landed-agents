import { createHash } from "node:crypto";
import { canonicalJson } from "@landed/shared";
import type { NormalizedEvent } from "../event";

/** Bump when the fingerprint inputs change; old and new fingerprints must never be compared. */
export const EVENT_FINGERPRINT_VERSION = 1;

export type FingerprintableEvent = Pick<
  NormalizedEvent,
  | "provider"
  | "providerEventId"
  | "providerEventType"
  | "sessionId"
  | "eventType"
  | "timestamp"
  | "sequence"
  | "tool"
  | "file"
  | "command"
>;

/**
 * Stable identity of an event for idempotent ingestion (PRD §13 of v0.1, kept in v0.2).
 * Built only from source-determined fields — never from `id`, `receivedAt`, or `sourceRef`,
 * so re-importing the same vendor line from any path yields the same fingerprint.
 * The timestamp is normalized to a UTC instant, so equivalent offsets fingerprint identically.
 */
export function eventFingerprint(event: FingerprintableEvent): string {
  const subset = {
    v: EVENT_FINGERPRINT_VERSION,
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerEventType: event.providerEventType,
    sessionId: event.sessionId,
    eventType: event.eventType,
    at: new Date(event.timestamp).toISOString(),
    sequence: event.sequence,
    toolCallId: event.tool?.callId,
    filePath: event.file?.path,
    command: event.command?.display,
  };
  return createHash("sha256").update(canonicalJson(subset), "utf8").digest("hex").slice(0, 32);
}
