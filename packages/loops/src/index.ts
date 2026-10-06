import type {
  AgentPatch,
  AgentSession,
  Collision,
  OpenLoop,
  Outcome,
  WorkThread,
} from "@landed/core";
import { newUlid } from "@landed/shared";

export const LOOP_RULES = {
  uncommittedAfterMs: 24 * 3600_000,
  unmergedAfterMs: 7 * 24 * 3600_000,
  awaitingAfterMs: 30 * 60_000,
  failedAfterMs: 3600_000,
  lostWorkMinLines: 20,
  /** Uncommitted output or an unmerged branch smaller than this is not worth a loop. */
  minLines: 10,
  concurrentWindowMs: 60 * 60_000,
  overwriteWindowMs: 7 * 24 * 3600_000,
};

/**
 * Repo-relative directories whose files never raise output loops: reports and plans agents write
 * for you to read (`output/`, `.planning/`), not to commit. Editable in Settings.
 */
export const DEFAULT_LOOP_IGNORE_PATHS = ["output/", ".planning/"];

/** Normalizes user input to `dir/` prefixes: relative, no `..`, trailing slash. */
export function normalizeIgnorePaths(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of paths) {
    const p = raw.trim().replace(/^\.\//, "").replace(/\/+$/, "");
    if (!p || p.startsWith("/") || p.split("/").includes("..")) continue;
    out.add(`${p}/`);
  }
  return [...out];
}

export const isUnderIgnoredPath = (relPath: string | undefined, prefixes: readonly string[]) =>
  relPath !== undefined && prefixes.some((p) => relPath.startsWith(p));

export type OpenLoopDraft = OpenLoop & { key: string };
export type CollisionDraft = Collision & { key: string };

export interface LoopInputs {
  sessions: readonly AgentSession[];
  threads: readonly WorkThread[];
  patches: readonly AgentPatch[];
  /** Session-file outcomes. */
  outcomes: readonly Outcome[];
  nowMs: number;
  /** Directory prefixes excluded from output loops (default DEFAULT_LOOP_IGNORE_PATHS). */
  ignorePaths?: readonly string[];
}

/** Deterministic open-loop detectors (PRD §13). Each loop has a stable key so dismissals stick. */
export function detectOpenLoops(input: LoopInputs): OpenLoopDraft[] {
  const { nowMs } = input;
  const threadOf = new Map<string, WorkThread>();
  for (const t of input.threads) for (const id of t.sessionIds) threadOf.set(id, t);
  const firstPatch = new Map<string, number>();
  for (const p of input.patches) {
    const k = `${p.sessionId}\u0000${p.relPath ?? ""}`;
    const t = Date.parse(p.timestamp);
    if (!firstPatch.has(k) || t < (firstPatch.get(k) as number)) firstPatch.set(k, t);
  }
  const since = (o: Outcome) =>
    firstPatch.get(`${o.sessionId}\u0000${o.relPath ?? ""}`) ?? Date.parse(o.computedAt);
  const groupKey = (o: Outcome) => threadOf.get(o.sessionId)?.id ?? o.sessionId;
  const loops: OpenLoopDraft[] = [];
  const loop = (d: Omit<OpenLoopDraft, "id" | "state">): OpenLoopDraft => ({
    ...d,
    id: newUlid(),
    state: "open",
  });

  // Files under ignored directories (agent reports, plans) raise no output loops.
  const ignore = input.ignorePaths ?? DEFAULT_LOOP_IGNORE_PATHS;
  const outcomes = input.outcomes.filter((o) => !isUnderIgnoredPath(o.relPath, ignore));
  const grouped = (pred: (o: Outcome) => boolean) => {
    const m = new Map<string, Outcome[]>();
    for (const o of outcomes) if (pred(o)) m.set(groupKey(o), [...(m.get(groupKey(o)) ?? []), o]);
    return m;
  };
  const common = (key: string, items: Outcome[]) => {
    const thread =
      threadOf.get(items[0]?.sessionId ?? "") ?? input.threads.find((t) => t.id === key);
    const repoId = items[0]?.repoId;
    return {
      ...(repoId ? { repoId } : {}),
      ...(thread ? { threadId: thread.id } : {}),
      sessionIds: [...new Set(items.map((o) => o.sessionId))],
      thread,
    };
  };

  for (const [key, items] of grouped((o) => o.class === "uncommitted")) {
    const start = Math.min(...items.map(since));
    if (nowMs - start < LOOP_RULES.uncommittedAfterMs) continue;
    if (items.reduce((n, o) => n + o.lineCount, 0) < LOOP_RULES.minLines) continue;
    const { thread: _t, ...c } = common(key, items);
    loops.push(
      loop({
        key: `uncommitted-output:${key}`,
        type: "uncommitted-output",
        ...c,
        since: new Date(start).toISOString(),
        size: { files: items.length, lines: items.reduce((n, o) => n + o.lineCount, 0) },
        evidence: { files: items.map((o) => o.relPath).slice(0, 20) },
        provenance: "derived",
      }),
    );
  }

  // Unmerged work is grouped by repo and branch: one loop per branch the agents left behind. The
  // branch git says contains the commit wins over the session's own record, which is missing when
  // an agent edits a repo from outside it (e.g. a subagent started in a scratch folder).
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const unmerged = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    if (o.class !== "landed" || o.fracOnDefaultBranch !== 0) continue;
    const s = sessionById.get(o.sessionId);
    const branch =
      o.firstCommit?.branch ??
      s?.gitBranchEnd ??
      s?.gitBranchStart ??
      threadOf.get(o.sessionId)?.branch;
    const k = `${o.repoId ?? ""}\u0000${branch ?? `thread:${groupKey(o)}`}`;
    unmerged.set(k, [...(unmerged.get(k) ?? []), o]);
  }
  for (const [k, items] of unmerged) {
    const [repoId, branch] = k.split("\u0000") as [string, string];
    const sessionIds = [...new Set(items.map((o) => o.sessionId))];
    const last = Math.max(
      ...sessionIds.map((id) => Date.parse(sessionById.get(id)?.lastEventAt ?? "0")),
    );
    if (nowMs - last < LOOP_RULES.unmergedAfterMs) continue;
    if (items.reduce((n, o) => n + o.lineCount, 0) < LOOP_RULES.minLines) continue;
    const commits = [...new Set(items.map((o) => o.firstCommit?.sha).filter(Boolean))] as string[];
    const named = !branch.startsWith("thread:");
    loops.push(
      loop({
        key: `unmerged-agent-branch:${repoId}:${branch}`,
        type: "unmerged-agent-branch",
        ...(repoId ? { repoId } : {}),
        sessionIds,
        since: new Date(Math.min(...items.map(since))).toISOString(),
        size: {
          files: items.length,
          lines: items.reduce((n, o) => n + o.lineCount, 0),
          commits: commits.length,
        },
        evidence: {
          commits: commits.slice(0, 10),
          ...(named ? { branch } : {}),
          lastActivityAt: new Date(last).toISOString(),
        },
        provenance: "derived",
      }),
    );
  }

  for (const [key, items] of grouped((o) => o.class === "lost" || o.class === "landed")) {
    if (items.some((o) => o.class === "landed")) continue;
    const lines = items.reduce((n, o) => n + o.lineCount, 0);
    if (lines < LOOP_RULES.lostWorkMinLines) continue;
    const { thread: _t, ...c } = common(key, items);
    loops.push(
      loop({
        key: `lost-work:${key}`,
        type: "lost-work",
        ...c,
        since: new Date(Math.min(...items.map(since))).toISOString(),
        size: { files: items.length, lines },
        evidence: { files: items.map((o) => o.relPath).slice(0, 20) },
        provenance: "derived",
      }),
    );
  }

  const landedSessions = new Set(
    input.outcomes.filter((o) => o.class === "landed").map((o) => o.sessionId),
  );
  for (const s of input.sessions) {
    const thread = threadOf.get(s.id);
    const last = Date.parse(s.lastEventAt);
    const later = thread
      ? thread.sessionIds.filter(
          (id) =>
            id !== s.id &&
            Date.parse(input.sessions.find((x) => x.id === id)?.startedAt ?? "") > last,
        )
      : [];
    const base = {
      ...(s.repoId ? { repoId: s.repoId } : {}),
      ...(thread ? { threadId: thread.id } : {}),
      sessionIds: [s.id],
      since: s.lastEventAt,
      size: {},
    };
    if (
      s.status === "awaiting-user" &&
      later.length === 0 &&
      nowMs - last >= LOOP_RULES.awaitingAfterMs
    ) {
      loops.push(
        loop({
          key: `awaiting-user:${s.id}`,
          type: "awaiting-user",
          ...base,
          evidence: { status: s.status },
          provenance: "inferred",
        }),
      );
    }
    if (
      (s.status === "failed" || s.status === "interrupted") &&
      nowMs - last >= LOOP_RULES.failedAfterMs &&
      !s.parentSessionId
    ) {
      if (later.some((id) => landedSessions.has(id))) continue;
      loops.push(
        loop({
          key: `failed-unresolved:${s.id}`,
          type: "failed-unresolved",
          ...base,
          evidence: { status: s.status },
          provenance: "derived",
        }),
      );
    }
  }
  return loops;
}

/**
 * Retrospective collisions (PRD §15). `concurrent-edit`: two unrelated sessions that were running
 * at the same time edited the same file within an hour; one session finishing before the other
 * starts is a handoff, not a collision. `overwrite`: a later session removed lines an earlier one
 * added that had not landed. Parent/subagent pairs are never collisions.
 */
export function detectCollisions(
  input: Pick<LoopInputs, "sessions" | "patches" | "outcomes">,
): CollisionDraft[] {
  const parentOf = new Map(input.sessions.map((s) => [s.id, s.parentSessionId]));
  const related = (a: string, b: string) =>
    parentOf.get(a) === b ||
    parentOf.get(b) === a ||
    (parentOf.get(a) !== undefined && parentOf.get(a) === parentOf.get(b));
  const span = new Map(
    input.sessions.map((s) => [s.id, [Date.parse(s.startedAt), Date.parse(s.lastEventAt)]]),
  );
  const overlapped = (a: string, b: string) => {
    const [as, ae] = span.get(a) ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    const [bs, be] = span.get(b) ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    return (as as number) <= (be as number) && (bs as number) <= (ae as number);
  };
  const landed = new Set(
    input.outcomes
      .filter((o) => o.class === "landed")
      .map((o) => `${o.sessionId}\u0000${o.relPath}`),
  );
  const byFile = new Map<string, AgentPatch[]>();
  for (const p of input.patches) {
    if (!p.repoId || !p.relPath) continue;
    const k = `${p.repoId}\u0000${p.relPath}`;
    byFile.set(k, [...(byFile.get(k) ?? []), p]);
  }
  const found = new Map<string, CollisionDraft>();
  for (const patches of byFile.values()) {
    const sorted = [...patches].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    for (let j = 0; j < sorted.length; j++) {
      const b = sorted[j] as AgentPatch;
      const tb = Date.parse(b.timestamp);
      const removed = new Set(b.removedLineFps);
      for (let i = j - 1; i >= 0; i--) {
        const a = sorted[i] as AgentPatch;
        const ta = Date.parse(a.timestamp);
        if (tb - ta > LOOP_RULES.overwriteWindowMs) break;
        if (a.sessionId === b.sessionId || related(a.sessionId, b.sessionId)) continue;
        const overwritten = a.addedLineFps.filter((fp) => removed.has(fp)).length;
        const overwrite = overwritten > 0 && !landed.has(`${a.sessionId}\u0000${a.relPath}`);
        const concurrent =
          tb - ta <= LOOP_RULES.concurrentWindowMs && overlapped(a.sessionId, b.sessionId);
        if (!overwrite && !concurrent) continue;
        const kind = overwrite ? "overwrite" : "concurrent-edit";
        const key = `${kind}:${b.repoId}:${b.relPath}:${a.sessionId}:${b.sessionId}`;
        const prev = found.get(key);
        if (prev) {
          prev.window.start = new Date(Math.min(Date.parse(prev.window.start), ta)).toISOString();
          continue;
        }
        if (
          kind === "concurrent-edit" &&
          found.has(`overwrite:${b.repoId}:${b.relPath}:${a.sessionId}:${b.sessionId}`)
        )
          continue;
        found.set(key, {
          key,
          id: newUlid(tb),
          repoId: b.repoId as string,
          relPath: b.relPath as string,
          sessionA: a.sessionId,
          sessionB: b.sessionId,
          kind,
          window: { start: new Date(ta).toISOString(), end: new Date(tb).toISOString() },
          evidence: overwrite
            ? { overwrittenLines: overwritten }
            : { minutesApart: Math.round((tb - ta) / 60_000) },
          provenance: "derived",
        });
      }
    }
  }
  // An overwrite supersedes a concurrent-edit for the same pair and file.
  for (const k of [...found.keys()]) {
    if (k.startsWith("concurrent-edit:") && found.has(k.replace("concurrent-edit:", "overwrite:")))
      found.delete(k);
  }
  return [...found.values()];
}
