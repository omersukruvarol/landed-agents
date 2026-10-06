import { statSync } from "node:fs";
import { basename } from "node:path";
import type {
  AgentPatch,
  AgentProvider,
  AgentSession,
  ParsedChunk,
  SessionFacts,
  SourceFileParser,
} from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import {
  countSessionChangedFiles,
  countSessionEvents,
  deleteEventsBySourceFile,
  deletePatchesBySourceFile,
  findEventOwners,
  findIdlessEventOwners,
  findPatchOwners,
  findUsageOwners,
  getCheckpoint,
  getSession,
  getSessionByProviderId,
  insertEvents,
  insertPatches,
  insertUsageRecords,
  type LandedDb,
  latestSessionEvents,
  markSourceScanned,
  recordIngestionFailure,
  type SessionInput,
  saveCheckpoint,
  sessionEventSpan,
  sessionUsageTotals,
  upsertRepo,
  upsertSession,
  upsertSource,
} from "@landed/db";
import { newUlid } from "@landed/shared";
import { planRead } from "./checkpoint";
import { streamCompleteLines } from "./read-lines";
import { createRepoResolver, type RepoResolver, relativeToRoot } from "./repo-resolver";
import { deriveSessionStatus } from "./status";

/** What the pipeline needs from a vendor importer package. */
export interface SourceImporter {
  provider: AgentProvider;
  parserVersion: string;
  listFiles(root: string): { path: string }[];
  createParser(ctx: {
    sourceFile: string;
    fingerprinter: LineFingerprinter;
    receivedAt: string;
  }): SourceFileParser;
}

export interface ImportOptions {
  db: LandedDb;
  fingerprinter: LineFingerprinter;
  /** The vendor's history root, e.g. ~/.claude/projects. */
  root: string;
  /** Live mode: import only these files (absolute paths); others are left for a later pass. */
  onlyPaths?: ReadonlySet<string>;
  now?: () => number;
}

export interface Counts {
  inserted: number;
  duplicates: number;
}

export interface ImportReport {
  provider: AgentProvider;
  filesSeen: number;
  filesRead: number;
  filesUnchanged: number;
  filesReset: number;
  /** Files whose chunk could not be stored; retried on the next scan. */
  filesFailed: number;
  linesRead: number;
  sessionsTouched: number;
  events: Counts;
  patches: Counts;
  usageRecords: Counts;
  failures: number;
  /** Events whose session could not be created (no timestamped line yet). */
  eventsWithoutSession: number;
  /** History a vendor copied into a resumed/forked session, skipped because another session owns it. */
  copiedFromOtherSessions: { events: number; patches: number; usage: number };
  unknownTypes: Record<string, number>;
}

/**
 * Imports one vendor source incrementally. Each file is parsed outside the transaction (streaming,
 * async) and then persisted together with its checkpoint in a single transaction, so a crash never
 * leaves a file half-imported.
 */
export async function importSource(
  importer: SourceImporter,
  opts: ImportOptions,
): Promise<ImportReport> {
  const { db, fingerprinter, root } = opts;
  const now = opts.now ?? Date.now;
  const report: ImportReport = {
    provider: importer.provider,
    filesSeen: 0,
    filesRead: 0,
    filesUnchanged: 0,
    filesReset: 0,
    filesFailed: 0,
    linesRead: 0,
    sessionsTouched: 0,
    events: { inserted: 0, duplicates: 0 },
    patches: { inserted: 0, duplicates: 0 },
    usageRecords: { inserted: 0, duplicates: 0 },
    failures: 0,
    eventsWithoutSession: 0,
    copiedFromOtherSessions: { events: 0, patches: 0, usage: 0 },
    unknownTypes: {},
  };
  const source = upsertSource(db, { provider: importer.provider, rootPath: root }, now());
  const resolver = createRepoResolver();

  const files = importer
    .listFiles(root)
    .filter((f) => !opts.onlyPaths || opts.onlyPaths.has(f.path));
  for (const file of files) {
    report.filesSeen++;
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(file.path);
    } catch {
      continue; // deleted between listing and reading
    }
    const state = { inode: st.ino, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    const plan = planRead(getCheckpoint(db, file.path), state, importer.parserVersion);
    if (plan.action === "skip") {
      report.filesUnchanged++;
      continue;
    }
    const receivedAt = new Date(now()).toISOString();
    const parser = importer.createParser({ sourceFile: file.path, fingerprinter, receivedAt });
    let lines = 0;
    const endOffset = await streamCompleteLines(file.path, plan.from, st.size, {
      onLine: (text, offset) => {
        lines++;
        parser.push(text, offset);
      },
      ...(parser.skipLine ? { skipLine: parser.skipLine.bind(parser) } : {}),
      onSkip: () => {
        lines++;
      },
    });
    const parsed = parser.finish();

    try {
      db.transaction(() => {
        if (plan.reset) {
          deleteEventsBySourceFile(db, file.path);
          deletePatchesBySourceFile(db, file.path);
        }
        persistChunk(db, importer.provider, parsed, resolver, now(), report);
        saveCheckpoint(
          db,
          {
            sourceId: source.id,
            path: file.path,
            ...state,
            byteOffset: endOffset,
            parserVersion: importer.parserVersion,
          },
          now(),
        );
      });
    } catch (error) {
      // One bad file must not stop the scan. Nothing from it was kept and its checkpoint did not
      // move, so the next scan retries it. The message names the failing field, never content.
      recordIngestionFailure(
        db,
        {
          provider: importer.provider,
          sourceFile: file.path,
          offset: plan.from,
          parserVersion: importer.parserVersion,
          reasonCode: "persist-error",
          message: describeError(error),
        },
        now(),
      );
      report.filesFailed++;
      continue;
    }
    if (plan.reset) report.filesReset++;
    report.filesRead++;
    report.linesRead += lines;
    for (const [type, n] of Object.entries(parsed.stats.unknownTypes)) {
      report.unknownTypes[type] = (report.unknownTypes[type] ?? 0) + n;
    }
  }
  markSourceScanned(db, source.id, now());
  return report;
}

function persistChunk(
  db: LandedDb,
  provider: AgentProvider,
  parsed: ParsedChunk,
  resolver: RepoResolver,
  now: number,
  report: ImportReport,
): void {
  const sessions = new Map<string, AgentSession>();
  for (const facts of parsed.sessions) {
    const s = mergeSession(db, facts, resolver, now);
    if (s) sessions.set(facts.providerSessionId, s);
  }

  const copies = copiedHistory(db, provider, parsed);
  report.copiedFromOtherSessions.events += copies.events.size;
  report.copiedFromOtherSessions.patches += copies.patches.size;
  report.copiedFromOtherSessions.usage += copies.usage.size;

  const eventsBySession = groupBy(
    parsed.events.filter((e) => !copies.events.has(e)),
    (e) => e.sessionId,
  );
  for (const [psid, events] of eventsBySession) {
    const s = sessions.get(psid) ?? getSessionByProviderId(db, provider, psid);
    if (!s) {
      report.eventsWithoutSession += events.length;
      continue;
    }
    sessions.set(psid, s);
    add(report.events, insertEvents(db, s.id, events));
  }

  const patches: AgentPatch[] = [];
  for (const p of parsed.patches) {
    if (copies.patches.has(p)) continue;
    const s = sessions.get(p.providerSessionId);
    if (!s) continue;
    const root =
      resolver.rootFor(p.path) ??
      (s.repoRoot && relativeToRoot(s.repoRoot, p.path) ? s.repoRoot : undefined);
    const repoId = root ? upsertRepo(db, { rootPath: root }, now).id : undefined;
    const relPath = root ? relativeToRoot(root, p.path) : undefined;
    const { providerSessionId: _psid, ...rest } = p;
    patches.push({
      ...rest,
      id: newUlid(Date.parse(p.timestamp)),
      sessionId: s.id,
      provider,
      ...(repoId && relPath ? { repoId, relPath } : {}),
    });
  }
  add(report.patches, insertPatches(db, patches));

  for (const [psid, usage] of groupBy(
    parsed.usage.filter((u) => !copies.usage.has(u)),
    (u) => u.providerSessionId,
  )) {
    const s = sessions.get(psid);
    if (!s) continue;
    add(
      report.usageRecords,
      insertUsageRecords(
        db,
        s.id,
        usage.map(({ providerSessionId: _p, ...u }) => u),
      ),
    );
  }

  for (const f of parsed.failures) {
    if (
      recordIngestionFailure(
        db,
        {
          provider,
          sourceFile: f.sourceFile,
          offset: f.offset,
          parserVersion: parsedVersionOf(f, parsed),
          reasonCode: f.reasonCode,
          ...(f.message ? { message: f.message } : {}),
        },
        now,
      )
    ) {
      report.failures++;
    }
  }

  for (const s of sessions.values()) refreshSessionAggregates(db, s.id, now);
  report.sessionsTouched += sessions.size;
}

/**
 * Finds drafts that duplicate activity owned by a different session. Vendors copy conversation
 * history into resumed or forked sessions with the original line, tool-call and message ids; that
 * history belongs to the session where it happened — the one imported first, since importers list
 * files oldest first. Within one chunk, the first session to show an id owns it.
 */
function copiedHistory(db: LandedDb, provider: AgentProvider, parsed: ParsedChunk) {
  const sessionIds = new Map<string, string | undefined>();
  const internalId = (psid: string) => {
    if (!sessionIds.has(psid)) sessionIds.set(psid, getSessionByProviderId(db, provider, psid)?.id);
    return sessionIds.get(psid);
  };
  /** key → internal ids of sessions that already store it. */
  const stored = new Map<string, Set<string>>();
  const remember = (key: string, sessionId: string) => {
    const set = stored.get(key);
    if (set) set.add(sessionId);
    else stored.set(key, new Set([sessionId]));
  };
  const chunkOwner = new Map<string, string>();
  /** True when `key` belongs to a session other than `psid`. */
  const isCopy = (key: string, psid: string) => {
    const owners = stored.get(key);
    const own = internalId(psid);
    if (owners && (own === undefined || !owners.has(own))) return true;
    const first = chunkOwner.get(key);
    if (first !== undefined && first !== psid) return true;
    chunkOwner.set(key, psid);
    return false;
  };

  const eventKey = (id: string, type: string, callId: string | null | undefined) =>
    `e\u0000${id}\u0000${type}\u0000${callId ?? ""}`;
  const eventIds = parsed.events.flatMap((e) => (e.providerEventId ? [e.providerEventId] : []));
  for (const o of findEventOwners(db, provider, eventIds))
    remember(eventKey(o.providerEventId, o.eventType, o.toolCallId), o.sessionId);
  const patchKey = (callId: string, path: string) => `p\u0000${callId}\u0000${path}`;
  const callIds = parsed.patches.flatMap((p) => (p.toolCallId ? [p.toolCallId] : []));
  for (const o of findPatchOwners(db, provider, callIds))
    remember(patchKey(o.toolCallId, o.path), o.sessionId);
  const usageKey = (key: string) => `u\u0000${key}`;
  for (const o of findUsageOwners(
    db,
    provider,
    parsed.usage.map((u) => u.usageKey),
  ))
    remember(usageKey(o.usageKey), o.sessionId);

  // Events without a vendor id fall back to their exact time and types.
  const idlessKey = (ts: number, providerType: string, type: string) =>
    `t\u0000${ts}\u0000${providerType}\u0000${type}`;
  const idless = parsed.events.filter((e) => !e.providerEventId);
  for (const o of findIdlessEventOwners(
    db,
    provider,
    idless.map((e) => Date.parse(e.timestamp)),
  )) {
    remember(idlessKey(o.timestamp, o.providerEventType, o.eventType), o.sessionId);
  }
  const events = new Set(
    parsed.events.filter((e) =>
      e.providerEventId
        ? isCopy(eventKey(e.providerEventId, e.eventType, e.tool?.callId), e.sessionId)
        : isCopy(idlessKey(Date.parse(e.timestamp), e.providerEventType, e.eventType), e.sessionId),
    ),
  );
  const patches = new Set(
    parsed.patches.filter(
      (p) => p.toolCallId && isCopy(patchKey(p.toolCallId, p.path), p.providerSessionId),
    ),
  );
  const usage = new Set(
    parsed.usage.filter((u) => isCopy(usageKey(u.usageKey), u.providerSessionId)),
  );
  return { events, patches, usage };
}

/** Failures don't carry a parser version; take it from any source ref in the same chunk. */
function parsedVersionOf(_f: { sourceFile: string }, parsed: ParsedChunk): string {
  return (
    parsed.events[0]?.sourceRef?.parserVersion ??
    parsed.patches[0]?.sourceRef.parserVersion ??
    "unknown"
  );
}

/** Folds one pass's facts into the stored session. Returns undefined if it cannot exist yet. */
function mergeSession(
  db: LandedDb,
  f: SessionFacts,
  resolver: RepoResolver,
  now: number,
): AgentSession | undefined {
  const existing = getSessionByProviderId(db, f.provider, f.providerSessionId);
  const startedAt = minIso(existing?.startedAt, f.firstEventAt);
  const lastEventAt = maxIso(existing?.lastEventAt, f.lastEventAt);
  if (!startedAt || !lastEventAt) return existing;

  const cwd = existing?.cwd ?? f.cwd;
  const repoRoot = existing?.repoRoot ?? (cwd ? resolver.rootFor(cwd) : undefined);
  const repoId = repoRoot ? upsertRepo(db, { rootPath: repoRoot }, now).id : existing?.repoId;
  const parent = f.parentProviderSessionId
    ? getSessionByProviderId(db, f.provider, f.parentProviderSessionId)?.id
    : undefined;
  const newer = !existing || (f.lastEventAt !== undefined && f.lastEventAt >= existing.lastEventAt);
  // An observed (user-set) title is never replaced by a generated one.
  const keepTitle = existing?.titleProvenance === "observed" && f.titleProvenance !== "observed";
  const title = keepTitle ? existing?.title : (f.title ?? existing?.title);
  const titleProvenance = keepTitle
    ? existing?.titleProvenance
    : (f.titleProvenance ?? existing?.titleProvenance);

  const input: SessionInput = {
    provider: f.provider,
    providerSessionId: f.providerSessionId,
    startedAt,
    lastEventAt,
    status: existing?.status ?? "unknown",
    eventCount: existing?.eventCount ?? 0,
    failureCount: existing?.failureCount ?? 0,
    changedFileCount: existing?.changedFileCount ?? 0,
    // Title-only facts (e.g. a vendor's thread-name index) are not a source of the session.
    sourceFiles: [
      ...new Set([...(existing?.sourceFiles ?? []), ...(f.firstEventAt ? [f.sourceFile] : [])]),
    ],
    ...defined({
      parentSessionId: parent ?? existing?.parentSessionId,
      cwd,
      repoId,
      repoRoot,
      projectName:
        existing?.projectName ??
        (nonEmpty(basename(repoRoot ?? "")) || nonEmpty(basename(cwd ?? ""))),
      gitBranchStart: existing?.gitBranchStart ?? f.gitBranchFirst,
      gitBranchEnd:
        (newer ? f.gitBranchLast : undefined) ?? existing?.gitBranchEnd ?? f.gitBranchLast,
      model: f.model ?? existing?.model,
      title,
      titleProvenance,
      estimatedCostUsd: f.estimatedCostUsd ?? existing?.estimatedCostUsd,
      inputTokens: existing?.inputTokens,
      outputTokens: existing?.outputTokens,
      cachedInputTokens: existing?.cachedInputTokens,
      reasoningTokens: existing?.reasoningTokens,
      usageCoverage: existing?.usageCoverage,
    }),
  };
  return upsertSession(db, input, now);
}

/** Recomputes counts, usage, span, end and status from what is stored — the source of truth. */
export function refreshSessionAggregates(db: LandedDb, sessionId: string, now: number): void {
  const s = getSession(db, sessionId);
  if (!s) return;
  const { id: _id, threadId: _t, endedAt: _e, ...rest } = s;
  const counts = countSessionEvents(db, sessionId);
  const usage = sessionUsageTotals(db, sessionId);
  // Stored events define the session's span; copied history (skipped above) must not stretch it.
  const span = sessionEventSpan(db, sessionId);
  const times = span
    ? {
        startedAt: new Date(span.first).toISOString(),
        lastEventAt: new Date(span.last).toISOString(),
      }
    : {};
  const latest = latestSessionEvents(db, sessionId);
  // A session-end signal (a live hook) sets endedAt, unless activity resumed after it.
  const ended = latest.find((e) => e.eventType === "session.ended");
  const endedAt =
    ended && latest[0] && latest[0].timestamp <= ended.timestamp
      ? { endedAt: ended.timestamp }
      : {};
  const tokens =
    usage.records > 0
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          reasoningTokens: usage.reasoningTokens,
          usageCoverage: "complete" as const,
        }
      : { usageCoverage: "none" as const };
  upsertSession(
    db,
    {
      ...rest,
      ...tokens,
      ...times,
      ...endedAt,
      eventCount: counts.events,
      failureCount: counts.failures,
      changedFileCount: countSessionChangedFiles(db, sessionId),
      status: deriveSessionStatus(latest),
    },
    now,
  );
}

function defined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function nonEmpty(s: string): string | undefined {
  return s === "" ? undefined : s;
}

/** Error kind plus the first schema path, if any — no values, so no content can leak. */
function describeError(error: unknown): string {
  if (error instanceof Error && "issues" in error && Array.isArray(error.issues)) {
    const path = (error.issues[0] as { path?: unknown[] } | undefined)?.path?.join(".") ?? "";
    return `validation:${path}`;
  }
  return error instanceof Error ? error.name : "unknown";
}

function minIso(a?: string, b?: string): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxIso(a?: string, b?: string): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function add(target: Counts, r: Counts): void {
  target.inserted += r.inserted;
  target.duplicates += r.duplicates;
}
