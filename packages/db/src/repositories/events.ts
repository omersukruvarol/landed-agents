import { type EventType, type NormalizedEvent, NormalizedEventSchema } from "@landed/core";
import { eventFingerprint } from "@landed/core/fingerprint";
import { and, asc, desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { events, sessions } from "../schema";
import { compact, toIso, toMs } from "../time";

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/**
 * Idempotent batch insert (PRD §13: never rely on auto ids for dedupe). Every event is validated
 * against the domain schema first — including the privacy invariants — and must belong to the
 * target session. Duplicates (same fingerprint) are skipped, keeping the first stored copy.
 */
export function insertEvents(
  db: LandedDb,
  sessionId: string,
  batch: readonly NormalizedEvent[],
): InsertResult {
  const session = db
    .select({ provider: sessions.provider, providerSessionId: sessions.providerSessionId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!session) throw new Error(`insertEvents: unknown session ${sessionId}`);

  const rows = batch.map((raw) => {
    const e = NormalizedEventSchema.parse(raw);
    if (e.provider !== session.provider || e.sessionId !== session.providerSessionId) {
      throw new Error(
        `insertEvents: event ${e.id} belongs to ${e.provider}/${e.sessionId}, not session ${sessionId}`,
      );
    }
    return toRow(sessionId, e);
  });

  let inserted = 0;
  db.transaction((tx) => {
    for (const row of rows) {
      inserted += tx
        .insert(events)
        .values(row)
        .onConflictDoNothing({ target: events.fingerprint })
        .run().changes;
    }
  });
  return { inserted, duplicates: rows.length - inserted };
}

export interface EventFilter {
  sessionId?: string;
  from?: string;
  to?: string;
  eventTypes?: EventType[];
  limit?: number;
}

/** Chronological order (timestamp, then vendor sequence). */
export function listEvents(db: LandedDb, filter: EventFilter = {}): NormalizedEvent[] {
  const where: SQL[] = [];
  if (filter.sessionId !== undefined) where.push(eq(events.sessionId, filter.sessionId));
  if (filter.from !== undefined) where.push(gte(events.timestamp, toMs(filter.from)));
  if (filter.to !== undefined) where.push(lt(events.timestamp, toMs(filter.to)));
  if (filter.eventTypes?.length) where.push(inArray(events.eventType, filter.eventTypes));
  return db
    .select()
    .from(events)
    .where(and(...where))
    .orderBy(asc(events.timestamp), asc(events.sequence), asc(events.id))
    .limit(filter.limit ?? 10_000)
    .all()
    .map(fromRow);
}

type EventRow = typeof events.$inferSelect;

function toRow(sessionId: string, e: NormalizedEvent): EventRow {
  return {
    id: e.id,
    fingerprint: eventFingerprint(e),
    schemaVersion: e.schemaVersion,
    sessionId,
    provider: e.provider,
    providerEventId: e.providerEventId ?? null,
    providerEventType: e.providerEventType,
    providerVersion: e.providerVersion ?? null,
    providerSessionId: e.sessionId,
    providerParentSessionId: e.parentSessionId ?? null,
    userId: e.userId ?? null,
    timestamp: toMs(e.timestamp),
    receivedAt: toMs(e.receivedAt),
    sequence: e.sequence ?? null,
    eventType: e.eventType,
    status: e.status ?? null,
    cwd: e.cwd ?? null,
    repoRoot: e.repoRoot ?? null,
    repoRemoteHash: e.repoRemoteHash ?? null,
    projectName: e.projectName ?? null,
    gitBranch: e.gitBranch ?? null,
    gitHead: e.gitHead ?? null,
    model: e.model ?? null,
    toolName: e.tool?.name ?? null,
    toolCategory: e.tool?.category ?? null,
    toolCallId: e.tool?.callId ?? null,
    commandExecutable: e.command?.executable ?? null,
    commandDisplay: e.command?.display ?? null,
    commandExitCode: e.command?.exitCode ?? null,
    filePath: e.file?.path ?? null,
    fileOperation: e.file?.operation ?? null,
    usageInputTokens: e.usage?.inputTokens ?? null,
    usageOutputTokens: e.usage?.outputTokens ?? null,
    usageCachedInputTokens: e.usage?.cachedInputTokens ?? null,
    usageReasoningTokens: e.usage?.reasoningTokens ?? null,
    usageEstimatedCostUsd: e.usage?.estimatedCostUsd ?? null,
    usageCostConfidence: e.usage?.costConfidence ?? null,
    usagePricingVersion: e.usage?.pricingVersion ?? null,
    errorCode: e.error?.code ?? null,
    errorMessage: e.error?.message ?? null,
    content: e.content ?? null,
    promptCaptured: e.privacy.promptCaptured,
    argumentsCaptured: e.privacy.argumentsCaptured,
    resultCaptured: e.privacy.resultCaptured,
    redactionsApplied: e.privacy.redactionsApplied,
    sourceFile: e.sourceRef?.file ?? null,
    sourceOffset: e.sourceRef?.offset ?? null,
    parserVersion: e.sourceRef?.parserVersion ?? null,
    rawPayloadRef: e.rawPayloadRef ?? null,
  };
}

function nested<T extends Record<string, unknown>>(obj: T): Partial<T> | undefined {
  const c = compact(obj);
  return Object.keys(c).length ? (c as Partial<T>) : undefined;
}

function fromRow(r: EventRow): NormalizedEvent {
  const tool =
    r.toolName === null
      ? undefined
      : { name: r.toolName, ...compact({ category: r.toolCategory, callId: r.toolCallId }) };
  const file =
    r.filePath === null
      ? undefined
      : { path: r.filePath, ...compact({ operation: r.fileOperation }) };
  const sourceRef =
    r.sourceFile === null || r.sourceOffset === null || r.parserVersion === null
      ? undefined
      : { file: r.sourceFile, offset: r.sourceOffset, parserVersion: r.parserVersion };
  return NormalizedEventSchema.parse({
    ...compact({
      providerEventId: r.providerEventId,
      providerVersion: r.providerVersion,
      parentSessionId: r.providerParentSessionId,
      userId: r.userId,
      sequence: r.sequence,
      status: r.status,
      cwd: r.cwd,
      repoRoot: r.repoRoot,
      repoRemoteHash: r.repoRemoteHash,
      projectName: r.projectName,
      gitBranch: r.gitBranch,
      gitHead: r.gitHead,
      model: r.model,
      tool,
      command: nested({
        executable: r.commandExecutable,
        display: r.commandDisplay,
        exitCode: r.commandExitCode,
      }),
      file,
      usage: nested({
        inputTokens: r.usageInputTokens,
        outputTokens: r.usageOutputTokens,
        cachedInputTokens: r.usageCachedInputTokens,
        reasoningTokens: r.usageReasoningTokens,
        estimatedCostUsd: r.usageEstimatedCostUsd,
        costConfidence: r.usageCostConfidence,
        pricingVersion: r.usagePricingVersion,
      }),
      error: nested({ code: r.errorCode, message: r.errorMessage }),
      content: r.content,
      sourceRef,
      rawPayloadRef: r.rawPayloadRef,
    }),
    id: r.id,
    schemaVersion: r.schemaVersion,
    provider: r.provider,
    providerEventType: r.providerEventType,
    sessionId: r.providerSessionId,
    timestamp: toIso(r.timestamp),
    receivedAt: toIso(r.receivedAt),
    eventType: r.eventType,
    privacy: {
      promptCaptured: r.promptCaptured,
      argumentsCaptured: r.argumentsCaptured,
      resultCaptured: r.resultCaptured,
      redactionsApplied: r.redactionsApplied,
    },
  });
}

/** Most recent events of a session, newest first — input for status derivation. */
export function latestSessionEvents(
  db: LandedDb,
  sessionId: string,
  limit = 200,
): NormalizedEvent[] {
  return db
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.timestamp), desc(events.sequence), desc(events.id))
    .limit(limit)
    .all()
    .map(fromRow);
}

export interface SessionEventCounts {
  events: number;
  failures: number;
}

export function countSessionEvents(db: LandedDb, sessionId: string): SessionEventCounts {
  const row = db
    .select({
      events: sql<number>`count(*)`,
      failures: sql<number>`coalesce(sum(case when ${events.status} = 'failure' then 1 else 0 end), 0)`,
    })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .get();
  return row ?? { events: 0, failures: 0 };
}

/**
 * Removes everything imported from a source file, so it can be re-parsed from scratch after a
 * parser-version change without leaving rows produced by the old parser behind.
 */
export function deleteEventsBySourceFile(db: LandedDb, sourceFile: string): number {
  return db.delete(events).where(eq(events.sourceFile, sourceFile)).run().changes;
}
