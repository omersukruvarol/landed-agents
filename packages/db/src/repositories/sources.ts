import type { AgentProvider } from "@landed/core";
import { newUlid } from "@landed/shared";
import { and, eq } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { sourceCheckpoints, sources } from "../schema";

export type SourceRow = typeof sources.$inferSelect;

/** Registers a vendor history root (idempotent) and returns it. */
export function upsertSource(
  db: LandedDb,
  input: { provider: AgentProvider; rootPath: string },
  now: number = Date.now(),
): SourceRow {
  db.insert(sources)
    .values({
      id: newUlid(now),
      provider: input.provider,
      rootPath: input.rootPath,
      createdAt: now,
    })
    .onConflictDoNothing({ target: [sources.provider, sources.rootPath] })
    .run();
  const row = db
    .select()
    .from(sources)
    .where(and(eq(sources.provider, input.provider), eq(sources.rootPath, input.rootPath)))
    .get();
  if (!row) throw new Error("upsertSource: row missing after insert");
  return row;
}

export function listSources(db: LandedDb): SourceRow[] {
  return db.select().from(sources).orderBy(sources.createdAt).all();
}

export function markSourceScanned(db: LandedDb, sourceId: string, at: number = Date.now()): void {
  db.update(sources).set({ lastScanAt: at }).where(eq(sources.id, sourceId)).run();
}

export interface Checkpoint {
  sourceId: string;
  path: string;
  inode: number;
  size: number;
  mtimeMs: number;
  byteOffset: number;
  parserVersion: string;
}

export function getCheckpoint(db: LandedDb, path: string): Checkpoint | undefined {
  const row = db.select().from(sourceCheckpoints).where(eq(sourceCheckpoints.path, path)).get();
  if (!row) return undefined;
  const { id: _id, updatedAt: _u, ...cp } = row;
  return cp;
}

/** Records how far a source file has been imported. */
export function saveCheckpoint(db: LandedDb, cp: Checkpoint, now: number = Date.now()): void {
  if (cp.byteOffset < 0 || cp.byteOffset > cp.size) {
    throw new RangeError(`saveCheckpoint: offset ${cp.byteOffset} outside file size ${cp.size}`);
  }
  db.insert(sourceCheckpoints)
    .values({ id: newUlid(now), ...cp, updatedAt: now })
    .onConflictDoUpdate({ target: sourceCheckpoints.path, set: { ...cp, updatedAt: now } })
    .run();
}
