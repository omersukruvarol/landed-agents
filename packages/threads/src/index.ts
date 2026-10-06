import type {
  AgentPatch,
  AgentProvider,
  AgentSession,
  Outcome,
  Provenance,
  ThreadLinkEvidence,
  ThreadStatus,
  WorkThread,
} from "@landed/core";

export const THREAD_RULES = {
  maxGapMs: 72 * 3600_000,
  /** Non-continuation links never stretch a thread beyond this span. */
  maxThreadSpanMs: 7 * 24 * 3600_000,
  /** A branch used across a longer span is a working trunk, not a unit of work. */
  trunkBranchSpanMs: 14 * 24 * 3600_000,
  fileJaccard: 0.3,
  activeWindowMs: 2 * 3600_000,
  abandonedAfterMs: 14 * 24 * 3600_000,
};

export interface ThreadInputs {
  sessions: readonly AgentSession[];
  patches: readonly AgentPatch[];
  /** Session-file outcomes. */
  outcomes: readonly Outcome[];
  /** repoId → default branch name (e.g. "main" or "origin/main"), when known. */
  defaultBranches: ReadonlyMap<string, string | undefined>;
  nowMs: number;
}

interface Work {
  files: Set<string>;
  added: Set<string>;
  removed: Set<string>;
}

/**
 * Reconstructs units of work across sessions and agents (PRD §14). A session joins the thread of
 * the most recent earlier session in the same repo (within 72 h) that it shares a feature branch
 * with, whose added lines it edits, or whose files it overlaps (Jaccard ≥ 0.3). Subagents always
 * join their parent. Default and trunk-like branches (used for over 14 days) never link sessions,
 * and no thread grows beyond 7 days except through subagents. Every link records why.
 */
export function buildThreads(input: ThreadInputs): WorkThread[] {
  const work = new Map<string, Work>();
  for (const p of input.patches) {
    if (!p.relPath) continue;
    const w = work.get(p.sessionId) ?? { files: new Set(), added: new Set(), removed: new Set() };
    w.files.add(p.relPath);
    for (const fp of p.addedLineFps) w.added.add(fp);
    for (const fp of p.removedLineFps) w.removed.add(fp);
    work.set(p.sessionId, w);
  }
  const byId = new Map(input.sessions.map((s) => [s.id, s]));
  const repoOf = (s: AgentSession): string | undefined =>
    s.repoId ?? (s.parentSessionId ? byId.get(s.parentSessionId)?.repoId : undefined);
  const sessions = input.sessions
    .filter((s) => repoOf(s))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  const branchSpan = new Map<string, { min: number; max: number }>();
  for (const s of sessions) {
    for (const b of [s.gitBranchStart, s.gitBranchEnd]) {
      if (!b) continue;
      const k = `${repoOf(s)}\u0000${b}`;
      const span = branchSpan.get(k) ?? { min: Number.POSITIVE_INFINITY, max: 0 };
      span.min = Math.min(span.min, Date.parse(s.startedAt));
      span.max = Math.max(span.max, Date.parse(s.lastEventAt));
      branchSpan.set(k, span);
    }
  }
  const isWorkBranch = (repo: string, b: string | undefined): b is string => {
    if (!b || b === "HEAD") return false;
    const def = input.defaultBranches.get(repo);
    if (b === def || b === def?.replace(/^origin\//, "")) return false;
    const span = branchSpan.get(`${repo}\u0000${b}`);
    return !(span && span.max - span.min > THREAD_RULES.trunkBranchSpanMs);
  };

  const parent = new Map<string, string>(); // union-find
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root)
      root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  const threadStart = new Map<string, number>(); // root → earliest member start
  const evidence = new Map<string, ThreadLinkEvidence[]>(); // keyed by member session
  const link = (
    from: string,
    to: string,
    kind: ThreadLinkEvidence["kind"],
    detail?: Record<string, unknown>,
  ) => {
    const a = find(from);
    const b = find(to);
    if (a !== b) {
      parent.set(b, a);
      threadStart.set(
        a,
        Math.min(
          threadStart.get(a) ?? Number.POSITIVE_INFINITY,
          threadStart.get(b) ?? Number.POSITIVE_INFINITY,
        ),
      );
    }
    evidence.set(to, [
      ...(evidence.get(to) ?? []),
      { kind, fromSessionId: from, toSessionId: to, ...(detail ? { detail } : {}) },
    ]);
  };

  const recent = new Map<string, AgentSession[]>(); // repo → earlier sessions
  for (const s of sessions) {
    const start = Date.parse(s.startedAt);
    parent.set(s.id, s.id);
    threadStart.set(s.id, start);
    const repo = repoOf(s) as string;
    if (s.parentSessionId && byId.has(s.parentSessionId) && parent.has(s.parentSessionId)) {
      link(s.parentSessionId, s.id, "continuation");
    } else {
      const candidates = (recent.get(repo) ?? [])
        .filter((c) => start - Date.parse(c.lastEventAt) <= THREAD_RULES.maxGapMs)
        .reverse();
      const mine = work.get(s.id);
      for (const c of candidates) {
        if (start - (threadStart.get(find(c.id)) ?? start) > THREAD_RULES.maxThreadSpanMs) continue;
        const reason = linkReason(s, c, mine, work.get(c.id), (b) => isWorkBranch(repo, b));
        if (reason) {
          link(c.id, s.id, reason.kind, reason.detail);
          break;
        }
      }
    }
    recent.set(repo, [...(recent.get(repo) ?? []), s]);
  }

  const groups = new Map<string, AgentSession[]>();
  for (const s of sessions) groups.set(find(s.id), [...(groups.get(find(s.id)) ?? []), s]);
  const outcomesBySession = new Map<string, Outcome[]>();
  for (const o of input.outcomes)
    outcomesBySession.set(o.sessionId, [...(outcomesBySession.get(o.sessionId) ?? []), o]);

  return [...groups.values()].map((members) => {
    const first = members[0] as AgentSession;
    const repoId = repoOf(first) as string;
    const outcomes = members.flatMap((m) => outcomesBySession.get(m.id) ?? []);
    const files = members.flatMap((m) => [...(work.get(m.id)?.files ?? [])]);
    const startedAt = Math.min(...members.map((m) => Date.parse(m.startedAt)));
    const last = Math.max(...members.map((m) => Date.parse(m.lastEventAt)));
    const branch = members
      .map((m) => m.gitBranchEnd ?? m.gitBranchStart)
      .find((b) => isWorkBranch(repoId, b));
    const { title, provenance } = threadTitle(branch, outcomes, files, members);
    return {
      id: first.id,
      repoId,
      sessionIds: members.map((m) => m.id),
      providers: [...new Set(members.map((m) => m.provider))] as AgentProvider[],
      startedAt: new Date(startedAt).toISOString(),
      lastActivityAt: new Date(last).toISOString(),
      title,
      titleProvenance: provenance,
      ...(branch ? { branch } : {}),
      status: threadStatus(outcomes, last, input.nowMs),
      linkEvidence: members.flatMap((m) => evidence.get(m.id) ?? []),
    } satisfies WorkThread;
  });
}

function linkReason(
  s: AgentSession,
  c: AgentSession,
  mine: Work | undefined,
  theirs: Work | undefined,
  isWorkBranch: (b: string | undefined) => boolean,
): { kind: ThreadLinkEvidence["kind"]; detail?: Record<string, unknown> } | undefined {
  const branchesOf = (x: AgentSession) =>
    new Set([x.gitBranchStart, x.gitBranchEnd].filter((b): b is string => isWorkBranch(b)));
  const shared = [...branchesOf(s)].find((b) => branchesOf(c).has(b));
  if (shared) return { kind: "same-branch", detail: { branch: shared } };
  if (mine && theirs) {
    const overlap = [...mine.removed].filter((fp) => theirs.added.has(fp)).length;
    if (overlap > 0) return { kind: "line-overlap", detail: { lines: overlap } };
    const inter = [...mine.files].filter((f) => theirs.files.has(f)).length;
    const union = new Set([...mine.files, ...theirs.files]).size;
    if (union > 0 && inter / union >= THREAD_RULES.fileJaccard) {
      return {
        kind: "file-overlap",
        detail: { jaccard: Math.round((inter / union) * 100) / 100, sharedFiles: inter },
      };
    }
  }
  return undefined;
}

/** `feat/webhook-retry` → `webhook retry`. */
export function humanizeBranch(branch: string): string {
  const last = branch.replace(
    /^(?:feature|feat|fix|bugfix|chore|refactor|codex|claude|agent|wip)[/_-]/i,
    "",
  );
  return last.replace(/[/_-]+/g, " ").trim() || branch;
}

function threadTitle(
  branch: string | undefined,
  outcomes: Outcome[],
  files: string[],
  members: AgentSession[],
): { title: string; provenance: Provenance } {
  if (branch) return { title: humanizeBranch(branch), provenance: "observed" };
  const landed = outcomes
    .filter((o) => o.firstCommit?.subject)
    .sort((a, b) => Date.parse(a.firstCommit?.time ?? "") - Date.parse(b.firstCommit?.time ?? ""));
  const subject = landed[0]?.firstCommit?.subject;
  if (subject) return { title: subject, provenance: "observed" };
  const titled =
    members.find((m) => m.title && m.titleProvenance === "observed") ??
    members.find((m) => m.title);
  if (titled?.title)
    return { title: titled.title, provenance: titled.titleProvenance ?? "observed" };
  if (files.length) {
    const dirs = new Map<string, number>();
    for (const f of files) {
      const parts = f.split("/");
      const d = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : f;
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
    const top = [...dirs].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) return { title: `Work in ${top}`, provenance: "derived" };
  }
  // No branch, commit, title or edits: say what it was rather than "untitled".
  const agents = [...new Set(members.map((m) => m.provider))].map((p) =>
    p
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
  );
  const anyBranch = members
    .map((m) => m.gitBranchEnd ?? m.gitBranchStart)
    .find((b) => b && b !== "HEAD");
  return {
    title: `${agents.join(" + ")} session${members.length > 1 ? "s" : ""}${anyBranch ? ` on ${anyBranch}` : ""} (no edits)`,
    provenance: "derived",
  };
}

function threadStatus(outcomes: Outcome[], lastMs: number, nowMs: number): ThreadStatus {
  if (nowMs - lastMs <= THREAD_RULES.activeWindowMs) return "active";
  const classes = new Set(outcomes.map((o) => o.class));
  if (classes.has("uncommitted") || classes.has("partial")) return "dangling";
  if (classes.has("landed")) return "landed";
  // Abandoned means work was produced and left; a thread without edits (questions, reviews,
  // exploration) has no outcome to abandon.
  const produced = outcomes.some((o) => o.class === "lost" || o.class === "superseded");
  if (produced && nowMs - lastMs > THREAD_RULES.abandonedAfterMs) return "abandoned";
  return "unknown";
}
