import {
  CostConfidenceSchema,
  CountSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from "@landed/core";
import { newUlid } from "@landed/shared";
import { and, eq, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { LandedDb } from "../connection";
import { usageRecords } from "../schema";
import { toMs } from "../time";
import type { InsertResult } from "./events";

/**
 * One provider-reported usage unit. `usageKey` is the provider's dedupe key: Claude
 * `message.id` (fallback `requestId`), Codex turn id — never a line number (PRD §17).
 */
export const UsageRecordInputSchema = z.strictObject({
  usageKey: NonEmptyStringSchema,
  timestamp: TimestampSchema,
  model: NonEmptyStringSchema.optional(),
  inputTokens: CountSchema.optional(),
  outputTokens: CountSchema.optional(),
  cachedInputTokens: CountSchema.optional(),
  reasoningTokens: CountSchema.optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  costConfidence: CostConfidenceSchema.optional(),
  pricingVersion: NonEmptyStringSchema.optional(),
});
export type UsageRecordInput = z.infer<typeof UsageRecordInputSchema>;

/** Keeps the larger value of a token field when the same usage key is seen again. */
const maxOf = (column: AnySQLiteColumn) =>
  sql`coalesce(max(${column}, excluded.${sql.identifier(column.name)}), ${column}, excluded.${sql.identifier(column.name)})`;

/**
 * Idempotent: a usage key already stored for the session is never counted twice. When a key is
 * seen again, each token field keeps the larger value — Claude rewrites a streamed message's usage
 * on later transcript lines with growing `output_tokens`, so "first wins" would under-count.
 */
export function insertUsageRecords(
  db: LandedDb,
  sessionId: string,
  records: readonly UsageRecordInput[],
): InsertResult {
  const rows = records.map((raw) => {
    const r = UsageRecordInputSchema.parse(raw);
    return {
      id: newUlid(toMs(r.timestamp)),
      sessionId,
      usageKey: r.usageKey,
      timestamp: toMs(r.timestamp),
      model: r.model ?? null,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      cachedInputTokens: r.cachedInputTokens ?? null,
      reasoningTokens: r.reasoningTokens ?? null,
      estimatedCostUsd: r.estimatedCostUsd ?? null,
      costConfidence: r.costConfidence ?? null,
      pricingVersion: r.pricingVersion ?? null,
    };
  });
  let inserted = 0;
  db.transaction((tx) => {
    for (const row of rows) {
      const existed = tx
        .select({ id: usageRecords.id })
        .from(usageRecords)
        .where(and(eq(usageRecords.sessionId, sessionId), eq(usageRecords.usageKey, row.usageKey)))
        .get();
      tx.insert(usageRecords)
        .values(row)
        .onConflictDoUpdate({
          target: [usageRecords.sessionId, usageRecords.usageKey],
          set: {
            inputTokens: maxOf(usageRecords.inputTokens),
            outputTokens: maxOf(usageRecords.outputTokens),
            cachedInputTokens: maxOf(usageRecords.cachedInputTokens),
            reasoningTokens: maxOf(usageRecords.reasoningTokens),
            model: sql`coalesce(${usageRecords.model}, excluded.model)`,
          },
        })
        .run();
      if (!existed) inserted++;
    }
  });
  return { inserted, duplicates: rows.length - inserted };
}

export interface UsageTotals {
  records: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export function sessionUsageTotals(db: LandedDb, sessionId: string): UsageTotals {
  const row = db
    .select({
      records: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageRecords.cachedInputTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${usageRecords.reasoningTokens}), 0)`,
    })
    .from(usageRecords)
    .where(eq(usageRecords.sessionId, sessionId))
    .get();
  return (
    row ?? { records: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 }
  );
}
