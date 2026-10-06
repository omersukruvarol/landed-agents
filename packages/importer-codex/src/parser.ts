import {
  type AgentProvider,
  type EventType,
  type FailureDraft,
  type NormalizedEvent,
  NormalizedEventSchema,
  type ParsedChunk,
  type PatchDraft,
  type PatchOperation,
  type SessionFacts,
  type SourceFileParser,
  sanitizeCommand,
  TimestampSchema,
  type UsageDraft,
} from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import { newUlid } from "@landed/shared";
import { THREAD_INDEX_FILE } from "./files";

/** Bump whenever normalized output for the same input lines changes (forces a re-import). */
export const CODEX_PARSER_VERSION = "codex@3";

const PROVIDER: AgentProvider = "codex";

/** The provider this importer produces, for callers that must not hard-code vendor names. */
export const CODEX_PROVIDER = PROVIDER;

/**
 * Line types skipped without JSON.parse: model I/O, compaction snapshots and bookkeeping. They are
 * ~85% of rollout bytes and carry nothing the normalized model needs (tool activity is taken from
 * `item_completed`, which also carries exit codes and patches).
 */
const SKIPPED_TYPES = new Set([
  "response_item",
  "compacted",
  "world_state",
  "inter_agent_communication_metadata",
  "token_usage_record", // usage comes from token_count, which every version writes
]);

/** event_msg payloads with nothing to keep. */
const IGNORED_EVENT_MSGS = new Set([
  "task_started",
  "thread_settings_applied",
  "thread_goal_updated",
]);

/** item_completed item types with nothing to keep (model text, reasoning, images, compaction). */
const IGNORED_ITEMS = new Set([
  "AgentMessage",
  "Reasoning",
  "ImageView",
  "ContextCompaction",
  "FunctionCallOutput",
  "Extension",
  "EnteredReviewMode",
  "ExitedReviewMode",
]);

/** `{"timestamp":"…","ordinal":N,"type":"…"` — the layout of every observed line. */
const LINE_PREFIX = /^\{"timestamp":"[^"]*",(?:"ordinal":\d+,)?"type":"([a-z_]+)"/;
const SESSION_ID_IN_FILENAME =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
/** Copied parent history in a forked rollout is written in one burst at fork time. */
const FORK_COPY_WINDOW_MS = 1000;

export interface CodexParserContext {
  sourceFile: string;
  fingerprinter: LineFingerprinter;
  receivedAt: string;
}

type Json = Record<string, unknown>;
type EventBuilder = (eventType: EventType, extra?: Partial<NormalizedEvent>) => NormalizedEvent;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

interface Cumulative {
  total: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

/**
 * Parses one Codex rollout file. The session id comes from the file name (it equals
 * `session_meta.id`), so incremental passes that start mid-file still know their session.
 * Prompt text, model output, reasoning, command output and file contents are never emitted.
 */
export function createCodexParser(ctx: CodexParserContext): SourceFileParser {
  if (ctx.sourceFile.endsWith(`/${THREAD_INDEX_FILE}`)) return createThreadIndexParser(ctx);
  const sessionId = SESSION_ID_IN_FILENAME.exec(ctx.sourceFile)?.[1];
  let facts: SessionFacts | undefined;
  let ownMetaSeen = false;
  let fork: { startOrdinal: number; at: number } | undefined;
  let prevCumulative: Cumulative | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  const events: NormalizedEvent[] = [];
  const patches: PatchDraft[] = [];
  const usage: UsageDraft[] = [];
  const failures: FailureDraft[] = [];
  const stats = { lines: 0, ignored: 0, unknownTypes: {} as Record<string, number> };

  const fail = (offset: number, reasonCode: string, message?: string) =>
    failures.push({ sourceFile: ctx.sourceFile, offset, reasonCode, ...opt("message", message) });
  const unknown = (type: string) => {
    stats.unknownTypes[type] = (stats.unknownTypes[type] ?? 0) + 1;
  };

  return {
    skipLine(head) {
      const sniffed = LINE_PREFIX.exec(head)?.[1];
      if (!sniffed || !SKIPPED_TYPES.has(sniffed)) return false;
      stats.lines++;
      stats.ignored++;
      return true;
    },

    push(line, offset) {
      stats.lines++;
      if (line.trim() === "") return;
      const sniffed = LINE_PREFIX.exec(line)?.[1];
      if (sniffed && SKIPPED_TYPES.has(sniffed)) {
        stats.ignored++;
        return;
      }
      let d: unknown;
      try {
        d = JSON.parse(line);
      } catch {
        fail(offset, "invalid-json");
        return;
      }
      if (!isObj(d)) {
        fail(offset, "not-an-object");
        return;
      }
      const type = str(d.type) ?? "<none>";
      if (SKIPPED_TYPES.has(type)) {
        stats.ignored++;
        return;
      }
      const ts = str(d.timestamp);
      if (!ts || !TimestampSchema.safeParse(ts).success) {
        fail(
          offset,
          ts ? "invalid-timestamp" : "missing-field",
          ts ? undefined : "timestamp missing",
        );
        return;
      }
      const payload = isObj(d.payload) ? d.payload : {};

      if (type === "session_meta") {
        onSessionMeta(payload, ts, offset);
        return;
      }
      // Copied parent history at the top of a forked rollout belongs to the parent session.
      if (fork && typeof d.ordinal === "number" && d.ordinal > 0 && d.ordinal < fork.startOrdinal) {
        if (Math.abs(Date.parse(ts) - fork.at) <= FORK_COPY_WINDOW_MS) {
          stats.ignored++;
          return;
        }
      }
      const psid = sessionId ?? facts?.providerSessionId;
      if (!psid) {
        fail(offset, "missing-field", "session id unknown");
        return;
      }
      const f = touch(psid, ts);

      const base: EventBuilder = (eventType, extra = {}) => ({
        id: newUlid(Date.parse(ts)),
        schemaVersion: 1,
        provider: PROVIDER,
        providerEventType: type,
        sessionId: psid,
        ...opt("parentSessionId", f.parentProviderSessionId),
        ...opt("providerVersion", f.providerVersion),
        timestamp: ts,
        receivedAt: ctx.receivedAt,
        eventType,
        ...opt("cwd", cwd),
        ...opt("model", model),
        privacy: {
          promptCaptured: false,
          argumentsCaptured: false,
          resultCaptured: false,
          redactionsApplied: 0,
        },
        sourceRef: { file: ctx.sourceFile, offset, parserVersion: CODEX_PARSER_VERSION },
        ...extra,
      });
      const emit = (e: NormalizedEvent) => {
        const r = NormalizedEventSchema.safeParse(e);
        if (r.success) events.push(r.data);
        else fail(offset, "schema-mismatch", r.error.issues[0]?.path.join(".") ?? "event");
      };

      if (type === "turn_context") {
        cwd = str(payload.cwd) ?? cwd;
        model = str(payload.model) ?? model;
        if (cwd && f.cwd === undefined) f.cwd = cwd;
        if (model) f.model = model;
        return;
      }
      if (type !== "event_msg") {
        unknown(type);
        emit(base("unknown"));
        return;
      }

      const msg = str(payload.type) ?? "<none>";
      if (IGNORED_EVENT_MSGS.has(msg)) {
        stats.ignored++;
        return;
      }
      switch (msg) {
        case "task_complete":
          if (payload.error !== undefined && payload.error !== null) {
            emit(
              base("error", {
                status: "failure",
                error: { code: "turn-error" },
                ...opt("providerEventId", str(payload.turn_id)),
              }),
            );
          } else {
            emit(base("turn.completed", { ...opt("providerEventId", str(payload.turn_id)) }));
          }
          return;
        case "turn_aborted":
          emit(base("agent.interrupted", { ...opt("providerEventId", str(payload.turn_id)) }));
          return;
        case "token_count":
          onTokenCount(payload, psid, ts);
          return;
        case "item_completed":
          onItem(isObj(payload.item) ? payload.item : {}, psid, ts, offset, base, emit);
          return;
        default:
          unknown(`event_msg:${msg}`);
          emit(base("unknown", { providerEventType: `event_msg:${msg}` }));
      }
    },

    finish(): ParsedChunk {
      return { sessions: facts ? [facts] : [], events, patches, usage, failures, stats };
    },
  };

  function touch(psid: string, ts: string): SessionFacts {
    if (!facts) facts = { provider: PROVIDER, providerSessionId: psid, sourceFile: ctx.sourceFile };
    const t = Date.parse(ts);
    if (facts.firstEventAt === undefined || t < Date.parse(facts.firstEventAt))
      facts.firstEventAt = ts;
    if (facts.lastEventAt === undefined || t >= Date.parse(facts.lastEventAt))
      facts.lastEventAt = ts;
    return facts;
  }

  function onSessionMeta(p: Json, ts: string, offset: number) {
    // Only the file's own session_meta (its first line) defines the session; a later one heads
    // copied parent history in a fork.
    if (ownMetaSeen || offset !== 0) {
      stats.ignored++;
      return;
    }
    ownMetaSeen = true;
    const psid = sessionId ?? str(p.id);
    if (!psid) {
      fail(offset, "missing-field", "session id unknown");
      return;
    }
    const f = touch(psid, str(p.timestamp) ?? ts);
    const source = isObj(p.source) ? p.source : undefined;
    const spawn =
      isObj(source?.subagent) && isObj(source.subagent.thread_spawn)
        ? source.subagent.thread_spawn
        : undefined;
    const parent = str(p.parent_thread_id) ?? str(spawn?.parent_thread_id);
    if (parent) f.parentProviderSessionId = parent;
    cwd = str(p.cwd) ?? cwd;
    if (cwd) f.cwd = cwd;
    const version = str(p.cli_version);
    if (version) f.providerVersion = version;
    const git = isObj(p.git) ? p.git : undefined;
    const branch = str(git?.branch);
    if (branch) {
      f.gitBranchFirst = branch;
      f.gitBranchLast = branch;
    }
    const start = p.subagent_history_start_ordinal;
    if (str(p.forked_from_id) && typeof start === "number" && start > 1) {
      fork = { startOrdinal: start, at: Date.parse(str(p.timestamp) ?? ts) };
    }
    events.push(
      NormalizedEventSchema.parse({
        id: newUlid(Date.parse(ts)),
        schemaVersion: 1,
        provider: PROVIDER,
        providerEventType: "session_meta",
        providerEventId: psid,
        sessionId: psid,
        ...opt("parentSessionId", parent),
        ...opt("providerVersion", version),
        timestamp: ts,
        receivedAt: ctx.receivedAt,
        eventType: "session.started",
        ...opt("cwd", cwd),
        ...opt("gitBranch", branch),
        ...opt("gitHead", str(git?.commit_hash)),
        privacy: {
          promptCaptured: false,
          argumentsCaptured: false,
          resultCaptured: false,
          redactionsApplied: 0,
        },
        sourceRef: { file: ctx.sourceFile, offset, parserVersion: CODEX_PARSER_VERSION },
      }),
    );
  }

  /**
   * Usage from cumulative totals: each new cumulative value contributes its difference from the
   * previous one, so the sum always reconciles with the vendor's own total (PRD §17), and a resumed
   * thread's inherited counter is not counted twice. The first value seen in a pass falls back to
   * that call's own `last_token_usage`. Repeated emissions of the same total collapse on the key,
   * which is scoped to the session.
   */
  function onTokenCount(p: Json, psid: string, ts: string) {
    const info = isObj(p.info) ? p.info : undefined;
    const total = isObj(info?.total_token_usage) ? info.total_token_usage : undefined;
    if (!total || typeof total.total_tokens !== "number") return;
    const cur: Cumulative = {
      total: count(total.total_tokens),
      input: count(total.input_tokens),
      cached: count(total.cached_input_tokens),
      output: count(total.output_tokens),
      reasoning: count(total.reasoning_output_tokens),
    };
    if (prevCumulative && cur.total === prevCumulative.total) return;
    let delta: Omit<Cumulative, "total">;
    if (prevCumulative && cur.total > prevCumulative.total) {
      delta = {
        input: Math.max(0, cur.input - prevCumulative.input),
        cached: Math.max(0, cur.cached - prevCumulative.cached),
        output: Math.max(0, cur.output - prevCumulative.output),
        reasoning: Math.max(0, cur.reasoning - prevCumulative.reasoning),
      };
    } else {
      const last = isObj(info?.last_token_usage) ? info.last_token_usage : {};
      delta = {
        input: count(last.input_tokens),
        cached: count(last.cached_input_tokens),
        output: count(last.output_tokens),
        reasoning: count(last.reasoning_output_tokens),
      };
    }
    prevCumulative = cur;
    usage.push({
      providerSessionId: psid,
      // Session-scoped: cumulative values can coincide across unrelated sessions (identical first
      // calls), and the pipeline treats usage keys as globally unique.
      usageKey: `${psid}:cum:${cur.total}`,
      timestamp: ts,
      ...opt("model", model),
      // OpenAI counts cached input inside input_tokens; Landed keeps them apart.
      inputTokens: Math.max(0, delta.input - delta.cached),
      cachedInputTokens: delta.cached,
      outputTokens: delta.output,
      reasoningTokens: delta.reasoning,
    });
  }

  function onItem(
    item: Json,
    psid: string,
    ts: string,
    offset: number,
    base: EventBuilder,
    emit: (e: NormalizedEvent) => void,
  ) {
    const kind = str(item.type) ?? "<none>";
    const itemId = str(item.id);
    const status = str(item.status);
    if (IGNORED_ITEMS.has(kind)) {
      stats.ignored++;
      return;
    }
    switch (kind) {
      case "UserMessage":
        emit(base("prompt.submitted", { ...opt("providerEventId", itemId) }));
        return;
      case "CommandExecution": {
        const command = commandText(item.command);
        const s = command ? sanitizeCommand(command) : undefined;
        const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
        const failed = status === "failed" || (exitCode !== undefined && exitCode !== 0);
        emit(
          base(failed ? "command.failed" : "command.completed", {
            ...opt("providerEventId", itemId),
            status: failed ? "failure" : "success",
            ...opt("cwd", str(item.cwd) ?? cwd),
            tool: { name: "exec", category: "shell", ...opt("callId", itemId) },
            command: {
              ...opt("executable", s?.executable),
              ...opt("display", s?.display),
              ...opt("exitCode", exitCode),
            },
            privacy: {
              promptCaptured: false,
              argumentsCaptured: false,
              resultCaptured: false,
              redactionsApplied: s?.redactions ?? 0,
            },
          }),
        );
        return;
      }
      case "FileChange":
        onFileChange(item, psid, ts, offset, base, emit);
        return;
      case "McpToolCall": {
        const name = ["mcp", str(item.server) ?? "unknown", str(item.tool) ?? "unknown"].join("__");
        const failed = status === "failed";
        emit(
          base(failed ? "tool.failed" : "tool.completed", {
            ...opt("providerEventId", itemId),
            status: failed ? "failure" : "success",
            tool: { name, category: "mcp", ...opt("callId", itemId) },
          }),
        );
        return;
      }
      case "WebSearch":
        emit(
          base("tool.completed", {
            ...opt("providerEventId", itemId),
            status: "success",
            tool: { name: "web_search", category: "network", ...opt("callId", itemId) },
          }),
        );
        return;
      case "DynamicToolCall":
      case "CollabAgentToolCall": {
        const failed = status === "failed" || item.success === false;
        emit(
          base(failed ? "tool.failed" : "tool.completed", {
            ...opt("providerEventId", itemId),
            status: failed ? "failure" : "success",
            tool: { name: str(item.tool) ?? kind, category: "other", ...opt("callId", itemId) },
          }),
        );
        return;
      }
      case "SubAgentActivity": {
        const activity = str(item.kind);
        // No call id: Codex rarely reports a subagent's end, so a "start" must not leave the
        // parent looking like it has an open tool call.
        const tool = { name: "subagent", category: "other" as const };
        if (activity === "started")
          emit(base("subagent.started", { ...opt("providerEventId", itemId), tool }));
        else if (activity === "completed")
          emit(
            base("subagent.ended", { ...opt("providerEventId", itemId), status: "success", tool }),
          );
        else if (activity === "interrupted")
          emit(
            base("subagent.ended", { ...opt("providerEventId", itemId), status: "failure", tool }),
          );
        else stats.ignored++;
        return;
      }
      default:
        unknown(`item:${kind}`);
        emit(
          base("unknown", { providerEventType: `item:${kind}`, ...opt("providerEventId", itemId) }),
        );
    }
  }

  function onFileChange(
    item: Json,
    psid: string,
    ts: string,
    offset: number,
    base: EventBuilder,
    emit: (e: NormalizedEvent) => void,
  ) {
    const itemId = str(item.id);
    const tool = { name: "apply_patch", category: "file" as const, ...opt("callId", itemId) };
    if (item.status === "declined") {
      emit(
        base("approval.resolved", { ...opt("providerEventId", itemId), status: "denied", tool }),
      );
      return;
    }
    if (item.status !== "completed") {
      emit(base("tool.failed", { ...opt("providerEventId", itemId), status: "failure", tool }));
      return;
    }
    const changes = isObj(item.changes) ? item.changes : {};
    for (const [rawPath, change] of Object.entries(changes)) {
      if (!isObj(change)) continue;
      const original = rawPath.startsWith("/")
        ? rawPath
        : cwd
          ? `${cwd.replace(/\/$/, "")}/${rawPath}`
          : undefined;
      if (!original) continue;
      const moved = str(change.move_path);
      const path = moved
        ? moved.startsWith("/")
          ? moved
          : cwd
            ? `${cwd.replace(/\/$/, "")}/${moved}`
            : original
        : original;
      const kind = str(change.type);
      const added: string[] = [];
      const removed: string[] = [];
      let operation: PatchOperation;
      if (kind === "add") {
        operation = "create";
        const text = str(change.content) ?? str(change.unified_diff) ?? "";
        added.push(...text.split(/\r?\n/));
        if (added.at(-1) === "") added.pop();
      } else if (kind === "update") {
        operation = moved ? "rename" : "modify";
        for (const l of (str(change.unified_diff) ?? "").split(/\r?\n/)) {
          if (l.startsWith("@@")) continue; // hunk header; Codex diffs carry no ---/+++ file headers
          if (l.startsWith("+")) added.push(l.slice(1));
          else if (l.startsWith("-")) removed.push(l.slice(1));
        }
      } else if (kind === "delete") {
        operation = "delete";
      } else {
        continue;
      }
      emit(
        base("edit.applied", {
          ...opt("providerEventId", itemId),
          status: "success",
          tool,
          file: { path, operation: operation === "modify" ? "modify" : operation },
        }),
      );
      if (added.length === 0 && removed.length === 0) continue;
      const fps = ctx.fingerprinter.fingerprintDiff(added, removed);
      patches.push({
        providerSessionId: psid,
        ...opt("toolCallId", itemId),
        timestamp: ts,
        path,
        operation,
        addedLineFps: fps.added,
        removedLineFps: fps.removed,
        addedLineCountRaw: added.length,
        removedLineCountRaw: removed.length,
        sourceRef: { file: ctx.sourceFile, offset, parserVersion: CODEX_PARSER_VERSION },
      });
    }
  }
}

/** `["/bin/zsh", "-lc", "pnpm test"]` → `pnpm test`; other argv forms are joined. */
export function commandText(command: unknown): string | undefined {
  if (typeof command === "string") return command;
  if (!Array.isArray(command) || !command.every((c) => typeof c === "string")) return undefined;
  const argv = command as string[];
  const shell = argv[0]?.split("/").pop();
  if (
    argv.length >= 3 &&
    shell &&
    /^(ba|z|fi|da)?sh$/.test(shell) &&
    /^-\w*c$/.test(argv[1] ?? "")
  ) {
    return argv[2];
  }
  return argv.join(" ");
}

/**
 * `session_index.jsonl`: `{id, thread_name, updated_at}` per line, later lines winning. Yields
 * title-only facts (no timestamps), which update sessions that already exist. Codex writes these
 * names itself, so they are labeled generated.
 */
function createThreadIndexParser(ctx: CodexParserContext): SourceFileParser {
  const titles = new Map<string, string>();
  const failures: FailureDraft[] = [];
  const stats = { lines: 0, ignored: 0, unknownTypes: {} as Record<string, number> };
  return {
    push(line, offset) {
      stats.lines++;
      try {
        const d = JSON.parse(line);
        const id = str(d?.id);
        const name = str(d?.thread_name);
        if (id && name) titles.set(id, name.slice(0, 200));
        else stats.ignored++;
      } catch {
        failures.push({ sourceFile: ctx.sourceFile, offset, reasonCode: "invalid-json" });
      }
    },
    finish() {
      return {
        sessions: [...titles].map(([id, title]) => ({
          provider: PROVIDER,
          providerSessionId: id,
          sourceFile: ctx.sourceFile,
          title,
          titleProvenance: "generated" as const,
        })),
        events: [],
        patches: [],
        usage: [],
        failures,
        stats,
      };
    },
  };
}
