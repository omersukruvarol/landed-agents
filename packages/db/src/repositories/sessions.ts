import {
  type AgentProvider,
  type AgentSession,
  AgentSessionSchema,
  type SessionStatus,
} from "@landed/core";
import { newUlid } from "@landed/shared";
import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { sessions, threadSessions } from "../schema";
import { compact, toIso, toIsoOpt, toMs, toMsOpt } from "../time";

/** What importers provide. `id` is assigned here; `threadId` is owned by the threads stage. */
export type SessionInput = Omit<AgentSession, "id" | "threadId">;

/**
 * Fields written by later pipeline stages. An importer re-scan must not wipe them, so they are
 * set on insert only and changed through dedicated functions.
 */
const STAGE_OWNED = ["generatedSummary", "outcomeSummary"] as const;

export function upsertSession(
  db: LandedDb,
  input: SessionInput,
  now: number = Date.now(),
): AgentSession {
  const existing = getSessionByProviderId(db, input.provider, input.providerSessionId);
  const session = AgentSessionSchema.parse({ ...input, id: existing?.id ?? newUlid(now) });
  const row = toRow(session, now);
  const { id: _id, createdAt: _c, ...update } = row;
  for (const key of STAGE_OWNED) delete (update as Record<string, unknown>)[key];
  db.insert(sessions)
    .values(row)
    .onConflictDoUpdate({ target: [sessions.provider, sessions.providerSessionId], set: update })
    .run();
  const saved = getSession(db, session.id);
  if (!saved) throw new Error("upsertSession: row missing after upsert");
  return saved;
}

export function setSessionOutcomeSummary(
  db: LandedDb,
  sessionId: string,
  summary: Record<string, number>,
  now: number = Date.now(),
): void {
  db.update(sessions)
    .set({ outcomeSummary: summary, updatedAt: now })
    .where(eq(sessions.id, sessionId))
    .run();
}

export function getSession(db: LandedDb, id: string): AgentSession | undefined {
  const row = selectSessions(db).where(eq(sessions.id, id)).get();
  return row && fromRow(row);
}

export function getSessionByProviderId(
  db: LandedDb,
  provider: AgentProvider,
  providerSessionId: string,
): AgentSession | undefined {
  const row = selectSessions(db)
    .where(and(eq(sessions.provider, provider), eq(sessions.providerSessionId, providerSessionId)))
    .get();
  return row && fromRow(row);
}

export interface SessionFilter {
  /** Sessions active at any point in [activeFrom, activeTo). */
  activeFrom?: string;
  activeTo?: string;
  provider?: AgentProvider;
  repoId?: string;
  status?: SessionStatus;
  limit?: number;
  offset?: number;
}

/** Most recent first. */
export function listSessions(db: LandedDb, filter: SessionFilter = {}): AgentSession[] {
  const where: SQL[] = [];
  if (filter.activeTo !== undefined) where.push(lt(sessions.startedAt, toMs(filter.activeTo)));
  if (filter.activeFrom !== undefined) {
    where.push(
      gte(sql`coalesce(${sessions.endedAt}, ${sessions.lastEventAt})`, toMs(filter.activeFrom)),
    );
  }
  if (filter.provider !== undefined) where.push(eq(sessions.provider, filter.provider));
  if (filter.repoId !== undefined) where.push(eq(sessions.repoId, filter.repoId));
  if (filter.status !== undefined) where.push(eq(sessions.status, filter.status));
  return selectSessions(db)
    .where(and(...where))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(filter.limit ?? 500)
    .offset(filter.offset ?? 0)
    .all()
    .map(fromRow);
}

function selectSessions(db: LandedDb) {
  return db
    .select({ session: sessions, threadId: threadSessions.threadId })
    .from(sessions)
    .leftJoin(threadSessions, eq(threadSessions.sessionId, sessions.id));
}

type SessionRow = typeof sessions.$inferSelect;

function toRow(s: AgentSession, now: number): SessionRow {
  return {
    id: s.id,
    provider: s.provider,
    providerSessionId: s.providerSessionId,
    parentSessionId: s.parentSessionId ?? null,
    startedAt: toMs(s.startedAt),
    endedAt: toMsOpt(s.endedAt),
    lastEventAt: toMs(s.lastEventAt),
    status: s.status,
    cwd: s.cwd ?? null,
    repoId: s.repoId ?? null,
    repoRoot: s.repoRoot ?? null,
    projectName: s.projectName ?? null,
    gitBranchStart: s.gitBranchStart ?? null,
    gitBranchEnd: s.gitBranchEnd ?? null,
    gitHeadStart: s.gitHeadStart ?? null,
    gitHeadEnd: s.gitHeadEnd ?? null,
    model: s.model ?? null,
    title: s.title ?? null,
    titleProvenance: s.titleProvenance ?? null,
    observedOutcome: s.observedOutcome ?? null,
    generatedSummary: s.generatedSummary ?? null,
    eventCount: s.eventCount,
    failureCount: s.failureCount,
    changedFileCount: s.changedFileCount,
    inputTokens: s.inputTokens ?? null,
    outputTokens: s.outputTokens ?? null,
    cachedInputTokens: s.cachedInputTokens ?? null,
    reasoningTokens: s.reasoningTokens ?? null,
    usageCoverage: s.usageCoverage ?? null,
    estimatedCostUsd: s.estimatedCostUsd ?? null,
    sourceFiles: s.sourceFiles,
    outcomeSummary: s.outcomeSummary ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function fromRow({
  session: r,
  threadId,
}: {
  session: SessionRow;
  threadId: string | null;
}): AgentSession {
  return AgentSessionSchema.parse({
    ...compact({
      parentSessionId: r.parentSessionId,
      endedAt: toIsoOpt(r.endedAt),
      cwd: r.cwd,
      repoId: r.repoId,
      repoRoot: r.repoRoot,
      projectName: r.projectName,
      gitBranchStart: r.gitBranchStart,
      gitBranchEnd: r.gitBranchEnd,
      gitHeadStart: r.gitHeadStart,
      gitHeadEnd: r.gitHeadEnd,
      model: r.model,
      title: r.title,
      titleProvenance: r.titleProvenance,
      observedOutcome: r.observedOutcome,
      generatedSummary: r.generatedSummary,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cachedInputTokens: r.cachedInputTokens,
      reasoningTokens: r.reasoningTokens,
      usageCoverage: r.usageCoverage,
      estimatedCostUsd: r.estimatedCostUsd,
      outcomeSummary: r.outcomeSummary,
      threadId,
    }),
    id: r.id,
    provider: r.provider,
    providerSessionId: r.providerSessionId,
    startedAt: toIso(r.startedAt),
    lastEventAt: toIso(r.lastEventAt),
    status: r.status,
    eventCount: r.eventCount,
    failureCount: r.failureCount,
    changedFileCount: r.changedFileCount,
    sourceFiles: r.sourceFiles,
  });
}
