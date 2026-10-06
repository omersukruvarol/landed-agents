import {
  type Collision,
  CollisionSchema,
  type Insight,
  InsightSchema,
  type OpenLoop,
  OpenLoopSchema,
  type WorkThread,
  WorkThreadSchema,
} from "@landed/core";
import { and, desc, eq, inArray, isNull, notInArray, type SQL, sql } from "drizzle-orm";
import type { LandedDb } from "../connection";
import {
  collisions,
  events,
  insights,
  openLoops,
  sessions,
  threadSessions,
  threads,
} from "../schema";
import { compact, toIso, toIsoOpt, toMs } from "../time";

// ── Threads ───────────────────────────────────────────────────────────────────────────────

/** Replaces all threads (they are fully derived) and their memberships. */
export function replaceThreads(db: LandedDb, all: readonly WorkThread[]): void {
  const valid = all.map((t) => WorkThreadSchema.parse(t));
  db.transaction((tx) => {
    tx.delete(threadSessions).run();
    tx.delete(threads).run();
    for (const t of valid) {
      tx.insert(threads)
        .values({
          id: t.id,
          repoId: t.repoId,
          startedAt: toMs(t.startedAt),
          lastActivityAt: toMs(t.lastActivityAt),
          title: t.title,
          titleProvenance: t.titleProvenance,
          branch: t.branch ?? null,
          status: t.status,
          providers: t.providers,
          linkEvidence: t.linkEvidence,
        })
        .run();
      for (const sessionId of t.sessionIds)
        tx.insert(threadSessions).values({ threadId: t.id, sessionId }).run();
    }
  });
}

export interface ThreadFilter {
  repoId?: string;
  status?: WorkThread["status"];
  limit?: number;
}

export function listThreads(db: LandedDb, filter: ThreadFilter = {}): WorkThread[] {
  const where: SQL[] = [];
  if (filter.repoId) where.push(eq(threads.repoId, filter.repoId));
  if (filter.status) where.push(eq(threads.status, filter.status));
  const rows = db
    .select()
    .from(threads)
    .where(and(...where))
    .orderBy(desc(threads.lastActivityAt))
    .limit(filter.limit ?? 1000)
    .all();
  const members = rows.length
    ? db
        .select()
        .from(threadSessions)
        .where(
          inArray(
            threadSessions.threadId,
            rows.map((r) => r.id),
          ),
        )
        .all()
    : [];
  const byThread = new Map<string, string[]>();
  for (const m of members)
    byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m.sessionId]);
  return rows.map((r) =>
    WorkThreadSchema.parse({
      ...compact({ branch: r.branch }),
      id: r.id,
      repoId: r.repoId,
      sessionIds: byThread.get(r.id) ?? [],
      providers: r.providers,
      startedAt: toIso(r.startedAt),
      lastActivityAt: toIso(r.lastActivityAt),
      title: r.title,
      titleProvenance: r.titleProvenance,
      status: r.status,
      linkEvidence: r.linkEvidence,
    }),
  );
}

export function getThread(db: LandedDb, id: string): WorkThread | undefined {
  return listThreads(db).find((t) => t.id === id);
}

// ── Open loops ────────────────────────────────────────────────────────────────────────────

export interface OpenLoopRecord extends OpenLoop {
  key: string;
  dismissReason?: string;
}

/**
 * Applies a fresh detector run: new loops are inserted, re-detected loops are updated (a user's
 * dismissal is kept), and open loops no longer detected are resolved automatically.
 */
export function syncOpenLoops(
  db: LandedDb,
  detected: readonly OpenLoopRecord[],
  now: number,
): { opened: number; resolved: number } {
  let opened = 0;
  let resolved = 0;
  db.transaction((tx) => {
    for (const raw of detected) {
      const { key, dismissReason: _d, ...loop } = raw;
      const l = OpenLoopSchema.parse(loop);
      const existing = tx.select().from(openLoops).where(eq(openLoops.loopKey, key)).get();
      const fields = {
        type: l.type,
        repoId: l.repoId ?? null,
        threadId: l.threadId ?? null,
        sessionIds: l.sessionIds,
        since: toMs(l.since),
        sizeFiles: l.size.files ?? null,
        sizeLines: l.size.lines ?? null,
        sizeCommits: l.size.commits ?? null,
        evidence: l.evidence,
        provenance: l.provenance,
        updatedAt: now,
      };
      if (!existing) {
        tx.insert(openLoops)
          .values({ id: l.id, loopKey: key, ...fields, state: "open", createdAt: now })
          .run();
        opened++;
      } else {
        const reopened = existing.state === "resolved" ? { state: "open", resolvedBy: null } : {};
        tx.update(openLoops)
          .set({ ...fields, ...reopened })
          .where(eq(openLoops.id, existing.id))
          .run();
      }
    }
    const keys = detected.map((d) => d.key);
    const stale = tx
      .select({ id: openLoops.id })
      .from(openLoops)
      .where(
        and(
          eq(openLoops.state, "open"),
          keys.length ? notInArray(openLoops.loopKey, keys) : sql`1 = 1`,
        ),
      )
      .all();
    for (const s of stale) {
      tx.update(openLoops)
        .set({ state: "resolved", resolvedBy: "auto", updatedAt: now })
        .where(eq(openLoops.id, s.id))
        .run();
      resolved++;
    }
  });
  return { opened, resolved };
}

export function listOpenLoops(
  db: LandedDb,
  filter: { state?: OpenLoop["state"]; repoId?: string } = {},
): OpenLoopRecord[] {
  const where: SQL[] = [];
  if (filter.state) where.push(eq(openLoops.state, filter.state));
  if (filter.repoId) where.push(eq(openLoops.repoId, filter.repoId));
  return db
    .select()
    .from(openLoops)
    .where(and(...where))
    .orderBy(openLoops.since)
    .all()
    .map((r) => ({
      ...OpenLoopSchema.parse({
        ...compact({ repoId: r.repoId, threadId: r.threadId, resolvedBy: r.resolvedBy }),
        id: r.id,
        type: r.type,
        sessionIds: r.sessionIds,
        since: toIso(r.since),
        size: compact({ files: r.sizeFiles, lines: r.sizeLines, commits: r.sizeCommits }),
        evidence: r.evidence,
        provenance: r.provenance,
        state: r.state,
      }),
      key: r.loopKey,
      ...compact({ dismissReason: r.dismissReason }),
    }));
}

/** User actions on a loop. Dismissal survives re-detection; resolution may be undone by it. */
export function setOpenLoopState(
  db: LandedDb,
  id: string,
  state: "dismissed" | "resolved" | "open",
  now: number,
  reason?: string,
): boolean {
  const changes = db
    .update(openLoops)
    .set({
      state,
      resolvedBy: state === "resolved" ? "user" : null,
      dismissReason: state === "dismissed" ? (reason?.slice(0, 200) ?? null) : null,
      updatedAt: now,
    })
    .where(eq(openLoops.id, id))
    .run().changes;
  return changes > 0;
}

// ── Collisions ────────────────────────────────────────────────────────────────────────────

export interface CollisionRecord extends Collision {
  key: string;
}

export function replaceCollisions(db: LandedDb, all: readonly CollisionRecord[]): void {
  db.transaction((tx) => {
    tx.delete(collisions).run();
    for (const { key, ...c } of all) {
      const v = CollisionSchema.parse(c);
      tx.insert(collisions)
        .values({
          id: v.id,
          collisionKey: key,
          repoId: v.repoId,
          relPath: v.relPath,
          sessionA: v.sessionA,
          sessionB: v.sessionB,
          kind: v.kind,
          windowStart: toMs(v.window.start),
          windowEnd: toMs(v.window.end),
          evidence: v.evidence,
          provenance: v.provenance,
        })
        .onConflictDoNothing({ target: collisions.collisionKey })
        .run();
    }
  });
}

export function listCollisions(
  db: LandedDb,
  filter: { repoId?: string; since?: string } = {},
): Collision[] {
  const where: SQL[] = [];
  if (filter.repoId) where.push(eq(collisions.repoId, filter.repoId));
  if (filter.since) where.push(sql`${collisions.windowEnd} >= ${toMs(filter.since)}`);
  return db
    .select()
    .from(collisions)
    .where(and(...where))
    .orderBy(desc(collisions.windowEnd))
    .all()
    .map((r) =>
      CollisionSchema.parse({
        id: r.id,
        repoId: r.repoId,
        relPath: r.relPath,
        sessionA: r.sessionA,
        sessionB: r.sessionB,
        kind: r.kind,
        window: { start: toIso(r.windowStart), end: toIso(r.windowEnd) },
        evidence: r.evidence,
        provenance: r.provenance,
      }),
    );
}

// ── Insights ──────────────────────────────────────────────────────────────────────────────

export interface InsightRecord extends Insight {
  key: string;
}

/** Upserts detected insights (keeping dismissals) and removes undismissed ones no longer detected. */
export function syncInsights(db: LandedDb, detected: readonly InsightRecord[]): void {
  db.transaction((tx) => {
    for (const { key, ...raw } of detected) {
      const i = InsightSchema.parse(raw);
      const fields = {
        type: i.type,
        severity: i.severity,
        message: i.message,
        evidence: i.evidence,
        provenance: i.provenance,
        sessionId: i.sessionId ?? null,
        threadId: null,
        repoId: i.repoId ?? null,
      };
      tx.insert(insights)
        .values({ id: i.id, insightKey: key, ...fields, createdAt: toMs(i.createdAt) })
        .onConflictDoUpdate({ target: insights.insightKey, set: fields })
        .run();
    }
    const keys = detected.map((d) => d.key);
    tx.delete(insights)
      .where(
        and(
          isNull(insights.dismissedAt),
          keys.length ? notInArray(insights.insightKey, keys) : sql`1 = 1`,
        ),
      )
      .run();
  });
}

export function listInsights(
  db: LandedDb,
  filter: { sessionId?: string; includeDismissed?: boolean } = {},
): Insight[] {
  const where: SQL[] = [];
  if (filter.sessionId) where.push(eq(insights.sessionId, filter.sessionId));
  if (!filter.includeDismissed) where.push(isNull(insights.dismissedAt));
  return db
    .select()
    .from(insights)
    .where(and(...where))
    .orderBy(desc(insights.createdAt))
    .all()
    .map((r) =>
      InsightSchema.parse({
        ...compact({
          sessionId: r.sessionId,
          repoId: r.repoId,
          dismissedAt: toIsoOpt(r.dismissedAt),
        }),
        id: r.id,
        type: r.type,
        severity: r.severity,
        message: r.message,
        evidence: r.evidence,
        provenance: r.provenance,
        createdAt: toIso(r.createdAt),
      }),
    );
}

export function dismissInsight(db: LandedDb, id: string, now: number): boolean {
  return db.update(insights).set({ dismissedAt: now }).where(eq(insights.id, id)).run().changes > 0;
}

// ── Analysis inputs ───────────────────────────────────────────────────────────────────────

export interface FailureGroup {
  sessionId: string;
  signature: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Failed commands/tools grouped by a normalized signature within a session — input for the
 * repeated-failure insight (PRD §16). The signature is the sanitized command display (already
 * redacted) or the tool name.
 */
export function failureGroups(
  db: LandedDb,
  minCount: number,
  filter: { sessionIds?: readonly string[] } = {},
): FailureGroup[] {
  if (filter.sessionIds && filter.sessionIds.length === 0) return [];
  const signature = sql<string>`coalesce(${events.commandDisplay}, ${events.toolName}, ${events.eventType})`;
  const failed = inArray(events.eventType, ["command.failed", "tool.failed"]);
  return db
    .select({
      sessionId: events.sessionId,
      signature,
      count: sql<number>`count(*)`,
      first: sql<number>`min(${events.timestamp})`,
      last: sql<number>`max(${events.timestamp})`,
    })
    .from(events)
    .where(
      filter.sessionIds ? and(failed, inArray(events.sessionId, [...filter.sessionIds])) : failed,
    )
    .groupBy(events.sessionId, signature)
    .having(sql`count(*) >= ${minCount}`)
    .all()
    .map((r) => ({
      sessionId: r.sessionId,
      signature: r.signature,
      count: r.count,
      firstAt: toIso(r.first),
      lastAt: toIso(r.last),
    }));
}

/** All sessions, oldest first — analysis input. */
export function allSessionsForAnalysis(db: LandedDb) {
  return db.select().from(sessions).orderBy(sessions.startedAt).all();
}
