import { existsSync, type FSWatcher, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { HookSignal } from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import {
  getRepo,
  getSessionByProviderId,
  insertEvents,
  type LandedDb,
  listPatches,
  listSessions,
} from "@landed/db";
import { THREAD_INDEX_FILE } from "@landed/importer-codex";
import { detectCollisions } from "@landed/loops";
import { analyze } from "./analyze";
import { claudeImporter, defaultClaudeProjectsRoot } from "./claude";
import { codexImporter, defaultCodexSessionsRoot } from "./codex";
import { computeOutcomes } from "./outcomes";
import { importSource, refreshSessionAggregates, type SourceImporter } from "./pipeline";

export interface LiveEvent {
  type: "import" | "analysis" | "notice";
  at: string;
  detail?: Record<string, unknown>;
}

/**
 * A desktop-worthy moment. Built from metadata only: repo names, file paths, titles. The fields
 * let each surface word it in the user's language; `title` and `message` are the English default.
 */
export interface Notice {
  kind: "awaiting-user" | "collision";
  key: string;
  title: string;
  message: string;
  sessionId?: string;
  repo?: string;
  /** awaiting-user: the session's title, when known. */
  sessionTitle?: string;
  /** collision: the repo-relative file both sessions edited. */
  relPath?: string;
}

export interface LiveOptions {
  db: LandedDb;
  fingerprinter: LineFingerprinter;
  claudeRoot?: string;
  codexRoot?: string;
  onEvent?: (e: LiveEvent) => void;
  notify?: (n: Notice) => void;
  /** Wait this long after the last file change before importing (ms). */
  importDebounceMs?: number;
  /** Recompute outcomes once agents have been quiet this long (ms). */
  analysisQuietMs?: number;
  /** …and at least this often regardless, to catch commits made by hand (ms). */
  analysisIntervalMs?: number;
  now?: () => number;
}

export interface LiveCollector {
  start(): void;
  stop(): void;
  /** Mark a source file as changed (watchers and hooks call this). */
  touch(path: string): void;
  /** Import everything touched so far, now. */
  flush(): Promise<void>;
  runAnalysis(): Promise<void>;
  /** Apply a live hook signal: import its transcript now, then record its events. */
  recordHook(signal: HookSignal): Promise<void>;
  /** Run `fn` with no import or analysis in progress (e.g. a full scan). */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  readonly lastActivityAt: string | undefined;
}

const COLLISION_WINDOW_MS = 60 * 60_000;

/**
 * Near-real-time collection: vendor session files are appended while agents work, so watching them
 * (FSEvents via recursive fs.watch) gives live data without any agent configuration. Imports are
 * debounced and incremental; outcome matching, which reads git, runs when agents go quiet.
 */
export function createLiveCollector(opts: LiveOptions): LiveCollector {
  const now = opts.now ?? Date.now;
  const claudeRoot = opts.claudeRoot ?? defaultClaudeProjectsRoot();
  const codexRoot = opts.codexRoot ?? defaultCodexSessionsRoot();
  const sources: { importer: SourceImporter; root: string; owns: (p: string) => boolean }[] = [
    { importer: claudeImporter, root: claudeRoot, owns: (p) => p.startsWith(`${claudeRoot}/`) },
    {
      importer: codexImporter,
      root: codexRoot,
      owns: (p) =>
        p.startsWith(`${codexRoot}/`) ||
        p.startsWith(`${join(dirname(codexRoot), "archived_sessions")}/`) ||
        p === join(dirname(codexRoot), THREAD_INDEX_FILE),
    },
  ];
  const pending = new Set<string>();
  const watchers: FSWatcher[] = [];
  const notified = new Set<string>();
  let importTimer: NodeJS.Timeout | undefined;
  let quietTimer: NodeJS.Timeout | undefined;
  let intervalTimer: NodeJS.Timeout | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let lastActivityAt: string | undefined;
  let started = false;

  const emit = (type: LiveEvent["type"], detail?: Record<string, unknown>) =>
    opts.onEvent?.({ type, at: new Date(now()).toISOString(), ...(detail ? { detail } : {}) });

  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const notices = (): Notice[] => {
    const out: Notice[] = [];
    const recent = listSessions(opts.db, {
      activeFrom: new Date(now() - COLLISION_WINDOW_MS).toISOString(),
      limit: 10_000,
    });
    const repoName = (id?: string) =>
      id ? basename(getRepo(opts.db, id)?.rootPath ?? "") || undefined : undefined;
    for (const s of recent) {
      if (s.status !== "awaiting-user") continue;
      const repo = repoName(s.repoId);
      out.push({
        kind: "awaiting-user",
        key: `awaiting-user:${s.id}:${s.lastEventAt}`,
        title: "An agent is waiting for you",
        message: `${s.title ?? "A session"} in ${repo ?? "a repo"} needs your answer or approval.`,
        sessionId: s.id,
        ...(repo ? { repo } : {}),
        ...(s.title ? { sessionTitle: s.title } : {}),
      });
    }
    const ids = new Set(recent.map((s) => s.id));
    const patches = listPatches(opts.db).filter(
      (p) => ids.has(p.sessionId) && Date.parse(p.timestamp) >= now() - COLLISION_WINDOW_MS,
    );
    for (const c of detectCollisions({ sessions: recent, patches, outcomes: [] })) {
      if (c.kind !== "concurrent-edit" && c.kind !== "overwrite") continue;
      const repo = repoName(c.repoId);
      out.push({
        kind: "collision",
        key: `collision:${c.key}`,
        title: "Two agents are editing the same file",
        message: `${c.relPath} in ${repo ?? "a repo"} was edited by two sessions within an hour.`,
        sessionId: c.sessionB,
        relPath: c.relPath,
        ...(repo ? { repo } : {}),
      });
    }
    return out;
  };

  const raiseNotices = (silent: boolean) => {
    for (const n of notices()) {
      if (notified.has(n.key)) continue;
      notified.add(n.key);
      if (silent) continue;
      opts.notify?.(n);
      emit("notice", {
        kind: n.kind,
        title: n.title,
        message: n.message,
        ...(n.sessionId ? { sessionId: n.sessionId } : {}),
        ...(n.repo ? { repo: n.repo } : {}),
        ...(n.sessionTitle ? { sessionTitle: n.sessionTitle } : {}),
        ...(n.relPath ? { relPath: n.relPath } : {}),
      });
    }
  };

  /** Imports pending files; call only inside exclusive(). Returns files read. */
  const importPending = async (): Promise<number> => {
    if (pending.size === 0) return 0;
    const batch = new Set(pending);
    pending.clear();
    let events = 0;
    let files = 0;
    for (const src of sources) {
      const mine = new Set([...batch].filter(src.owns));
      if (mine.size === 0) continue;
      const r = await importSource(src.importer, {
        db: opts.db,
        fingerprinter: opts.fingerprinter,
        root: src.root,
        onlyPaths: mine,
        now,
      });
      events += r.events.inserted;
      files += r.filesRead;
    }
    if (files > 0) {
      lastActivityAt = new Date(now()).toISOString();
      emit("import", { files, events });
    }
    return files;
  };

  const flush = () =>
    exclusive(async () => {
      if ((await importPending()) === 0) return;
      raiseNotices(false);
      scheduleAnalysis();
    });

  const recordHook = (signal: HookSignal) =>
    exclusive(async () => {
      if (signal.transcriptPath && sources.some((s) => s.owns(signal.transcriptPath as string)))
        pending.add(signal.transcriptPath);
      await importPending();
      const session = getSessionByProviderId(opts.db, signal.provider, signal.providerSessionId);
      if (session && signal.events.length > 0) {
        insertEvents(opts.db, session.id, signal.events);
        refreshSessionAggregates(opts.db, session.id, now());
        lastActivityAt = new Date(now()).toISOString();
        emit("import", { hook: signal.hookEvent, sessionId: session.id });
      }
      raiseNotices(false);
      scheduleAnalysis();
    });

  const runAnalysis = () =>
    exclusive(async () => {
      const outcomes = await computeOutcomes({
        db: opts.db,
        fingerprinter: opts.fingerprinter,
        now,
      });
      const analysis = analyze(opts.db, now());
      emit("analysis", {
        openLoops: analysis.openLoops,
        collisions: analysis.collisions,
        reposFailed: outcomes.reposFailed,
      });
    });

  const scheduleAnalysis = () => {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => void runAnalysis(), opts.analysisQuietMs ?? 120_000);
    quietTimer.unref?.();
  };

  const touch = (path: string) => {
    if (!path.endsWith(".jsonl") || !sources.some((s) => s.owns(path))) return;
    pending.add(path);
    if (importTimer) clearTimeout(importTimer);
    importTimer = setTimeout(() => void flush(), opts.importDebounceMs ?? 1500);
    importTimer.unref?.();
  };

  const attach = (dir: string, recursive: boolean, filter?: (name: string) => boolean) => {
    if (!existsSync(dir)) return;
    try {
      watchers.push(
        watch(dir, { recursive, persistent: true }, (_event, name) => {
          if (!name) return;
          const file = String(name);
          if (filter && !filter(file)) return;
          touch(join(dir, file));
        }),
      );
    } catch {
      // Watching is best effort; periodic analysis and manual scans still work.
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      raiseNotices(true); // history is not news
      attach(claudeRoot, true);
      attach(codexRoot, true);
      attach(join(dirname(codexRoot), "archived_sessions"), false);
      attach(dirname(codexRoot), false, (name) => name === THREAD_INDEX_FILE);
      intervalTimer = setInterval(() => void runAnalysis(), opts.analysisIntervalMs ?? 600_000);
      intervalTimer.unref?.();
    },
    stop() {
      for (const w of watchers.splice(0)) w.close();
      for (const t of [importTimer, quietTimer]) if (t) clearTimeout(t);
      if (intervalTimer) clearInterval(intervalTimer);
      started = false;
    },
    touch,
    flush,
    recordHook,
    runAnalysis,
    exclusive,
    get lastActivityAt() {
      return lastActivityAt;
    },
  };
}
