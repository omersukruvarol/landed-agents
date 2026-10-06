import { createHash } from "node:crypto";
import { type AgentPatch, AgentPatchSchema } from "@landed/core";
import { canonicalJson } from "@landed/shared";
import { and, asc, countDistinct, eq, type SQL } from "drizzle-orm";
import type { LandedDb } from "../connection";
import { agentPatches, patchLineFps } from "../schema";
import { compact, toIso, toMs } from "../time";
import type { InsertResult } from "./events";

const FP_CHUNK = 500; // rows per multi-row insert, well under SQLite's variable limit

/**
 * Content-addressed identity of a patch: the same tool call editing the same file with the same
 * lines is one patch, however many times it is re-imported (and from wherever).
 */
export function patchKey(p: AgentPatch): string {
  const subject = {
    v: 1,
    sessionId: p.sessionId,
    toolCallId: p.toolCallId,
    path: p.path,
    at: toMs(p.timestamp),
    operation: p.operation,
    added: p.addedLineFps,
    removed: p.removedLineFps,
  };
  return createHash("sha256").update(canonicalJson(subject), "utf8").digest("hex").slice(0, 32);
}

export function insertPatches(db: LandedDb, batch: readonly AgentPatch[]): InsertResult {
  const patches = batch.map((p) => AgentPatchSchema.parse(p));
  let inserted = 0;
  db.transaction((tx) => {
    for (const p of patches) {
      const changes = tx
        .insert(agentPatches)
        .values({
          id: p.id,
          patchKey: patchKey(p),
          sessionId: p.sessionId,
          provider: p.provider,
          toolCallId: p.toolCallId ?? null,
          timestamp: toMs(p.timestamp),
          repoId: p.repoId ?? null,
          path: p.path,
          relPath: p.relPath ?? null,
          operation: p.operation,
          addedLineCountRaw: p.addedLineCountRaw,
          removedLineCountRaw: p.removedLineCountRaw,
          sourceFile: p.sourceRef.file,
          sourceOffset: p.sourceRef.offset,
          parserVersion: p.sourceRef.parserVersion,
        })
        .onConflictDoNothing({ target: agentPatches.patchKey })
        .run().changes;
      if (changes === 0) continue;
      inserted++;
      const fps = [
        ...p.addedLineFps.map((fp, ordinal) => ({
          patchId: p.id,
          side: "added" as const,
          ordinal,
          fp,
        })),
        ...p.removedLineFps.map((fp, ordinal) => ({
          patchId: p.id,
          side: "removed" as const,
          ordinal,
          fp,
        })),
      ];
      for (let i = 0; i < fps.length; i += FP_CHUNK) {
        tx.insert(patchLineFps)
          .values(fps.slice(i, i + FP_CHUNK))
          .run();
      }
    }
  });
  return { inserted, duplicates: patches.length - inserted };
}

export interface PatchFilter {
  sessionId?: string;
  repoId?: string;
  relPath?: string;
}

/** Chronological order; fingerprints in their original order. */
export function listPatches(db: LandedDb, filter: PatchFilter = {}): AgentPatch[] {
  const where: SQL[] = [];
  if (filter.sessionId !== undefined) where.push(eq(agentPatches.sessionId, filter.sessionId));
  if (filter.repoId !== undefined) where.push(eq(agentPatches.repoId, filter.repoId));
  if (filter.relPath !== undefined) where.push(eq(agentPatches.relPath, filter.relPath));
  const rows = db
    .select()
    .from(agentPatches)
    .where(and(...where))
    .orderBy(asc(agentPatches.timestamp), asc(agentPatches.id))
    .all();
  return rows.map((r) => {
    const fps = db
      .select({ side: patchLineFps.side, fp: patchLineFps.fp })
      .from(patchLineFps)
      .where(eq(patchLineFps.patchId, r.id))
      .orderBy(asc(patchLineFps.side), asc(patchLineFps.ordinal))
      .all();
    return AgentPatchSchema.parse({
      ...compact({ toolCallId: r.toolCallId, repoId: r.repoId, relPath: r.relPath }),
      id: r.id,
      sessionId: r.sessionId,
      provider: r.provider,
      timestamp: toIso(r.timestamp),
      path: r.path,
      operation: r.operation,
      addedLineFps: fps.filter((f) => f.side === "added").map((f) => f.fp),
      removedLineFps: fps.filter((f) => f.side === "removed").map((f) => f.fp),
      addedLineCountRaw: r.addedLineCountRaw,
      removedLineCountRaw: r.removedLineCountRaw,
      sourceRef: { file: r.sourceFile, offset: r.sourceOffset, parserVersion: r.parserVersion },
    });
  });
}

/** Distinct files a session's patches touched. */
export function countSessionChangedFiles(db: LandedDb, sessionId: string): number {
  const row = db
    .select({ n: countDistinct(agentPatches.path) })
    .from(agentPatches)
    .where(eq(agentPatches.sessionId, sessionId))
    .get();
  return row?.n ?? 0;
}

/** See deleteEventsBySourceFile. Fingerprint rows go with their patches (cascade). */
export function deletePatchesBySourceFile(db: LandedDb, sourceFile: string): number {
  return db.delete(agentPatches).where(eq(agentPatches.sourceFile, sourceFile)).run().changes;
}
