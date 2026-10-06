// Shapes returned by @landed/server. Domain enums come from @landed/core (type-only import).
import type {
  AgentProvider,
  OpenLoop,
  Outcome,
  OutcomeClass,
  Provenance,
  SessionStatus,
  ThreadStatus,
} from "@landed/core";

export type { AgentProvider, OutcomeClass, Provenance };
export type Distribution = Partial<Record<OutcomeClass, number>>;

export interface SessionItem {
  id: string;
  provider: AgentProvider;
  title?: string;
  repo?: string;
  repoId?: string;
  startedAt: string;
  lastEventAt: string;
  status: SessionStatus;
  eventCount: number;
  failureCount: number;
  changedFileCount: number;
  tokens?: number;
  outcomeSummary?: Record<string, number>;
  subagents: number;
  threadId?: string;
  live: boolean;
}

export interface Loop extends OpenLoop {
  key: string;
  repo?: string;
  repoRoot?: string;
  defaultBranch?: string;
  label: string;
  description: string;
  dismissReason?: string;
}

export interface Brief {
  from: string;
  to: string;
  activity: { sessions: number; providers: AgentProvider[]; repos: number };
  whereYouLeftOff: {
    id: string;
    title: string;
    repo: string;
    status: ThreadStatus;
    providers: AgentProvider[];
    lastActivityAt: string;
  }[];
  openLoops: {
    open: number;
    newToday: number;
    oldestSince?: string;
    top: (OpenLoop & { repo?: string })[];
  };
  landed: {
    repo: string;
    files: number;
    lines: number;
    commits: { sha: string; subject?: string }[];
  }[];
  attention: { kind: string; message: string; sessionId?: string }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    coverage: "none" | "partial" | "complete";
    sessionsWithUsage: number;
  };
  outcomeMix: Distribution;
}

export interface Today {
  date: string;
  running: SessionItem[];
  brief: Brief;
  generated?: { date: string; summary: string; attention: string[] };
  lastScan?: { at: string; durationMs: number };
}

export interface ThreadItem {
  id: string;
  repoId: string;
  repo: string;
  sessionIds: string[];
  providers: AgentProvider[];
  startedAt: string;
  lastActivityAt: string;
  title: string;
  titleProvenance: Provenance;
  branch?: string;
  status: ThreadStatus;
  linkEvidence: {
    kind: string;
    fromSessionId: string;
    toSessionId: string;
    detail?: Record<string, unknown>;
  }[];
  outcomeMix: Distribution;
}

export interface TimelineItem {
  at: string;
  type: string;
  label: string;
  detail?: string;
  status?: string;
  count: number;
}

export interface SessionDetail {
  session: SessionItem;
  meta: Record<string, string | number | undefined>;
  files: {
    relPath: string;
    path: string;
    edits: number;
    added: number;
    removed: number;
    outcome?: Outcome;
  }[];
  timeline: TimelineItem[];
  subagents: SessionItem[];
  insights: {
    id: string;
    type: string;
    severity: string;
    message: string;
    provenance: Provenance;
  }[];
  thread?: ThreadItem;
}

export interface OutcomesView {
  days: number | null;
  overall: Distribution;
  repos: {
    repoId: string;
    repo: string;
    missing: boolean;
    confidence?: "normal" | "low";
    controlA?: number;
    controlB?: number;
    distribution: Distribution;
    agents: AgentProvider[];
    comparison?: { provider: AgentProvider; distribution: Distribution }[];
    fit: { category: string; agents: { provider: AgentProvider; distribution: Distribution }[] }[];
  }[];
  survival: Record<string, number>;
  commitLagHours: { median: number; p90: number } | null;
  unknownReasons: Record<string, number>;
  minComparisonSample: number;
  comparisonCaveat: string;
}

export interface Summary {
  days: number;
  sessions: number;
  agents: AgentProvider[];
  repos: number;
  files: { landed: number; waiting: number; lost: number };
  running: SessionItem[];
  openLoops: number;
  lastScan?: { at: string; durationMs: number };
}

export interface ThreadDetail {
  thread: ThreadItem;
  sessions: SessionItem[];
  outcomes: Outcome[];
  loops: Loop[];
}

export interface Settings {
  dataDir: string;
  dbPath: string;
  dbBytes: number;
  lastScan?: { at: string; durationMs: number };
  sources: {
    provider: AgentProvider;
    rootPath: string;
    exists: boolean;
    lastScanAt: string | null;
  }[];
  sessions: number;
  repos: {
    rootPath: string;
    missing: boolean;
    defaultBranch?: string;
    confidence?: string;
    controlA?: number;
    controlB?: number;
  }[];
  ingestionFailures: number;
  summarizer: { enabled: boolean; command: string; args: string[] };
  notifications: { enabled: boolean };
  loopIgnorePaths: string[];
  live: boolean;
  privacy: Record<string, string>;
}

export interface LiveMessage {
  type: "import" | "analysis" | "notice";
  at: string;
  detail?: { kind?: string; title?: string; message?: string; sessionId?: string; files?: number };
}
