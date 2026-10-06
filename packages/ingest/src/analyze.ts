import {
  failureGroups,
  getSetting,
  type LandedDb,
  listOutcomes,
  listPatches,
  listRepos,
  listSessions,
  replaceCollisions,
  replaceThreads,
  syncInsights,
  syncOpenLoops,
} from "@landed/db";
import { detectInsights, INSIGHT_RULES } from "@landed/insights";
import { DEFAULT_LOOP_IGNORE_PATHS, detectCollisions, detectOpenLoops } from "@landed/loops";

/** Setting: directory prefixes whose files raise no output loops (string[]). */
export const LOOP_IGNORE_SETTING = "loopIgnorePaths";

export const loopIgnorePaths = (db: LandedDb): string[] =>
  getSetting<string[]>(db, LOOP_IGNORE_SETTING) ?? DEFAULT_LOOP_IGNORE_PATHS;

import { buildThreads } from "@landed/threads";

export interface AnalysisReport {
  threads: number;
  openLoops: { detected: number; opened: number; resolved: number };
  collisions: number;
  insights: number;
}

/**
 * Recomputes the derived layer from stored sessions, patches and outcomes: threads, open loops
 * (keeping user dismissals), collisions and insights. Deterministic; no LLM involved.
 */
export function analyze(db: LandedDb, nowMs: number = Date.now()): AnalysisReport {
  const sessions = listSessions(db, { limit: 1_000_000 });
  const patches = listPatches(db);
  const outcomes = listOutcomes(db, { scope: "session-file" });
  const defaultBranches = new Map(listRepos(db).map((r) => [r.id, r.defaultBranch ?? undefined]));

  const threads = buildThreads({ sessions, patches, outcomes, defaultBranches, nowMs });
  replaceThreads(db, threads);

  const loops = detectOpenLoops({
    sessions,
    threads,
    patches,
    outcomes,
    nowMs,
    ignorePaths: loopIgnorePaths(db),
  });
  const sync = syncOpenLoops(db, loops, nowMs);

  const collisions = detectCollisions({ sessions, patches, outcomes });
  replaceCollisions(db, collisions);

  const insights = detectInsights({
    sessions,
    outcomes,
    failureGroups: failureGroups(db, INSIGHT_RULES.repeatedFailureMin),
  });
  syncInsights(db, insights);

  return {
    threads: threads.length,
    openLoops: { detected: loops.length, ...sync },
    collisions: collisions.length,
    insights: insights.length,
  };
}
