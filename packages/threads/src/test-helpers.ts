import type { AgentPatch, AgentSession, Outcome } from "@landed/core";

let n = 0;
const ulid = () => `01K6F${String(++n).padStart(21, "0")}`;
export const HOUR = 3600_000;
export const T0 = Date.parse("2026-09-01T00:00:00.000Z");
export const iso = (h: number) => new Date(T0 + h * HOUR).toISOString();

export function session(
  o: Partial<AgentSession> & { startH: number; endH?: number },
): AgentSession {
  const { startH, endH, ...rest } = o;
  return {
    id: ulid(),
    provider: "codex",
    providerSessionId: `p${n}`,
    startedAt: iso(startH),
    lastEventAt: iso(endH ?? startH + 1),
    status: "completed",
    eventCount: 1,
    failureCount: 0,
    changedFileCount: 1,
    sourceFiles: ["/x"],
    repoId: "01K6FREP00000000000000000A",
    ...rest,
  };
}

export function patch(
  s: AgentSession,
  relPath: string,
  added: string[],
  removed: string[] = [],
  atH?: number,
): AgentPatch {
  return {
    id: ulid(),
    sessionId: s.id,
    provider: s.provider,
    timestamp: atH === undefined ? s.startedAt : iso(atH),
    path: `/r/${relPath}`,
    repoId: s.repoId ?? "01K6FREP00000000000000000A",
    relPath,
    operation: "modify",
    addedLineFps: added,
    removedLineFps: removed,
    addedLineCountRaw: added.length,
    removedLineCountRaw: removed.length,
    sourceRef: { file: "/x", offset: 0, parserVersion: "t" },
  };
}

export function outcome(
  s: AgentSession,
  relPath: string,
  cls: Outcome["class"],
  extra: Partial<Outcome> = {},
): Outcome {
  const landed = cls === "landed";
  return {
    id: ulid(),
    scope: "session-file",
    sessionId: s.id,
    repoId: s.repoId ?? "01K6FREP00000000000000000A",
    relPath,
    class: cls,
    ...(cls === "unknown" ? { unknownReason: "no-signal" as const } : {}),
    survival: landed ? "surviving" : "unknown",
    fracCommitted: landed ? 1 : 0,
    fracOnDefaultBranch: landed ? 1 : 0,
    fracInWorkingTree: cls === "uncommitted" ? 1 : 0,
    ...(landed
      ? { firstCommit: { sha: "abc1234", time: s.lastEventAt, subject: "feat: retries" } }
      : {}),
    lineCount: 30,
    provenance: "derived",
    computedAt: iso(1000),
    engineVersion: "outcomes@1",
    ...extra,
  };
}
