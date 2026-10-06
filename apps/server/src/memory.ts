import { realpathSync } from "node:fs";
import { basename, isAbsolute, relative } from "node:path";
import { agentName, describeLoop, loopLabel } from "@landed/brief";
import {
  type AgentSession,
  type Outcome,
  type OutcomeClass,
  redactSecrets,
  type WorkThread,
} from "@landed/core";
import {
  failureGroups,
  getSession,
  getSetting,
  getThread,
  type LandedDb,
  listOpenLoops,
  listOutcomes,
  listPatches,
  listRepos,
  listSessions,
  listThreads,
  type RepoRow,
} from "@landed/db";
import { isLive, LIVE_WINDOW_MS, repoNames } from "./views";

/**
 * Agent memory (PRD v0.3, Phase 20): read models an agent can query through MCP. Everything here
 * is stored metadata — titles, branches, repo-relative paths, commit subjects and sanitized
 * commands. Landed never stores prompts or code, so none can be returned.
 */

const ALL = 1_000_000;
const day = 86_400_000;
const at = (iso: string) => iso.slice(0, 16).replace("T", " ");
const short = (sha: string) => sha.slice(0, 7);

export class MemoryError extends Error {}

// ── Repo resolution ─────────────────────────────────────────────────────────────────────

/**
 * A repo from an absolute path anywhere inside it, or from its display name. Without a reference,
 * the caller's working directory is used (agents start MCP servers in their project).
 */
export function resolveRepo(db: LandedDb, ref: string | undefined, cwd: string): RepoRow {
  const repos = listRepos(db);
  const target = ref?.trim() || cwd;
  if (isAbsolute(target)) {
    const candidates = [target];
    try {
      candidates.push(realpathSync(target));
    } catch {}
    const match = repos
      .filter((r) =>
        candidates.some(
          (c) => c === r.rootPath || c.startsWith(`${r.rootPath.replace(/\/$/, "")}/`),
        ),
      )
      .sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
    if (match) return match;
    throw new MemoryError(
      `Landed has no agent history for ${target}. Pass \`repo\` as the absolute path of a git repository agents have worked in.`,
    );
  }
  const names = repoNames(db);
  const byName = repos.filter((r) => names.get(r.id) === target || basename(r.rootPath) === target);
  if (byName.length === 1) return byName[0] as RepoRow;
  throw new MemoryError(
    byName.length > 1
      ? `More than one repo is named "${target}". Pass \`repo\` as an absolute path.`
      : `Landed knows no repo named "${target}". Pass \`repo\` as an absolute path.`,
  );
}

/** Repo-relative form of a path the agent passed (absolute inside the repo, or already relative). */
export function toRelPath(repo: RepoRow, path: string): string {
  const p = isAbsolute(path) ? relative(repo.rootPath, path) : path;
  return p.replace(/^\.\//, "").replace(/\/+$/, "");
}

const underPath = (relPath: string, filter: string) =>
  filter === "" || relPath === filter || relPath.startsWith(`${filter}/`);

function repoLabel(db: LandedDb, repo: RepoRow): string {
  return repoNames(db).get(repo.id) ?? basename(repo.rootPath);
}

// ── Shared shapes ───────────────────────────────────────────────────────────────────────

interface FileWork {
  path: string;
  edits: number;
  lastEditAt: string;
  outcome?: OutcomeClass;
  commit?: { sha: string; subject?: string };
}

/** Files a session (and its subagents) edited, with each file's outcome. */
function sessionFiles(db: LandedDb, sessionIds: readonly string[]): FileWork[] {
  const outcomes = new Map<string, Outcome>();
  for (const id of sessionIds)
    for (const o of listOutcomes(db, { sessionId: id, scope: "session-file" }))
      if (o.relPath) outcomes.set(o.relPath, o);
  const files = new Map<string, FileWork>();
  for (const id of sessionIds) {
    for (const p of listPatches(db, { sessionId: id })) {
      if (!p.relPath) continue;
      const f = files.get(p.relPath) ?? { path: p.relPath, edits: 0, lastEditAt: p.timestamp };
      f.edits++;
      if (p.timestamp > f.lastEditAt) f.lastEditAt = p.timestamp;
      const o = outcomes.get(p.relPath);
      if (o) {
        f.outcome = o.class;
        if (o.firstCommit)
          f.commit = {
            sha: short(o.firstCommit.sha),
            ...(o.firstCommit.subject ? { subject: o.firstCommit.subject } : {}),
          };
      }
      files.set(p.relPath, f);
    }
  }
  return [...files.values()].sort((a, b) => b.lastEditAt.localeCompare(a.lastEditAt));
}

/** Top-level sessions with their subagents folded in. */
function withSubagents(sessions: readonly AgentSession[]): Map<AgentSession, string[]> {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const groups = new Map<AgentSession, string[]>();
  for (const s of sessions) {
    const parent = s.parentSessionId ? byId.get(s.parentSessionId) : undefined;
    const root = parent ?? s;
    groups.set(root, [...(groups.get(root) ?? []), s.id]);
  }
  return groups;
}

const branchOf = (s: AgentSession) => s.gitBranchEnd ?? s.gitBranchStart;

/** The newest activity Landed has seen: the last scan, or a later session event (live mode). */
function dataAsOf(db: LandedDb): string | undefined {
  const scan = getSetting<{ at?: string }>(db, "lastScan")?.at;
  const since = scan ?? new Date(Date.now() - day).toISOString();
  const newest = listSessions(db, { activeFrom: since, limit: ALL })
    .map((s) => s.lastEventAt)
    .sort()
    .at(-1);
  return [scan, newest]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
}

// ── recent_work ─────────────────────────────────────────────────────────────────────────

export function recentWork(
  db: LandedDb,
  repo: RepoRow,
  opts: { path?: string; days?: number; limit?: number; now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 7;
  const filter = opts.path ? toRelPath(repo, opts.path) : undefined;
  const sessions = listSessions(db, {
    repoId: repo.id,
    activeFrom: new Date(now - days * day).toISOString(),
    limit: ALL,
  });
  const items = [];
  for (const [s, ids] of withSubagents(sessions)) {
    const all = sessionFiles(db, ids);
    const files = filter === undefined ? all : all.filter((f) => underPath(f.path, filter));
    if (filter !== undefined && files.length === 0) continue;
    items.push({
      sessionId: s.id,
      agent: agentName(s.provider),
      ...(s.title ? { title: s.title } : {}),
      ...(branchOf(s) ? { branch: branchOf(s) } : {}),
      startedAt: s.startedAt,
      lastActivityAt: s.lastEventAt,
      running: isLive(s, now),
      status: s.status,
      ...(s.threadId ? { threadId: s.threadId } : {}),
      files: files.slice(0, 25),
      ...(files.length > 25 ? { moreFiles: files.length - 25 } : {}),
    });
  }
  items.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const limit = opts.limit ?? 20;
  return {
    repo: repoLabel(db, repo),
    ...(filter !== undefined ? { path: filter } : {}),
    days,
    sessions: items.slice(0, limit),
    ...(items.length > limit ? { moreSessions: items.length - limit } : {}),
    dataAsOf: dataAsOf(db),
    note: "outcome per file: landed = in a commit, uncommitted = only in the working tree, partial = some lines, lost = not found in git or the working tree.",
  };
}

// ── open_loops ──────────────────────────────────────────────────────────────────────────

export function openLoopsFor(db: LandedDb, repo: RepoRow) {
  const name = repoLabel(db, repo);
  const loops = listOpenLoops(db, { state: "open", repoId: repo.id })
    .map((l) => ({
      loopId: l.id,
      kind: loopLabel(l.type),
      description: describeLoop({ ...l, repo: name }),
      since: l.since,
      size: l.size,
      ...(l.threadId ? { threadId: l.threadId } : {}),
      sessionIds: l.sessionIds,
      provenance: l.provenance,
    }))
    .sort((a, b) => b.since.localeCompare(a.since));
  return {
    repo: name,
    openLoops: loops,
    dataAsOf: dataAsOf(db),
    note: "Open loops are agent work left dangling. Call resume_packet with a threadId for details.",
  };
}

// ── active_sessions ─────────────────────────────────────────────────────────────────────

export function activeSessions(
  db: LandedDb,
  repo: RepoRow,
  opts: { paths?: readonly string[]; now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const wanted = (opts.paths ?? []).map((p) => toRelPath(repo, p));
  const sessions = listSessions(db, {
    repoId: repo.id,
    activeFrom: new Date(now - LIVE_WINDOW_MS).toISOString(),
    limit: ALL,
  }).filter((s) => isLive(s, now));
  const items = [...withSubagents(sessions)].map(([s, ids]) => {
    const files = sessionFiles(db, ids);
    const overlap = files.map((f) => f.path).filter((f) => wanted.some((w) => underPath(f, w)));
    return {
      sessionId: s.id,
      agent: agentName(s.provider),
      ...(s.title ? { title: s.title } : {}),
      ...(branchOf(s) ? { branch: branchOf(s) } : {}),
      status: s.status,
      startedAt: s.startedAt,
      lastActivityAt: s.lastEventAt,
      editing: files.slice(0, 25).map((f) => f.path),
      ...(wanted.length ? { overlapsWithYourPaths: overlap } : {}),
    };
  });
  return {
    repo: repoLabel(db, repo),
    activeSessions: items,
    ...(wanted.length
      ? { conflicts: items.filter((i) => (i.overlapsWithYourPaths?.length ?? 0) > 0).length }
      : {}),
    note: `Sessions with activity in the last ${LIVE_WINDOW_MS / 60_000} minutes. Your own session may be listed.`,
    dataAsOf: dataAsOf(db),
  };
}

// ── prior_attempts ──────────────────────────────────────────────────────────────────────

const STOP = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "fix", "add"]);

export function queryTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_.-]+/u)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length >= 3);
  const useful = terms.filter((t) => !STOP.has(t));
  return [...new Set(useful.length ? useful : terms)];
}

interface Attempt {
  thread: WorkThread;
  sessions: AgentSession[];
  outcomes: Outcome[];
  failures: { command: string; count: number; lastAt: string }[];
}

function verdict(mix: Partial<Record<OutcomeClass, number>>): string {
  const n = (c: OutcomeClass) => mix[c] ?? 0;
  if (!n("landed") && !n("uncommitted") && !n("partial") && !n("lost"))
    return "No file edits recorded";
  if (n("landed") && !n("lost") && !n("uncommitted") && !n("partial")) return "Landed";
  if (n("landed")) return "Partly landed";
  if (n("uncommitted") || n("partial")) return "Left uncommitted";
  return "Did not land: the edits are in neither git history nor the working tree";
}

export function priorAttempts(
  db: LandedDb,
  repo: RepoRow | undefined,
  query: string,
  opts: { limit?: number } = {},
) {
  const terms = queryTerms(query);
  if (!terms.length) throw new MemoryError("Give a query of at least one word (3+ characters).");
  const names = repoNames(db);
  const threads = listThreads(db, repo ? { repoId: repo.id, limit: ALL } : { limit: ALL });
  const sessions = new Map(
    listSessions(db, { ...(repo ? { repoId: repo.id } : {}), limit: ALL }).map((s) => [s.id, s]),
  );
  const outcomes = new Map<string, Outcome[]>();
  for (const o of listOutcomes(db, { scope: "session-file", ...(repo ? { repoId: repo.id } : {}) }))
    outcomes.set(o.sessionId, [...(outcomes.get(o.sessionId) ?? []), o]);
  const failures = new Map<string, Attempt["failures"]>();
  for (const f of failureGroups(db, 1, { sessionIds: [...sessions.keys()] }))
    failures.set(f.sessionId, [
      ...(failures.get(f.sessionId) ?? []),
      { command: f.signature, count: f.count, lastAt: f.lastAt },
    ]);

  const scored = threads
    .map((thread) => {
      const members = thread.sessionIds
        .map((id) => sessions.get(id))
        .filter((s): s is AgentSession => !!s);
      const a: Attempt = {
        thread,
        sessions: members,
        outcomes: thread.sessionIds.flatMap((id) => outcomes.get(id) ?? []),
        failures: thread.sessionIds.flatMap((id) => failures.get(id) ?? []),
      };
      const fields: [string, number, string[]][] = [
        ["title", 3, [thread.title, ...members.map((s) => s.title ?? "")]],
        ["branch", 3, [thread.branch ?? "", ...members.map((s) => branchOf(s) ?? "")]],
        ["commit", 2, a.outcomes.map((o) => o.firstCommit?.subject ?? "")],
        ["file", 2, a.outcomes.map((o) => o.relPath ?? "")],
        ["failure", 1, a.failures.map((f) => f.command)],
      ];
      let score = 0;
      let matched = 0;
      const on = new Set<string>();
      for (const t of terms) {
        const hit = fields.find(([, , values]) => values.some((v) => v.toLowerCase().includes(t)));
        if (!hit) continue;
        matched++;
        score += hit[1];
        on.add(hit[0]);
      }
      return { a, score, matched, on };
    })
    .filter((x) => x.matched >= Math.max(1, Math.ceil(terms.length / 2)))
    .sort(
      (x, y) =>
        y.matched - x.matched ||
        y.score - x.score ||
        y.a.thread.lastActivityAt.localeCompare(x.a.thread.lastActivityAt),
    );

  const limit = opts.limit ?? 10;
  return {
    query,
    terms,
    ...(repo ? { repo: names.get(repo.id) ?? basename(repo.rootPath) } : {}),
    attempts: scored.slice(0, limit).map(({ a, on }) => {
      const mix: Partial<Record<OutcomeClass, number>> = {};
      for (const o of a.outcomes) if (o.class !== "unknown") mix[o.class] = (mix[o.class] ?? 0) + 1;
      const commits = new Map<string, string | undefined>();
      for (const o of a.outcomes)
        if (o.firstCommit) commits.set(short(o.firstCommit.sha), o.firstCommit.subject);
      return {
        threadId: a.thread.id,
        title: a.thread.title,
        repo: names.get(a.thread.repoId) ?? "unknown",
        ...(a.thread.branch ? { branch: a.thread.branch } : {}),
        agents: a.thread.providers.map(agentName),
        sessions: a.thread.sessionIds.length,
        startedAt: a.thread.startedAt,
        lastActivityAt: a.thread.lastActivityAt,
        status: a.thread.status,
        result: verdict(mix),
        outcomeMix: mix,
        landedCommits: [...commits]
          .slice(0, 5)
          .map(([sha, subject]) => ({ sha, ...(subject ? { subject } : {}) })),
        notLanded: a.outcomes
          .filter((o) => o.class === "lost" || o.class === "partial" || o.class === "uncommitted")
          .slice(0, 10)
          .map((o) => ({ path: o.relPath, outcome: o.class })),
        failedCommands: a.failures
          .sort((x, y) => y.count - x.count)
          .slice(0, 5)
          .map((f) => ({ command: f.command, failures: f.count, lastAt: f.lastAt })),
        matchedOn: [...on],
      };
    }),
    ...(scored.length > limit ? { moreAttempts: scored.length - limit } : {}),
    note: "Matched against thread and session titles, branches, file paths, commit subjects and failed commands. Landed never stores prompts or code, so it cannot search what was asked or written.",
  };
}

// ── resume_packet ───────────────────────────────────────────────────────────────────────

/** The most recent thread in a repo with recorded edits (on a branch, when given). */
export function latestThread(db: LandedDb, repo: RepoRow, branch?: string): WorkThread | undefined {
  const edited = new Set(
    listOutcomes(db, { repoId: repo.id, scope: "session-file" }).map((o) => o.sessionId),
  );
  return listThreads(db, { repoId: repo.id, limit: ALL }).find(
    (t) => t.sessionIds.some((id) => edited.has(id)) && (!branch || t.branch === branch),
  );
}

/**
 * A handoff for continuing a Work Thread in any agent: what happened, what landed, what is still
 * open, and what failed last. Built from stored metadata only.
 */
export function resumePacket(db: LandedDb, threadId: string) {
  const t = getThread(db, threadId);
  if (!t) return undefined;
  const repo = repoNames(db).get(t.repoId) ?? "unknown";
  const members = t.sessionIds
    .map((id) => getSession(db, id))
    .filter((s): s is AgentSession => !!s)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const steps = [...withSubagents(members)].map(([s, ids]) => {
    const files = sessionFiles(db, ids);
    const mix: Partial<Record<OutcomeClass, number>> = {};
    for (const f of files) if (f.outcome) mix[f.outcome] = (mix[f.outcome] ?? 0) + 1;
    return { session: s, files, mix };
  });
  const latest = new Map<string, FileWork>(); // newest state per file across the thread
  for (const step of steps) for (const f of step.files) latest.set(f.path, f);
  const files = [...latest.values()];
  const byClass = (c: OutcomeClass) => files.filter((f) => f.outcome === c).map((f) => f.path);
  const commits = new Map<string, string | undefined>();
  for (const f of files) if (f.commit) commits.set(f.commit.sha, f.commit.subject);
  const failures = failureGroups(db, 1, { sessionIds: t.sessionIds })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, 5);
  const loops = listOpenLoops(db, { state: "open" }).filter((l) => l.threadId === t.id);

  const packet = {
    threadId: t.id,
    title: t.title,
    repo,
    ...(t.branch ? { branch: t.branch } : {}),
    status: t.status,
    agents: t.providers.map(agentName),
    startedAt: t.startedAt,
    lastActivityAt: t.lastActivityAt,
    sessions: steps.map(({ session: s, files: f, mix }) => ({
      sessionId: s.id,
      agent: agentName(s.provider),
      ...(s.title ? { title: s.title } : {}),
      startedAt: s.startedAt,
      lastActivityAt: s.lastEventAt,
      filesEdited: f.length,
      outcomeMix: mix,
    })),
    landedCommits: [...commits].map(([sha, subject]) => ({ sha, ...(subject ? { subject } : {}) })),
    uncommitted: byClass("uncommitted"),
    partial: byClass("partial"),
    lost: byClass("lost"),
    recentFailures: failures.map((f) => ({
      command: f.signature,
      failures: f.count,
      lastAt: f.lastAt,
    })),
    openLoops: loops.map((l) => describeLoop({ ...l, repo })),
  };
  return { ...packet, text: renderResumePacket(packet) };
}

interface Packet {
  title: string;
  repo: string;
  branch?: string;
  status: string;
  agents: string[];
  startedAt: string;
  lastActivityAt: string;
  sessions: {
    agent: string;
    title?: string;
    startedAt: string;
    filesEdited: number;
    outcomeMix: Partial<Record<OutcomeClass, number>>;
  }[];
  landedCommits: { sha: string; subject?: string }[];
  uncommitted: string[];
  partial: string[];
  lost: string[];
  recentFailures: { command: string; failures: number; lastAt: string }[];
  openLoops: string[];
}

function renderResumePacket(p: Packet): string {
  const list = (paths: string[], max = 15) => [
    ...paths.slice(0, max).map((x) => `  - ${x}`),
    ...(paths.length > max ? [`  - … and ${paths.length - max} more`] : []),
  ];
  const lines = [
    `Resume: "${p.title}" in ${p.repo}${p.branch ? ` (branch ${p.branch})` : ""}`,
    `${p.sessions.length} earlier session(s) by ${p.agents.join(" and ")}, ${at(p.startedAt)} → ${at(p.lastActivityAt)} UTC. Thread status: ${p.status}.`,
    "",
    "What happened:",
    ...p.sessions.map((s) => {
      const mix = Object.entries(s.outcomeMix)
        .map(([c, n]) => `${n} ${c}`)
        .join(", ");
      return `- ${at(s.startedAt)} ${s.agent}${s.title ? `: ${s.title}` : ""} — ${s.filesEdited ? `${s.filesEdited} file(s) edited${mix ? ` (${mix})` : ""}` : "no file edits"}`;
    }),
  ];
  if (p.landedCommits.length)
    lines.push(
      "",
      "Landed in commits:",
      ...p.landedCommits.slice(0, 10).map((c) => `  - ${c.sha}${c.subject ? ` ${c.subject}` : ""}`),
    );
  if (p.uncommitted.length || p.partial.length || p.lost.length) {
    lines.push("", "Still open:");
    if (p.uncommitted.length)
      lines.push("- Uncommitted (only in the working tree):", ...list(p.uncommitted));
    if (p.partial.length) lines.push("- Partly committed:", ...list(p.partial));
    if (p.lost.length)
      lines.push("- Lost (edits found in neither git nor the working tree):", ...list(p.lost));
  }
  if (p.recentFailures.length)
    lines.push(
      "",
      "Recent failures:",
      ...p.recentFailures.map(
        (f) => `  - ${f.command} failed ${f.failures}× (last ${at(f.lastAt)} UTC)`,
      ),
    );
  if (p.openLoops.length) lines.push("", "Open loops:", ...p.openLoops.map((l) => `  - ${l}`));
  lines.push(
    "",
    "Check `git status` and review the files above before continuing. This summary comes from Landed's metadata; it contains no code or prompts.",
  );
  return lines.join("\n");
}

/** Plain-text handoff (the dashboard's "Copy resume context"). */
export function resumeContext(db: LandedDb, threadId: string): string | undefined {
  return resumePacket(db, threadId)?.text;
}

// ── Privacy filter ──────────────────────────────────────────────────────────────────────

const MAX_STRING = 500;
/** Rendered text (a resume packet) is longer by design; it is still redacted. */
const MAX_TEXT = 20_000;

/**
 * Applied to everything the MCP server returns (PRD Phase 20): stored strings were redacted when
 * written, and are redacted again here as defense in depth, home directories are shown as ~,
 * and strings are capped in length.
 */
const HOME_DIR = /(^|[\s"'`=:(,[])\/(?:Users|home)\/[^/\s"'`]+/g;

export function privacyFilter<T>(value: T, max = MAX_STRING): T {
  if (typeof value === "string") {
    // Commands can carry absolute paths; the home directory (and so the user name) becomes ~.
    const text = redactSecrets(value).text.replace(HOME_DIR, "$1~");
    return (text.length > max ? `${text.slice(0, max)}…` : text) as T;
  }
  if (Array.isArray(value)) return value.map((v) => privacyFilter(v, max)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, privacyFilter(v, k === "text" ? MAX_TEXT : max)]),
    ) as T;
  return value;
}
