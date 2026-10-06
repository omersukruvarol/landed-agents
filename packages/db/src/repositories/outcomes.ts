import {
  type AgentProvider,
  type Outcome,
  type OutcomeClass,
  type OutcomeConfidence,
  OutcomeSchema,
  type OutcomeScope,
} from "@landed/core";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { outcomes, repos, sessions } from "../schema";
import { compact, toIso, toMs, toMsOpt } from "../time";

/** Stable identity of what an outcome is about, so re-computation updates rather than duplicates. */
export function outcomeSubjectKey(
  o: Pick<Outcome, "scope" | "patchId" | "sessionId" | "repoId" | "relPath">,
): string {
  if (o.scope === "patch") {
    if (!o.patchId) throw new Error("patch-scope outcome needs patchId");
    return o.patchId;
  }
  return `${o.sessionId}:${o.repoId ?? ""}:${o.relPath ?? ""}`;
}

/** Validates and upserts outcomes; an existing outcome keeps its id. Returns the number written. */
export function upsertOutcomes(db: LandedDb, batch: readonly Outcome[]): number {
  const rows = batch.map((raw) => toRow(OutcomeSchema.parse(raw)));
  db.transaction((tx) => {
    for (const row of rows) {
      const { id: _id, ...update } = row;
      tx.insert(outcomes)
        .values(row)
        .onConflictDoUpdate({ target: [outcomes.scope, outcomes.subjectKey], set: update })
        .run();
    }
  });
  return rows.length;
}

export interface OutcomeFilter {
  scope?: OutcomeScope;
  sessionId?: string;
  repoId?: string;
  class?: OutcomeClass;
}

export function listOutcomes(db: LandedDb, filter: OutcomeFilter = {}): Outcome[] {
  const where: SQL[] = [];
  if (filter.scope) where.push(eq(outcomes.scope, filter.scope));
  if (filter.sessionId) where.push(eq(outcomes.sessionId, filter.sessionId));
  if (filter.repoId) where.push(eq(outcomes.repoId, filter.repoId));
  if (filter.class) where.push(eq(outcomes.class, filter.class));
  return db
    .select()
    .from(outcomes)
    .where(and(...where))
    .all()
    .map(fromRow);
}

export interface DistributionFilter {
  scope: OutcomeScope;
  provider?: AgentProvider;
  repoId?: string;
  /** Sessions that started in [from, to). */
  from?: string;
  to?: string;
}

/** Outcome counts by class, joined to sessions for provider and time filters. */
export function outcomeDistribution(
  db: LandedDb,
  filter: DistributionFilter,
): Partial<Record<OutcomeClass, number>> {
  const where: SQL[] = [eq(outcomes.scope, filter.scope)];
  if (filter.provider) where.push(eq(sessions.provider, filter.provider));
  if (filter.repoId) where.push(eq(outcomes.repoId, filter.repoId));
  if (filter.from) where.push(gte(sessions.startedAt, toMs(filter.from)));
  if (filter.to) where.push(lt(sessions.startedAt, toMs(filter.to)));
  const rows = db
    .select({ cls: outcomes.class, n: sql<number>`count(*)` })
    .from(outcomes)
    .innerJoin(sessions, eq(sessions.id, outcomes.sessionId))
    .where(and(...where))
    .groupBy(outcomes.class)
    .all();
  return Object.fromEntries(rows.map((r) => [r.cls, r.n])) as Partial<Record<OutcomeClass, number>>;
}

export interface RepoOutcomeCheck {
  controlA: number;
  controlB: number;
  confidence: OutcomeConfidence;
}

export function setRepoOutcomeCheck(
  db: LandedDb,
  repoId: string,
  check: RepoOutcomeCheck | undefined,
  at: number,
): void {
  db.update(repos)
    .set({
      outcomeControlA: check?.controlA ?? null,
      outcomeControlB: check?.controlB ?? null,
      outcomeConfidence: check?.confidence ?? null,
      outcomesComputedAt: at,
    })
    .where(eq(repos.id, repoId))
    .run();
}

type OutcomeRow = typeof outcomes.$inferSelect;

function toRow(o: Outcome): OutcomeRow {
  return {
    id: o.id,
    subjectKey: outcomeSubjectKey(o),
    scope: o.scope,
    patchId: o.patchId ?? null,
    sessionId: o.sessionId,
    repoId: o.repoId ?? null,
    relPath: o.relPath ?? null,
    class: o.class,
    unknownReason: o.unknownReason ?? null,
    survival: o.survival,
    fracCommitted: o.fracCommitted,
    fracOnDefaultBranch: o.fracOnDefaultBranch,
    fracInWorkingTree: o.fracInWorkingTree,
    firstCommitSha: o.firstCommit?.sha ?? null,
    firstCommitTime: toMsOpt(o.firstCommit?.time),
    firstCommitSubject: o.firstCommit?.subject ?? null,
    firstCommitBranch: o.firstCommit?.branch ?? null,
    commitLagSeconds: o.commitLagSeconds ?? null,
    lineCount: o.lineCount,
    computedAt: toMs(o.computedAt),
    engineVersion: o.engineVersion,
  };
}

function fromRow(r: OutcomeRow): Outcome {
  const firstCommit =
    r.firstCommitSha && r.firstCommitTime !== null
      ? {
          sha: r.firstCommitSha,
          time: toIso(r.firstCommitTime),
          ...compact({ subject: r.firstCommitSubject, branch: r.firstCommitBranch }),
        }
      : undefined;
  return OutcomeSchema.parse({
    ...compact({
      patchId: r.patchId,
      repoId: r.repoId,
      relPath: r.relPath,
      unknownReason: r.unknownReason,
      commitLagSeconds: r.commitLagSeconds,
      firstCommit,
    }),
    id: r.id,
    scope: r.scope,
    sessionId: r.sessionId,
    class: r.class,
    survival: r.survival,
    fracCommitted: r.fracCommitted,
    fracOnDefaultBranch: r.fracOnDefaultBranch,
    fracInWorkingTree: r.fracInWorkingTree,
    lineCount: r.lineCount,
    provenance: "derived",
    computedAt: toIso(r.computedAt),
    engineVersion: r.engineVersion,
  });
}
