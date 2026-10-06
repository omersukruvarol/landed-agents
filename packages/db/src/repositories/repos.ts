import { newUlid } from "@landed/shared";
import { eq } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { repos } from "../schema";

export type RepoRow = typeof repos.$inferSelect;

export interface RepoInput {
  rootPath: string;
  remoteHash?: string;
  defaultBranch?: string;
}

/** Registers a repository by root path (idempotent); a re-seen repo is no longer `missing`. */
export function upsertRepo(db: LandedDb, input: RepoInput, now: number = Date.now()): RepoRow {
  const update = {
    lastSeenAt: now,
    missing: false,
    ...(input.remoteHash !== undefined && { remoteHash: input.remoteHash }),
    ...(input.defaultBranch !== undefined && { defaultBranch: input.defaultBranch }),
  };
  db.insert(repos)
    .values({ id: newUlid(now), rootPath: input.rootPath, createdAt: now, ...update })
    .onConflictDoUpdate({ target: repos.rootPath, set: update })
    .run();
  const row = getRepoByRoot(db, input.rootPath);
  if (!row) throw new Error("upsertRepo: row missing after insert");
  return row;
}

export function getRepoByRoot(db: LandedDb, rootPath: string): RepoRow | undefined {
  return db.select().from(repos).where(eq(repos.rootPath, rootPath)).get();
}

export function getRepo(db: LandedDb, id: string): RepoRow | undefined {
  return db.select().from(repos).where(eq(repos.id, id)).get();
}

export function listRepos(db: LandedDb): RepoRow[] {
  return db.select().from(repos).orderBy(repos.rootPath).all();
}

/** A repo whose root no longer exists (e.g. a deleted worktree) keeps its history. */
export function markRepoMissing(db: LandedDb, id: string): void {
  db.update(repos).set({ missing: true }).where(eq(repos.id, id)).run();
}
