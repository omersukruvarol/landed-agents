import { lt } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { sessions } from "../schema";

/**
 * Deletes sessions whose last activity is older than `beforeMs`, with everything derived from them
 * (events, patches, usage, outcomes) through foreign-key cascades. Returns the number removed.
 * Vendor history is untouched; a later scan will not re-import pruned sessions unless their files
 * change, because checkpoints are kept.
 */
export function pruneSessions(db: LandedDb, beforeMs: number): number {
  return db.delete(sessions).where(lt(sessions.lastEventAt, beforeMs)).run().changes;
}
