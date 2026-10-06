import { basename } from "node:path";
import {
  buildDailyBrief,
  buildRetroReport,
  categoryOf,
  describeLoop,
  loopLabel,
} from "@landed/brief";
import {
  AgentProviderSchema,
  type AgentSession,
  type NormalizedEvent,
  type OpenLoop,
  type Outcome,
  type OutcomeClass,
} from "@landed/core";
import {
  getSession,
  getSetting,
  getThread,
  type LandedDb,
  latestSessionEvents,
  listCollisions,
  listInsights,
  listOpenLoops,
  listOutcomes,
  listPatches,
  listRepos,
  listSessions,
  listThreads,
  outcomeDistribution,
  type RepoRow,
} from "@landed/db";

/** Read models for the API and CLI. Everything returned is observed or derived local data. */

export function repoNames(db: LandedDb): Map<string, string> {
  const repos = listRepos(db);
  const counts = new Map<string, number>();
  for (const r of repos)
    counts.set(basename(r.rootPath), (counts.get(basename(r.rootPath)) ?? 0) + 1);
  // Disambiguate equal basenames with their parent directory.
  return new Map(
    repos.map((r) => {
      const name = basename(r.rootPath);
      return [
        r.id,
        (counts.get(name) ?? 0) > 1
          ? `${basename(r.rootPath.slice(0, -name.length - 1))}/${name}`
          : name,
      ];
    }),
  );
}

/** Local-time day boundaries for YYYY-MM-DD (default: today). */
export function dayRange(date?: string): { date: string; from: string; to: string } {
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

const ALL = { limit: 1_000_000 };

export function briefInputs(db: LandedDb, from: string, to: string, date?: string) {
  return {
    ...(date ? { date } : {}),
    from,
    to,
    sessions: listSessions(db, { ...ALL, activeFrom: from, activeTo: to }),
    outcomes: listOutcomes(db, { scope: "session-file" }),
    loops: listOpenLoops(db),
    threads: listThreads(db),
    collisions: listCollisions(db, { since: from }),
    insights: listInsights(db),
    repoNames: repoNames(db),
  };
}

export function todayView(db: LandedDb, date?: string) {
  const range = dayRange(date);
  const brief = buildDailyBrief(briefInputs(db, range.from, range.to, range.date));
  const names = repoNames(db);
  const running = listSessions(db, {
    activeFrom: new Date(Date.now() - LIVE_WINDOW_MS).toISOString(),
    limit: 1000,
  })
    .filter((s) => !s.parentSessionId && isLive(s))
    .map((s) => toListItem(s, names, 0));
  return {
    ...range,
    running,
    brief,
    generated: getSetting<{ date: string; summary: string; attention: string[] }>(
      db,
      `generatedBrief:${range.date}`,
    ),
    lastScan: getSetting<{ at: string; durationMs: number }>(db, "lastScan"),
    totals: { sessions: listSessions(db, { limit: 1 }).length > 0 },
  };
}

/**
 * The home page: what agents did over the last `days` days, in counts a person can read. Files
 * are session × file outcomes of sessions active in the window (subagents included).
 */
export function summaryView(db: LandedDb, days = 7, now = Date.now()) {
  const from = new Date(now - days * 86_400_000).toISOString();
  const names = repoNames(db);
  const active = listSessions(db, { ...ALL, activeFrom: from });
  const ids = new Set(active.map((s) => s.id));
  const files = { landed: 0, waiting: 0, lost: 0 };
  for (const o of listOutcomes(db, { scope: "session-file" })) {
    if (!ids.has(o.sessionId)) continue;
    if (o.class === "landed") files.landed++;
    else if (o.class === "uncommitted" || o.class === "partial") files.waiting++;
    else if (o.class === "lost") files.lost++;
  }
  const topLevel = active.filter((s) => !s.parentSessionId);
  return {
    days,
    sessions: topLevel.length,
    agents: [...new Set(topLevel.map((s) => s.provider))],
    repos: new Set(active.map((s) => s.repoId).filter(Boolean)).size,
    files,
    running: topLevel.filter((s) => isLive(s, now)).map((s) => toListItem(s, names, 0)),
    openLoops: listOpenLoops(db, { state: "open" }).length,
    lastScan: getSetting<{ at: string; durationMs: number }>(db, "lastScan"),
  };
}

export interface SessionListItem {
  id: string;
  provider: AgentSession["provider"];
  title?: string;
  repo?: string;
  repoId?: string;
  startedAt: string;
  lastEventAt: string;
  status: AgentSession["status"];
  eventCount: number;
  failureCount: number;
  changedFileCount: number;
  tokens?: number;
  outcomeSummary?: Record<string, number>;
  subagents: number;
  threadId?: string;
  /** Activity in the last few minutes and no end signal: the agent is probably working now. */
  live: boolean;
}

/** How recent the last event must be for a session to count as running. */
export const LIVE_WINDOW_MS = 10 * 60_000;

export function isLive(
  s: Pick<AgentSession, "lastEventAt" | "endedAt" | "status">,
  now = Date.now(),
): boolean {
  if (s.endedAt && s.endedAt >= s.lastEventAt) return false;
  return (
    now - Date.parse(s.lastEventAt) < LIVE_WINDOW_MS &&
    s.status !== "failed" &&
    s.status !== "interrupted"
  );
}

export function sessionsView(
  db: LandedDb,
  q: {
    from?: string;
    to?: string;
    provider?: AgentSession["provider"];
    repoId?: string;
    status?: AgentSession["status"];
    limit?: number;
    offset?: number;
    subagents?: boolean;
    /** Only sessions that changed at least one file. */
    withFiles?: boolean;
  },
) {
  const names = repoNames(db);
  const all = listSessions(db, {
    ...(q.from ? { activeFrom: q.from } : {}),
    ...(q.to ? { activeTo: q.to } : {}),
    ...(q.provider ? { provider: q.provider } : {}),
    ...(q.repoId ? { repoId: q.repoId } : {}),
    ...(q.status ? { status: q.status } : {}),
    limit: 1_000_000,
  });
  const subCount = new Map<string, number>();
  for (const s of all)
    if (s.parentSessionId)
      subCount.set(s.parentSessionId, (subCount.get(s.parentSessionId) ?? 0) + 1);
  const visible = all.filter(
    (s) => (q.subagents || !s.parentSessionId) && (!q.withFiles || s.changedFileCount > 0),
  );
  const offset = q.offset ?? 0;
  const items: SessionListItem[] = visible
    .slice(offset, offset + (q.limit ?? 100))
    .map((s) => toListItem(s, names, subCount.get(s.id) ?? 0));
  return { total: visible.length, items };
}

function toListItem(
  s: AgentSession,
  names: Map<string, string>,
  subagents: number,
): SessionListItem {
  const tokens =
    s.inputTokens !== undefined
      ? (s.inputTokens ?? 0) + (s.outputTokens ?? 0) + (s.cachedInputTokens ?? 0)
      : undefined;
  return {
    id: s.id,
    provider: s.provider,
    ...(s.title ? { title: s.title } : {}),
    ...(s.repoId ? { repo: names.get(s.repoId) ?? "unknown", repoId: s.repoId } : {}),
    startedAt: s.startedAt,
    lastEventAt: s.lastEventAt,
    status: s.status,
    eventCount: s.eventCount,
    failureCount: s.failureCount,
    changedFileCount: s.changedFileCount,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(s.outcomeSummary ? { outcomeSummary: s.outcomeSummary } : {}),
    subagents,
    ...(s.threadId ? { threadId: s.threadId } : {}),
    live: isLive(s),
  };
}

export interface TimelineItem {
  at: string;
  type: NormalizedEvent["eventType"];
  label: string;
  detail?: string;
  status?: string;
  count: number;
  provenance: "observed";
}

/** Chronological timeline with consecutive similar events collapsed ("Read 17 files"). */
export function timeline(events: readonly NormalizedEvent[]): TimelineItem[] {
  const shown = events.filter(
    (e) => !e.eventType.endsWith(".started") || e.eventType === "subagent.started",
  );
  const items: TimelineItem[] = [];
  for (const e of shown) {
    const label = labelOf(e);
    const detail = e.command?.display ?? e.file?.path ?? e.error?.code;
    const last = items.at(-1);
    if (
      last &&
      last.type === e.eventType &&
      last.label === label &&
      e.eventType !== "prompt.submitted" &&
      e.eventType !== "turn.completed"
    ) {
      last.count++;
      delete last.detail;
      continue;
    }
    items.push({
      at: e.timestamp,
      type: e.eventType,
      label,
      ...(detail ? { detail } : {}),
      ...(e.status ? { status: e.status } : {}),
      count: 1,
      provenance: "observed",
    });
  }
  return items;
}

function labelOf(e: NormalizedEvent): string {
  switch (e.eventType) {
    case "prompt.submitted":
      return "Prompt";
    case "turn.completed":
      return "Turn completed";
    case "command.completed":
    case "command.failed":
      return e.command?.executable ?? "Command";
    case "edit.applied":
      return e.file?.operation === "create"
        ? "Created file"
        : e.file?.operation === "delete"
          ? "Deleted file"
          : "Edited file";
    case "tool.completed":
    case "tool.failed":
      return e.tool?.name ?? "Tool";
    case "subagent.started":
      return "Subagent started";
    case "subagent.ended":
      return "Subagent finished";
    case "approval.resolved":
      return "Permission denied";
    case "agent.interrupted":
      return "Interrupted";
    case "session.started":
      return "Session started";
    case "session.awaiting-user":
      return "Asked you a question";
    case "error":
      return "Error";
    default:
      return e.providerEventType;
  }
}

export function sessionDetail(db: LandedDb, id: string) {
  const s = getSession(db, id);
  if (!s) return undefined;
  const names = repoNames(db);
  const outcomes = listOutcomes(db, { sessionId: id, scope: "session-file" });
  const byFile = new Map(outcomes.map((o) => [o.relPath ?? "", o]));
  const patches = listPatches(db, { sessionId: id });
  const files = new Map<
    string,
    {
      relPath: string;
      path: string;
      edits: number;
      added: number;
      removed: number;
      outcome?: Outcome;
    }
  >();
  for (const p of patches) {
    const key = p.relPath ?? p.path;
    const f = files.get(key) ?? { relPath: key, path: p.path, edits: 0, added: 0, removed: 0 };
    f.edits++;
    f.added += p.addedLineCountRaw;
    f.removed += p.removedLineCountRaw;
    const o = byFile.get(p.relPath ?? "");
    if (o) f.outcome = o;
    files.set(key, f);
  }
  const events = latestSessionEvents(db, id, 2000).reverse();
  const subagents = listSessions(db, { limit: 1_000_000 }).filter((x) => x.parentSessionId === id);
  return {
    session: toListItem(s, names, subagents.length),
    meta: {
      cwd: s.cwd,
      repoRoot: s.repoRoot,
      gitBranchStart: s.gitBranchStart,
      gitBranchEnd: s.gitBranchEnd,
      model: s.model,
      titleProvenance: s.titleProvenance,
      providerSessionId: s.providerSessionId,
      parentSessionId: s.parentSessionId,
      usageCoverage: s.usageCoverage,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cachedInputTokens: s.cachedInputTokens,
      estimatedCostUsd: s.estimatedCostUsd,
    },
    files: [...files.values()].sort((a, b) => b.added - a.added),
    timeline: timeline(events),
    subagents: subagents.map((x) => toListItem(x, names, 0)),
    insights: listInsights(db, { sessionId: id }),
    thread: s.threadId ? getThread(db, s.threadId) : undefined,
  };
}

/** Minimum outcomes per agent before agents may be compared within a repo (PRD §12.6). */
export const MIN_COMPARISON_SAMPLE = 30;

export function outcomesView(db: LandedDb, days?: number) {
  const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
  const scope = "session-file" as const;
  const providers = AgentProviderSchema.options.filter((p) => p !== "unknown");
  const names = repoNames(db);
  const window = from ? { from } : {};
  // Fit by task type (PRD §12.6, Phase 19): agents compared within a repo AND a file category.
  const providerOf = new Map(listSessions(db, { limit: 1_000_000 }).map((s) => [s.id, s]));
  const fitCells = new Map<string, Map<string, Partial<Record<OutcomeClass, number>>>>(); // repo|category → provider → dist
  for (const o of listOutcomes(db, { scope })) {
    const s = providerOf.get(o.sessionId);
    if (!s || !o.repoId || o.class === "unknown" || (from && s.startedAt < from)) continue;
    const key = `${o.repoId}\u0000${categoryOf(o.relPath ?? "")}`;
    const cell = fitCells.get(key) ?? new Map();
    const d = cell.get(s.provider) ?? {};
    d[o.class] = (d[o.class] ?? 0) + 1;
    cell.set(s.provider, d);
    fitCells.set(key, cell);
  }
  const fitFor = (repoId: string) =>
    [...fitCells]
      .filter(
        ([k, cell]) =>
          k.startsWith(`${repoId}\u0000`) &&
          cell.size > 1 &&
          [...cell.values()].every((d) => total(d) >= MIN_COMPARISON_SAMPLE),
      )
      .map(([k, cell]) => ({
        category: k.split("\u0000")[1] as string,
        agents: [...cell].map(([provider, distribution]) => ({ provider, distribution })),
      }));

  const repos = listRepos(db)
    .map((r: RepoRow) => {
      const perAgent = providers
        .map((provider) => ({
          provider,
          distribution: outcomeDistribution(db, { scope, repoId: r.id, provider, ...window }),
        }))
        .filter((a) => total(a.distribution) > 0);
      // Agents are compared only inside one repo, and only with enough outcomes each (PRD §12.6).
      const comparable =
        perAgent.length > 1 &&
        perAgent.every((a) => total(a.distribution) >= MIN_COMPARISON_SAMPLE);
      return {
        repoId: r.id,
        repo: names.get(r.id) ?? r.rootPath,
        missing: r.missing,
        confidence: r.outcomeConfidence ?? undefined,
        controlA: r.outcomeControlA ?? undefined,
        controlB: r.outcomeControlB ?? undefined,
        distribution: outcomeDistribution(db, { scope, repoId: r.id, ...window }),
        agents: perAgent.map((a) => a.provider),
        comparison: comparable ? perAgent : undefined,
        fit: fitFor(r.id),
      };
    })
    .filter((r) => total(r.distribution) > 0)
    .sort((a, b) => total(b.distribution) - total(a.distribution));
  const all = listOutcomes(db, { scope });
  const sessionsById = new Map(listSessions(db, { limit: 1_000_000 }).map((s) => [s.id, s]));
  const inRange = all.filter(
    (o) => !from || (sessionsById.get(o.sessionId)?.startedAt ?? "") >= from,
  );
  const overall: Partial<Record<OutcomeClass, number>> = {};
  const survival: Record<string, number> = {};
  const lags: number[] = [];
  for (const o of inRange) {
    overall[o.class] = (overall[o.class] ?? 0) + 1;
    if (o.class !== "landed") continue;
    survival[o.survival] = (survival[o.survival] ?? 0) + 1;
    if (o.commitLagSeconds !== undefined) lags.push(o.commitLagSeconds);
  }
  lags.sort((a, b) => a - b);
  const unknownReasons: Record<string, number> = {};
  for (const o of listOutcomes(db, { scope: "patch", class: "unknown" }))
    unknownReasons[o.unknownReason ?? "?"] = (unknownReasons[o.unknownReason ?? "?"] ?? 0) + 1;
  return {
    days: days ?? null,
    overall,
    repos,
    survival,
    commitLagHours: lags.length
      ? {
          median: (lags[Math.floor(lags.length / 2)] as number) / 3600,
          p90: (lags[Math.floor(lags.length * 0.9)] as number) / 3600,
        }
      : null,
    unknownReasons,
    minComparisonSample: MIN_COMPARISON_SAMPLE,
    comparisonCaveat: "Differences may reflect how you used each agent, not agent capability.",
  };
}

const total = (d: Partial<Record<OutcomeClass, number>>) =>
  Object.values(d).reduce((n, v) => n + (v ?? 0), 0);

export function loopsView(db: LandedDb, state?: OpenLoop["state"]) {
  const names = repoNames(db);
  const repos = new Map(listRepos(db).map((r) => [r.id, r]));
  return listOpenLoops(db, state ? { state } : {})
    .map((l) => {
      const repo = l.repoId ? names.get(l.repoId) : undefined;
      const row = l.repoId ? repos.get(l.repoId) : undefined;
      return {
        ...l,
        ...(repo ? { repo } : {}),
        // For the dashboard's "copy command" action (local UI; the API is loopback-only).
        ...(row ? { repoRoot: row.rootPath } : {}),
        ...(row?.defaultBranch ? { defaultBranch: row.defaultBranch } : {}),
        label: loopLabel(l.type),
        description: describeLoop({ ...l, ...(repo ? { repo } : {}) }),
      };
    })
    .sort((a, b) => (b.size.lines ?? 0) - (a.size.lines ?? 0));
}

export function threadsView(db: LandedDb, status?: string) {
  const names = repoNames(db);
  const outcomes = listOutcomes(db, { scope: "session-file" });
  const bySession = new Map<string, Outcome[]>();
  for (const o of outcomes) bySession.set(o.sessionId, [...(bySession.get(o.sessionId) ?? []), o]);
  return listThreads(db, status ? { status: status as never } : {}).map((t) => {
    const mix: Partial<Record<OutcomeClass, number>> = {};
    for (const id of t.sessionIds)
      for (const o of bySession.get(id) ?? [])
        if (o.class !== "unknown") mix[o.class] = (mix[o.class] ?? 0) + 1;
    return { ...t, repo: names.get(t.repoId) ?? "unknown", outcomeMix: mix };
  });
}

export function threadDetail(db: LandedDb, id: string) {
  const t = getThread(db, id);
  if (!t) return undefined;
  const names = repoNames(db);
  const sessions = t.sessionIds
    .map((sid) => getSession(db, sid))
    .filter((s): s is AgentSession => !!s)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const outcomes = t.sessionIds.flatMap((sid) =>
    listOutcomes(db, { sessionId: sid, scope: "session-file" }),
  );
  return {
    thread: { ...t, repo: names.get(t.repoId) ?? "unknown" },
    sessions: sessions.map((s) => toListItem(s, names, 0)),
    outcomes,
    loops: loopsView(db).filter((l) => l.threadId === id),
  };
}

export function reportView(db: LandedDb, days: number, includeNames: boolean) {
  return buildRetroReport({
    periodDays: days,
    nowMs: Date.now(),
    sessions: listSessions(db, { limit: 1_000_000 }),
    outcomes: listOutcomes(db, { scope: "session-file" }),
    loops: listOpenLoops(db),
    threads: listThreads(db),
    collisions: listCollisions(db),
    repoNames: repoNames(db),
    includeNames,
  });
}
