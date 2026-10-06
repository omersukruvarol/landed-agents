import type {
  AgentProvider,
  AgentSession,
  Collision,
  Insight,
  OpenLoop,
  Outcome,
  OutcomeClass,
  UsageCoverage,
  WorkThread,
} from "@landed/core";

export interface BriefInputs {
  /** The local calendar date the brief covers (YYYY-MM-DD); defaults to the UTC date of `from`. */
  date?: string;
  /** The day the brief covers, as [from, to). */
  from: string;
  to: string;
  sessions: readonly AgentSession[];
  /** Session-file outcomes. */
  outcomes: readonly Outcome[];
  loops: readonly (OpenLoop & { key?: string })[];
  threads: readonly WorkThread[];
  collisions: readonly Collision[];
  insights: readonly Insight[];
  /** repoId → display name. */
  repoNames: ReadonlyMap<string, string>;
}

export interface BriefThread {
  id: string;
  title: string;
  repo: string;
  status: WorkThread["status"];
  providers: AgentProvider[];
  lastActivityAt: string;
}

export interface LandedRepo {
  repo: string;
  files: number;
  lines: number;
  commits: { sha: string; subject?: string }[];
}

export interface DailyBrief {
  date: string;
  from: string;
  to: string;
  /** Everything here is observed or derived; nothing is generated. */
  provenance: "derived";
  activity: { sessions: number; providers: AgentProvider[]; repos: number };
  whereYouLeftOff: BriefThread[];
  openLoops: {
    open: number;
    newToday: number;
    oldestSince?: string;
    top: (OpenLoop & { repo?: string })[];
  };
  landed: LandedRepo[];
  attention: {
    kind: "failure" | "collision" | "insight" | "awaiting-user";
    message: string;
    sessionId?: string;
  }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    coverage: UsageCoverage;
    sessionsWithUsage: number;
  };
  outcomeMix: Partial<Record<OutcomeClass, number>>;
}

const within = (iso: string | undefined, from: number, to: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= from && t < to;
};

/** Deterministic Daily Brief (PRD §18). Works without any LLM. */
export function buildDailyBrief(input: BriefInputs): DailyBrief {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const repo = (id?: string) => (id ? (input.repoNames.get(id) ?? "unknown repo") : "no repo");
  const active = input.sessions.filter(
    (s) => Date.parse(s.startedAt) < to && Date.parse(s.lastEventAt) >= from,
  );
  const activeIds = new Set(active.map((s) => s.id));

  const whereYouLeftOff = input.threads
    .filter(
      (t) =>
        (t.status === "dangling" || t.status === "active" || t.status === "unknown") &&
        Date.parse(t.lastActivityAt) >= from - 2 * 86_400_000 &&
        Date.parse(t.lastActivityAt) < to,
    )
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      title: t.title,
      repo: repo(t.repoId),
      status: t.status,
      providers: t.providers,
      lastActivityAt: t.lastActivityAt,
    }));

  const open = input.loops.filter((l) => l.state === "open");
  const severity = (l: OpenLoop) =>
    (l.size.lines ?? 0) * Math.max(1, (to - Date.parse(l.since)) / 86_400_000);
  const top = [...open]
    .sort((a, b) => severity(b) - severity(a))
    .slice(0, 6)
    .map((l) => ({ ...l, repo: repo(l.repoId) }));

  const landedByRepo = new Map<string, LandedRepo>();
  for (const o of input.outcomes) {
    if (o.class !== "landed" || !within(o.firstCommit?.time, from, to)) continue;
    const name = repo(o.repoId);
    const entry = landedByRepo.get(name) ?? { repo: name, files: 0, lines: 0, commits: [] };
    entry.files++;
    entry.lines += o.lineCount;
    const sha = o.firstCommit?.sha;
    if (sha && !entry.commits.some((c) => c.sha === sha))
      entry.commits.push({
        sha: sha.slice(0, 9),
        ...(o.firstCommit?.subject ? { subject: o.firstCommit.subject } : {}),
      });
    landedByRepo.set(name, entry);
  }

  const attention: DailyBrief["attention"] = [];
  for (const s of active) {
    if ((s.status === "failed" || s.status === "interrupted") && !s.parentSessionId) {
      attention.push({
        kind: "failure",
        message: `${s.title ?? "A session"} in ${repo(s.repoId)} ${s.status === "failed" ? "ended with an error" : "was interrupted"}`,
        sessionId: s.id,
      });
    }
    if (s.status === "awaiting-user")
      attention.push({
        kind: "awaiting-user",
        message: `${s.title ?? "A session"} in ${repo(s.repoId)} is waiting for your answer`,
        sessionId: s.id,
      });
  }
  for (const c of input.collisions) {
    if (!within(c.window.end, from, to)) continue;
    attention.push({
      kind: "collision",
      message: `${c.kind === "overwrite" ? "One agent overwrote another's unlanded edit in" : "Two agents edited"} ${c.relPath} (${repo(c.repoId)})`,
      sessionId: c.sessionB,
    });
  }
  for (const i of input.insights) {
    if (i.severity === "warning" && i.sessionId && activeIds.has(i.sessionId))
      attention.push({ kind: "insight", message: i.message, sessionId: i.sessionId });
  }

  const withUsage = active.filter(
    (s) => s.usageCoverage === "complete" || s.inputTokens !== undefined,
  );
  const coverage: UsageCoverage =
    active.length === 0 || withUsage.length === 0
      ? "none"
      : withUsage.length === active.length
        ? "complete"
        : "partial";
  const outcomeMix: Partial<Record<OutcomeClass, number>> = {};
  for (const o of input.outcomes) {
    if (!activeIds.has(o.sessionId) || o.class === "unknown") continue;
    outcomeMix[o.class] = (outcomeMix[o.class] ?? 0) + 1;
  }

  return {
    date: input.date ?? input.from.slice(0, 10),
    from: input.from,
    to: input.to,
    provenance: "derived",
    activity: {
      sessions: active.filter((s) => !s.parentSessionId).length,
      providers: [...new Set(active.map((s) => s.provider))],
      repos: new Set(active.map((s) => s.repoId).filter(Boolean)).size,
    },
    whereYouLeftOff,
    openLoops: {
      open: open.length,
      newToday: open.filter((l) => within(l.since, from, to)).length,
      ...(open.length ? { oldestSince: open.map((l) => l.since).sort()[0] } : {}),
      top,
    },
    landed: [...landedByRepo.values()].sort((a, b) => b.lines - a.lines),
    attention: attention.slice(0, 12),
    usage: {
      inputTokens: withUsage.reduce((n, s) => n + (s.inputTokens ?? 0), 0),
      outputTokens: withUsage.reduce((n, s) => n + (s.outputTokens ?? 0), 0),
      cachedInputTokens: withUsage.reduce((n, s) => n + (s.cachedInputTokens ?? 0), 0),
      coverage,
      sessionsWithUsage: withUsage.length,
    },
    outcomeMix,
  };
}

const LOOP_LABEL: Record<OpenLoop["type"], string> = {
  "uncommitted-output": "Uncommitted agent output",
  "unmerged-agent-branch": "Unmerged agent branch",
  "orphan-worktree": "Orphaned worktree",
  "awaiting-user": "Waiting for your answer",
  "failed-unresolved": "Failed, never resolved",
  "lost-work": "Agent work that was lost",
};

export function loopLabel(type: OpenLoop["type"]): string {
  return LOOP_LABEL[type];
}

export function describeLoop(l: OpenLoop & { repo?: string }): string {
  const branch = typeof l.evidence.branch === "string" ? ` on \`${l.evidence.branch}\`` : "";
  const size = [
    l.size.files ? `${l.size.files} files` : "",
    l.size.lines ? `${l.size.lines} lines` : "",
    l.size.commits ? `${l.size.commits} commits` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const where = l.repo ? ` in ${l.repo}` : l.repoId ? "" : " outside a git repository";
  const status = typeof l.evidence.status === "string" ? ` (session ${l.evidence.status})` : "";
  return `${LOOP_LABEL[l.type]}${branch}${where}${size ? ` (${size})` : ""}${l.type === "failed-unresolved" ? status : ""}`;
}

const fmt = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)}k`
        : String(n);
const day = (iso: string) => iso.slice(0, 10);
/** Provider id to display name (e.g. claude-code → Claude Code), derived generically. */
export const agentName = (p: string) =>
  p
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Markdown export of the brief. Labels inferred/derived content as such. */
export function renderBriefMarkdown(b: DailyBrief): string {
  const out: string[] = [
    `# Daily Brief — ${b.date}`,
    "",
    "_All items are observed or derived from local history; nothing here is generated._",
    "",
  ];
  out.push(
    `**Activity:** ${b.activity.sessions} sessions · ${b.activity.providers.map(agentName).join(", ") || "no agents"} · ${b.activity.repos} repos`,
    "",
  );
  out.push("## Where you left off", "");
  if (!b.whereYouLeftOff.length) out.push("Nothing unfinished in the last two days.");
  for (const t of b.whereYouLeftOff)
    out.push(
      `- **${t.title}** (${t.repo}) — ${t.status}, last active ${t.lastActivityAt.slice(0, 16).replace("T", " ")} UTC`,
    );
  out.push("", `## Open loops (${b.openLoops.open} open, ${b.openLoops.newToday} new)`, "");
  if (!b.openLoops.top.length) out.push("No open loops. 🎉");
  for (const l of b.openLoops.top)
    out.push(
      `- ${describeLoop(l)} — since ${day(l.since)}${l.provenance === "inferred" ? " _(inferred)_" : ""}`,
    );
  out.push("", "## What landed", "");
  if (!b.landed.length) out.push("No agent work reached a commit this day.");
  for (const r of b.landed) {
    out.push(`- **${r.repo}**: ${r.files} files, ${r.lines} lines`);
    for (const c of r.commits.slice(0, 5))
      out.push(`  - \`${c.sha}\` ${c.subject ?? ""}`.trimEnd());
  }
  out.push("", "## Needs attention", "");
  if (!b.attention.length) out.push("Nothing flagged.");
  for (const a of b.attention) out.push(`- ${a.message}`);
  out.push("", "## Usage", "");
  out.push(
    `${fmt(b.usage.inputTokens)} input · ${fmt(b.usage.cachedInputTokens)} cached input · ${fmt(b.usage.outputTokens)} output tokens — coverage **${b.usage.coverage}**${b.usage.coverage !== "complete" ? " (some sessions reported no usage; totals are a lower bound)" : ""}.`,
  );
  return `${out.join("\n")}\n`;
}
