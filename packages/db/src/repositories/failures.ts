import type { AgentProvider } from "@landed/core";
import { newUlid } from "@landed/shared";
import { eq, sql } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { ingestionFailures } from "../schema";

/** Diagnostic messages are short and must never contain the offending line's text. */
export const MAX_FAILURE_MESSAGE = 200;

export interface IngestionFailureInput {
  provider: AgentProvider;
  sourceFile: string;
  offset: number;
  parserVersion: string;
  /** Machine-readable reason, e.g. "invalid-json", "schema-mismatch". */
  reasonCode: string;
  message?: string;
}

/** Idempotent per (file, offset, parser version). Returns true if newly recorded. */
export function recordIngestionFailure(
  db: LandedDb,
  input: IngestionFailureInput,
  now: number = Date.now(),
): boolean {
  return (
    db
      .insert(ingestionFailures)
      .values({
        id: newUlid(now),
        ...input,
        message: input.message?.slice(0, MAX_FAILURE_MESSAGE) ?? null,
        occurredAt: now,
      })
      .onConflictDoNothing({
        target: [
          ingestionFailures.sourceFile,
          ingestionFailures.offset,
          ingestionFailures.parserVersion,
        ],
      })
      .run().changes > 0
  );
}

export function countIngestionFailures(db: LandedDb, sourceFile?: string): number {
  const q = db.select({ n: sql<number>`count(*)` }).from(ingestionFailures);
  const row = (
    sourceFile === undefined ? q : q.where(eq(ingestionFailures.sourceFile, sourceFile))
  ).get();
  return row?.n ?? 0;
}
