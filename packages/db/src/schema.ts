/**
 * SQLite schema (PRD §24 Phase 2). Conventions:
 * - ids are ULID text; instants are INTEGER epoch milliseconds (UTC) so range queries are cheap;
 * - JSON columns hold evidence/aggregates only — never code, prompts or tool output;
 * - every table that a re-scan can re-populate has a natural unique key for idempotent writes.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const ms = (name: string) => integer(name); // epoch milliseconds, UTC
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const bool = (name: string) => integer(name, { mode: "boolean" });

// ── Sources & ingestion ────────────────────────────────────────────────────────────────────

/** A vendor history location, e.g. a provider's sessions root directory. */
export const sources = sqliteTable(
  "sources",
  {
    id: id(),
    provider: text("provider").notNull(),
    rootPath: text("root_path").notNull(),
    enabled: bool("enabled").notNull().default(true),
    createdAt: ms("created_at").notNull(),
    lastScanAt: ms("last_scan_at"),
  },
  (t) => [uniqueIndex("sources_provider_root_uq").on(t.provider, t.rootPath)],
);

/** Incremental-import position per source file (PRD §21.3). */
export const sourceCheckpoints = sqliteTable(
  "source_checkpoints",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    inode: integer("inode").notNull(),
    size: integer("size").notNull(),
    mtimeMs: ms("mtime_ms").notNull(),
    byteOffset: integer("byte_offset").notNull(),
    parserVersion: text("parser_version").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("source_checkpoints_path_uq").on(t.path),
    index("source_checkpoints_source_idx").on(t.sourceId),
  ],
);

/** Unparseable vendor lines. Stores where and why — never the line text. */
export const ingestionFailures = sqliteTable(
  "ingestion_failures",
  {
    id: id(),
    provider: text("provider").notNull(),
    sourceFile: text("source_file").notNull(),
    offset: integer("offset").notNull(),
    parserVersion: text("parser_version").notNull(),
    reasonCode: text("reason_code").notNull(),
    message: text("message"),
    occurredAt: ms("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("ingestion_failures_loc_uq").on(t.sourceFile, t.offset, t.parserVersion),
    index("ingestion_failures_occurred_idx").on(t.occurredAt),
  ],
);

// ── Repositories & sessions ────────────────────────────────────────────────────────────────

export const repos = sqliteTable(
  "repos",
  {
    id: id(),
    rootPath: text("root_path").notNull(),
    /** HMAC of the normalized remote URL — the raw URL is never stored (PRD §21.3). */
    remoteHash: text("remote_hash"),
    defaultBranch: text("default_branch"),
    missing: bool("missing").notNull().default(false),
    createdAt: ms("created_at").notNull(),
    lastSeenAt: ms("last_seen_at").notNull(),
    lastIndexedAt: ms("last_indexed_at"),
    /** Outcome self-check (PRD §12.5): match rates of the two negative controls, 0..1. */
    outcomeControlA: real("outcome_control_a"),
    outcomeControlB: real("outcome_control_b"),
    outcomeConfidence: text("outcome_confidence"),
    outcomesComputedAt: ms("outcomes_computed_at"),
  },
  (t) => [uniqueIndex("repos_root_uq").on(t.rootPath)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    parentSessionId: text("parent_session_id"),
    startedAt: ms("started_at").notNull(),
    endedAt: ms("ended_at"),
    lastEventAt: ms("last_event_at").notNull(),
    status: text("status").notNull(),
    cwd: text("cwd"),
    repoId: text("repo_id").references(() => repos.id, { onDelete: "set null" }),
    repoRoot: text("repo_root"),
    projectName: text("project_name"),
    gitBranchStart: text("git_branch_start"),
    gitBranchEnd: text("git_branch_end"),
    gitHeadStart: text("git_head_start"),
    gitHeadEnd: text("git_head_end"),
    model: text("model"),
    title: text("title"),
    titleProvenance: text("title_provenance"),
    observedOutcome: text("observed_outcome"),
    generatedSummary: text("generated_summary"),
    eventCount: integer("event_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    changedFileCount: integer("changed_file_count").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    usageCoverage: text("usage_coverage"),
    estimatedCostUsd: real("estimated_cost_usd"),
    sourceFiles: json<string[]>("source_files").notNull().default(sql`'[]'`),
    outcomeSummary: json<Record<string, number>>("outcome_summary"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("sessions_provider_session_uq").on(t.provider, t.providerSessionId),
    index("sessions_started_idx").on(t.startedAt),
    index("sessions_repo_idx").on(t.repoId),
    index("sessions_parent_idx").on(t.parentSessionId),
  ],
);

// ── Events ─────────────────────────────────────────────────────────────────────────────────

export const events = sqliteTable(
  "events",
  {
    id: id(),
    /** Idempotency key from eventFingerprint(); see docs/architecture.md. */
    fingerprint: text("fingerprint").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id"),
    providerEventType: text("provider_event_type").notNull(),
    providerVersion: text("provider_version"),
    providerSessionId: text("provider_session_id").notNull(),
    providerParentSessionId: text("provider_parent_session_id"),
    userId: text("user_id"),
    timestamp: ms("timestamp").notNull(),
    receivedAt: ms("received_at").notNull(),
    sequence: integer("sequence"),
    eventType: text("event_type").notNull(),
    status: text("status"),
    cwd: text("cwd"),
    repoRoot: text("repo_root"),
    repoRemoteHash: text("repo_remote_hash"),
    projectName: text("project_name"),
    gitBranch: text("git_branch"),
    gitHead: text("git_head"),
    model: text("model"),
    toolName: text("tool_name"),
    toolCategory: text("tool_category"),
    toolCallId: text("tool_call_id"),
    commandExecutable: text("command_executable"),
    commandDisplay: text("command_display"),
    commandExitCode: integer("command_exit_code"),
    filePath: text("file_path"),
    fileOperation: text("file_operation"),
    usageInputTokens: integer("usage_input_tokens"),
    usageOutputTokens: integer("usage_output_tokens"),
    usageCachedInputTokens: integer("usage_cached_input_tokens"),
    usageReasoningTokens: integer("usage_reasoning_tokens"),
    usageEstimatedCostUsd: real("usage_estimated_cost_usd"),
    usageCostConfidence: text("usage_cost_confidence"),
    usagePricingVersion: text("usage_pricing_version"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Only populated when the user enabled capture; schema validation enforces the flags. */
    content: json<Record<string, unknown>>("content"),
    promptCaptured: bool("prompt_captured").notNull(),
    argumentsCaptured: bool("arguments_captured").notNull(),
    resultCaptured: bool("result_captured").notNull(),
    redactionsApplied: integer("redactions_applied").notNull(),
    sourceFile: text("source_file"),
    sourceOffset: integer("source_offset"),
    parserVersion: text("parser_version"),
    rawPayloadRef: text("raw_payload_ref"),
  },
  (t) => [
    uniqueIndex("events_fingerprint_uq").on(t.fingerprint),
    index("events_session_ts_idx").on(t.sessionId, t.timestamp),
    index("events_ts_idx").on(t.timestamp),
    index("events_type_ts_idx").on(t.eventType, t.timestamp),
    // Cross-session dedupe: vendors copy history into resumed sessions with the same ids.
    index("events_provider_event_idx").on(t.provider, t.providerEventId),
  ],
);

/**
 * Token usage with a provider dedupe key (Claude message.id, Codex turn id). The unique key makes
 * the PRD §17 dedupe rule a storage guarantee, not just importer discipline.
 */
export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    usageKey: text("usage_key").notNull(),
    timestamp: ms("timestamp").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    estimatedCostUsd: real("estimated_cost_usd"),
    costConfidence: text("cost_confidence"),
    pricingVersion: text("pricing_version"),
  },
  (t) => [
    uniqueIndex("usage_records_session_key_uq").on(t.sessionId, t.usageKey),
    index("usage_records_ts_idx").on(t.timestamp),
    index("usage_records_key_idx").on(t.usageKey),
  ],
);

// ── Patches & git index ────────────────────────────────────────────────────────────────────

export const agentPatches = sqliteTable(
  "agent_patches",
  {
    id: id(),
    /** Content-addressed idempotency key; see repositories/patches.ts. */
    patchKey: text("patch_key").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    toolCallId: text("tool_call_id"),
    timestamp: ms("timestamp").notNull(),
    repoId: text("repo_id").references(() => repos.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    relPath: text("rel_path"),
    operation: text("operation").notNull(),
    addedLineCountRaw: integer("added_line_count_raw").notNull(),
    removedLineCountRaw: integer("removed_line_count_raw").notNull(),
    sourceFile: text("source_file").notNull(),
    sourceOffset: integer("source_offset").notNull(),
    parserVersion: text("parser_version").notNull(),
  },
  (t) => [
    uniqueIndex("agent_patches_key_uq").on(t.patchKey),
    index("agent_patches_session_idx").on(t.sessionId),
    index("agent_patches_repo_path_idx").on(t.repoId, t.relPath),
    index("agent_patches_provider_call_idx").on(t.provider, t.toolCallId),
  ],
);

/** Line fingerprints of a patch — the only trace of code content we keep. */
export const patchLineFps = sqliteTable(
  "patch_line_fps",
  {
    patchId: text("patch_id")
      .notNull()
      .references(() => agentPatches.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["added", "removed"] }).notNull(),
    ordinal: integer("ordinal").notNull(),
    fp: text("fp").notNull(),
  },
  (t) => [primaryKey({ columns: [t.patchId, t.side, t.ordinal] })],
);

/** fp → commits that added that line to that file (PRD §12.1). */
export const gitLineIndex = sqliteTable(
  "git_line_index",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    fp: text("fp").notNull(),
    commitSha: text("commit_sha").notNull(),
    commitTime: ms("commit_time").notNull(),
    onDefaultBranch: bool("on_default_branch").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.relPath, t.fp, t.commitSha] })],
);

// ── Derived: outcomes, threads, loops, collisions, insights ───────────────────────────────

export const outcomes = sqliteTable(
  "outcomes",
  {
    id: id(),
    /** patch id for patch scope; `${sessionId}:${repoId}:${relPath}` for session-file scope. */
    subjectKey: text("subject_key").notNull(),
    scope: text("scope").notNull(),
    patchId: text("patch_id").references(() => agentPatches.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    repoId: text("repo_id").references(() => repos.id, { onDelete: "set null" }),
    relPath: text("rel_path"),
    class: text("class").notNull(),
    unknownReason: text("unknown_reason"),
    survival: text("survival").notNull(),
    fracCommitted: real("frac_committed").notNull(),
    fracOnDefaultBranch: real("frac_on_default_branch").notNull(),
    fracInWorkingTree: real("frac_in_working_tree").notNull(),
    firstCommitSha: text("first_commit_sha"),
    firstCommitTime: ms("first_commit_time"),
    firstCommitSubject: text("first_commit_subject"),
    firstCommitBranch: text("first_commit_branch"),
    commitLagSeconds: real("commit_lag_seconds"),
    lineCount: integer("line_count").notNull(),
    computedAt: ms("computed_at").notNull(),
    engineVersion: text("engine_version").notNull(),
  },
  (t) => [
    uniqueIndex("outcomes_scope_subject_uq").on(t.scope, t.subjectKey),
    index("outcomes_session_scope_idx").on(t.sessionId, t.scope),
    index("outcomes_repo_idx").on(t.repoId),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: id(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    startedAt: ms("started_at").notNull(),
    lastActivityAt: ms("last_activity_at").notNull(),
    title: text("title").notNull(),
    titleProvenance: text("title_provenance").notNull(),
    branch: text("branch"),
    status: text("status").notNull(),
    providers: json<string[]>("providers").notNull(),
    linkEvidence: json<unknown[]>("link_evidence").notNull(),
  },
  (t) => [
    index("threads_repo_idx").on(t.repoId),
    index("threads_last_activity_idx").on(t.lastActivityAt),
  ],
);

/** A session belongs to at most one thread. */
export const threadSessions = sqliteTable(
  "thread_sessions",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.sessionId] }),
    uniqueIndex("thread_sessions_session_uq").on(t.sessionId),
  ],
);

export const openLoops = sqliteTable(
  "open_loops",
  {
    id: id(),
    /** Stable detector key so a dismissal survives re-scans. */
    loopKey: text("loop_key").notNull(),
    type: text("type").notNull(),
    repoId: text("repo_id").references(() => repos.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "set null" }),
    sessionIds: json<string[]>("session_ids").notNull(),
    since: ms("since").notNull(),
    sizeFiles: integer("size_files"),
    sizeLines: integer("size_lines"),
    sizeCommits: integer("size_commits"),
    evidence: json<Record<string, unknown>>("evidence").notNull(),
    provenance: text("provenance").notNull(),
    state: text("state").notNull(),
    resolvedBy: text("resolved_by"),
    dismissReason: text("dismiss_reason"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("open_loops_key_uq").on(t.loopKey),
    index("open_loops_state_repo_idx").on(t.state, t.repoId),
  ],
);

export const collisions = sqliteTable(
  "collisions",
  {
    id: id(),
    collisionKey: text("collision_key").notNull(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    sessionA: text("session_a")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    sessionB: text("session_b")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    windowStart: ms("window_start").notNull(),
    windowEnd: ms("window_end").notNull(),
    evidence: json<Record<string, unknown>>("evidence").notNull(),
    provenance: text("provenance").notNull(),
  },
  (t) => [
    uniqueIndex("collisions_key_uq").on(t.collisionKey),
    index("collisions_repo_window_idx").on(t.repoId, t.windowStart),
  ],
);

export const insights = sqliteTable(
  "insights",
  {
    id: id(),
    insightKey: text("insight_key").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    evidence: json<Record<string, unknown>>("evidence").notNull(),
    provenance: text("provenance").notNull(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "set null" }),
    repoId: text("repo_id").references(() => repos.id, { onDelete: "cascade" }),
    createdAt: ms("created_at").notNull(),
    dismissedAt: ms("dismissed_at"),
  },
  (t) => [
    uniqueIndex("insights_key_uq").on(t.insightKey),
    index("insights_session_type_idx").on(t.sessionId, t.type),
  ],
);

/** Generated summaries, cached by the hash of their (sanitized) input. */
export const summaries = sqliteTable(
  "summaries",
  {
    id: id(),
    scope: text("scope").notNull(),
    subjectKey: text("subject_key").notNull(),
    inputHash: text("input_hash").notNull(),
    summarizer: text("summarizer").notNull(),
    model: text("model"),
    output: json<Record<string, unknown>>("output").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("summaries_subject_uq").on(t.scope, t.subjectKey, t.inputHash)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: json<unknown>("value").notNull(),
  updatedAt: ms("updated_at").notNull(),
});
