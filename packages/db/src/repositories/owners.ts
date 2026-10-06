import type { AgentProvider } from "@landed/core";
import { and, eq, inArray, isNull, max, min } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { agentPatches, events, sessions, usageRecords } from "../schema";

/**
 * Lookups for cross-session deduplication. Vendors copy conversation history into resumed or
 * forked sessions, keeping the original line, tool-call and message ids. A vendor id that already
 * belongs to another session is history, not new activity.
 */

const CHUNK = 500;

function* chunks<T>(items: readonly T[]): Generator<T[]> {
  for (let i = 0; i < items.length; i += CHUNK) yield items.slice(i, i + CHUNK);
}

export interface EventOwner {
  sessionId: string;
  providerEventId: string;
  eventType: string;
  toolCallId: string | null;
}

export function findEventOwners(
  db: LandedDb,
  provider: AgentProvider,
  providerEventIds: readonly string[],
): EventOwner[] {
  const out: EventOwner[] = [];
  for (const ids of chunks([...new Set(providerEventIds)])) {
    for (const r of db
      .select({
        sessionId: events.sessionId,
        providerEventId: events.providerEventId,
        eventType: events.eventType,
        toolCallId: events.toolCallId,
      })
      .from(events)
      .where(and(eq(events.provider, provider), inArray(events.providerEventId, ids)))
      .all()) {
      if (r.providerEventId) out.push({ ...r, providerEventId: r.providerEventId });
    }
  }
  return out;
}

export interface IdlessEventOwner {
  sessionId: string;
  timestamp: number;
  providerEventType: string;
  eventType: string;
}

/** Owners of events without a vendor id, matched by their exact time (copies keep timestamps). */
export function findIdlessEventOwners(
  db: LandedDb,
  provider: AgentProvider,
  timestampsMs: readonly number[],
): IdlessEventOwner[] {
  const out: IdlessEventOwner[] = [];
  for (const ts of chunks([...new Set(timestampsMs)])) {
    out.push(
      ...db
        .select({
          sessionId: events.sessionId,
          timestamp: events.timestamp,
          providerEventType: events.providerEventType,
          eventType: events.eventType,
        })
        .from(events)
        .where(
          and(
            eq(events.provider, provider),
            isNull(events.providerEventId),
            inArray(events.timestamp, ts),
          ),
        )
        .all(),
    );
  }
  return out;
}

export interface PatchOwner {
  sessionId: string;
  toolCallId: string;
  path: string;
}

export function findPatchOwners(
  db: LandedDb,
  provider: AgentProvider,
  toolCallIds: readonly string[],
): PatchOwner[] {
  const out: PatchOwner[] = [];
  for (const ids of chunks([...new Set(toolCallIds)])) {
    for (const r of db
      .select({
        sessionId: agentPatches.sessionId,
        toolCallId: agentPatches.toolCallId,
        path: agentPatches.path,
      })
      .from(agentPatches)
      .where(and(eq(agentPatches.provider, provider), inArray(agentPatches.toolCallId, ids)))
      .all()) {
      if (r.toolCallId) out.push({ ...r, toolCallId: r.toolCallId });
    }
  }
  return out;
}

export interface UsageOwner {
  sessionId: string;
  usageKey: string;
}

export function findUsageOwners(
  db: LandedDb,
  provider: AgentProvider,
  usageKeys: readonly string[],
): UsageOwner[] {
  const out: UsageOwner[] = [];
  for (const keys of chunks([...new Set(usageKeys)])) {
    out.push(
      ...db
        .select({ sessionId: usageRecords.sessionId, usageKey: usageRecords.usageKey })
        .from(usageRecords)
        .innerJoin(sessions, eq(sessions.id, usageRecords.sessionId))
        .where(and(eq(sessions.provider, provider), inArray(usageRecords.usageKey, keys)))
        .all(),
    );
  }
  return out;
}

/** First and last stored event time of a session (ms), or undefined without events. */
export function sessionEventSpan(
  db: LandedDb,
  sessionId: string,
): { first: number; last: number } | undefined {
  const r = db
    .select({ first: min(events.timestamp), last: max(events.timestamp) })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .get();
  return r?.first != null && r.last != null ? { first: r.first, last: r.last } : undefined;
}
