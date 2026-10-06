import {
  type AgentProvider,
  type EventStatus,
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
  type ToolCategory,
  type UsageDraft,
} from "@landed/core";
import type { LineFingerprinter } from "@landed/core/fingerprint";
import { newUlid } from "@landed/shared";

/** Bump whenever normalized output for the same input lines changes (forces a re-import). */
export const CLAUDE_PARSER_VERSION = "claude-code@2";

const PROVIDER: AgentProvider = "claude-code";

/** Line types that carry nothing Landed uses (or only content we must not keep). */
const IGNORED_TYPES = new Set([
  "attachment",
  "queue-operation",
  "mode",
  "permission-mode",
  "file-history-snapshot",
  "file-history-delta",
  "bridge-session",
  "frame-link",
  "atis-latch",
  "artifact-autoreact-ledger",
  "artifact-comment-monitor",
  "agent-name",
  "last-prompt", // holds prompt text
  "summary",
  // Recognized but deferred: PR links (Phase 5 outcomes), session continuation (Phase 8 threads).
  "pr-link",
  "continued-in",
]);

const INTERRUPT_MARKER = "[Request interrupted by user";

const SHELL_TOOLS = new Set(["Bash", "BashOutput", "KillShell"]);
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "LS", "ToolSearch"]);
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const ASK_USER_TOOLS = new Set(["AskUserQuestion"]);

export interface ClaudeParserContext {
  sourceFile: string;
  fingerprinter: LineFingerprinter;
  /** When this import pass runs (ISO). */
  receivedAt: string;
}

interface ToolInfo {
  name: string;
  category: ToolCategory;
  executable?: string;
  display?: string;
  redactions: number;
  filePath?: string;
}

type Json = Record<string, unknown>;
type EventBuilder = (eventType: EventType, extra?: Partial<NormalizedEvent>) => NormalizedEvent;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

/** Spread helper: include `key` only when the value is defined (exactOptionalPropertyTypes). */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

export function categorizeTool(name: string): ToolCategory {
  if (SHELL_TOOLS.has(name)) return "shell";
  if (FILE_TOOLS.has(name)) return "file";
  if (SEARCH_TOOLS.has(name)) return "search";
  if (NETWORK_TOOLS.has(name)) return "network";
  if (name.startsWith("mcp__")) return "mcp";
  return "other";
}

/**
 * Parses one Claude Code transcript (main or subagent file). Emits normalized events, patch
 * drafts (fingerprints only), usage drafts and session facts. Prompt text, assistant text,
 * thinking, tool input/output and file contents are read in memory only and never emitted.
 */
export function createClaudeParser(ctx: ClaudeParserContext): SourceFileParser {
  const sessions = new Map<string, SessionFacts>();
  const titles = new Map<string, { title: string; observed: boolean }>();
  const costs = new Map<string, number>();
  const tools = new Map<string, ToolInfo>();
  const usage = new Map<string, UsageDraft>();
  const events: NormalizedEvent[] = [];
  const patches: PatchDraft[] = [];
  const failures: FailureDraft[] = [];
  const stats = { lines: 0, ignored: 0, unknownTypes: {} as Record<string, number> };

  const fail = (offset: number, reasonCode: string, message?: string) =>
    failures.push({ sourceFile: ctx.sourceFile, offset, reasonCode, ...opt("message", message) });

  return {
    push(line, offset) {
      stats.lines++;
      if (line.trim() === "") return;
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
      const sessionId = str(d.sessionId);

      // Metadata lines without timestamps.
      if (type === "custom-title" || type === "ai-title") {
        const title = str(type === "custom-title" ? d.customTitle : d.aiTitle);
        if (sessionId && title) {
          const prev = titles.get(sessionId);
          // A user-set title outranks an AI-generated one.
          if (!prev || type === "custom-title" || !prev.observed) {
            titles.set(sessionId, {
              title: title.slice(0, 200),
              observed: type === "custom-title",
            });
          }
        }
        return;
      }
      if (type === "cost-state") {
        const cost = num(d.totalCostUSD);
        if (sessionId && cost !== undefined) costs.set(sessionId, cost);
        return;
      }
      if (IGNORED_TYPES.has(type)) {
        stats.ignored++;
        return;
      }

      const ts = str(d.timestamp);
      if (!sessionId || !ts) {
        if (type === "user" || type === "assistant" || type === "system") {
          fail(offset, "missing-field", "sessionId or timestamp missing");
        } else {
          stats.unknownTypes[type] = (stats.unknownTypes[type] ?? 0) + 1;
        }
        return;
      }
      if (!TimestampSchema.safeParse(ts).success) {
        fail(offset, "invalid-timestamp");
        return;
      }

      // Subagent lines carry the parent's sessionId plus their own agentId.
      const agentId = d.isSidechain === true ? str(d.agentId) : undefined;
      const psid = agentId ? `${sessionId}:${agentId}` : sessionId;
      const parent = agentId ? sessionId : undefined;
      const facts = touchSession(psid, parent, d, ts);

      const base: EventBuilder = (eventType, extra = {}) => ({
        id: newUlid(Date.parse(ts)),
        schemaVersion: 1,
        provider: PROVIDER,
        providerEventType: type,
        sessionId: psid,
        ...opt("parentSessionId", parent),
        ...opt("providerEventId", str(d.uuid)),
        ...opt("providerVersion", str(d.version)),
        timestamp: ts,
        receivedAt: ctx.receivedAt,
        eventType,
        ...opt("cwd", str(d.cwd)),
        ...opt("gitBranch", str(d.gitBranch)),
        privacy: {
          promptCaptured: false,
          argumentsCaptured: false,
          resultCaptured: false,
          redactionsApplied: 0,
        },
        sourceRef: { file: ctx.sourceFile, offset, parserVersion: CLAUDE_PARSER_VERSION },
        ...extra,
      });
      const emit = (e: NormalizedEvent) => {
        const r = NormalizedEventSchema.safeParse(e);
        if (r.success) events.push(r.data);
        else fail(offset, "schema-mismatch", r.error.issues[0]?.path.join(".") ?? "event");
      };

      if (type === "assistant") onAssistant(d, ts, psid, facts, base, emit);
      else if (type === "user") onUser(d, offset, ts, psid, base, emit);
      else if (type === "system") onSystem(d, base, emit);
      else {
        stats.unknownTypes[type] = (stats.unknownTypes[type] ?? 0) + 1;
        emit(base("unknown"));
      }
    },

    finish(): ParsedChunk {
      for (const [sid, t] of titles) {
        for (const facts of sessionsFor(sid)) {
          facts.title = t.title;
          facts.titleProvenance = t.observed ? "observed" : "generated";
        }
      }
      for (const [sid, cost] of costs) {
        for (const facts of sessionsFor(sid))
          if (!facts.parentProviderSessionId) facts.estimatedCostUsd = cost;
      }
      return {
        sessions: [...sessions.values()],
        events,
        patches,
        usage: [...usage.values()],
        failures,
        stats,
      };
    },
  };

  /** Facts for a main session id, creating a timestamp-less entry for metadata-only passes. */
  function sessionsFor(sessionId: string): SessionFacts[] {
    let facts = sessions.get(sessionId);
    if (!facts) {
      facts = { provider: PROVIDER, providerSessionId: sessionId, sourceFile: ctx.sourceFile };
      sessions.set(sessionId, facts);
    }
    return [facts];
  }

  function touchSession(
    psid: string,
    parent: string | undefined,
    d: Json,
    ts: string,
  ): SessionFacts {
    let f = sessions.get(psid);
    if (!f) {
      f = {
        provider: PROVIDER,
        providerSessionId: psid,
        ...opt("parentProviderSessionId", parent),
        sourceFile: ctx.sourceFile,
      };
      sessions.set(psid, f);
    }
    const t = Date.parse(ts);
    if (f.firstEventAt === undefined || t < Date.parse(f.firstEventAt)) f.firstEventAt = ts;
    if (f.lastEventAt === undefined || t >= Date.parse(f.lastEventAt)) {
      f.lastEventAt = ts;
      const branch = str(d.gitBranch);
      if (branch) f.gitBranchLast = branch;
    }
    const cwd = str(d.cwd);
    if (cwd && f.cwd === undefined) f.cwd = cwd;
    const branch = str(d.gitBranch);
    if (branch && f.gitBranchFirst === undefined) f.gitBranchFirst = branch;
    const version = str(d.version);
    if (version) f.providerVersion = version;
    return f;
  }

  function onAssistant(
    d: Json,
    ts: string,
    psid: string,
    facts: SessionFacts,
    base: EventBuilder,
    emit: (e: NormalizedEvent) => void,
  ) {
    const m = isObj(d.message) ? d.message : {};
    const model = str(m.model);
    const synthetic = model === "<synthetic>";
    if (model && !synthetic) facts.model = model;

    if (d.isApiErrorMessage === true) {
      emit(
        base("error", {
          status: "failure",
          error: { ...opt("code", str(d.apiErrorStatus) ?? "api-error") },
        }),
      );
      return;
    }

    const u = isObj(m.usage) ? m.usage : undefined;
    const key = str(m.id) ?? str(d.requestId);
    if (u && key && !synthetic) {
      const draft: UsageDraft = {
        providerSessionId: psid,
        usageKey: key,
        timestamp: ts,
        ...opt("model", model),
        inputTokens: (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0),
        ...opt("outputTokens", num(u.output_tokens)),
        ...opt("cachedInputTokens", num(u.cache_read_input_tokens)),
      };
      const prev = usage.get(key);
      usage.set(key, prev ? maxUsage(prev, draft) : draft);
    }

    const extraModel = model && !synthetic ? { model } : {};
    for (const block of Array.isArray(m.content) ? m.content : []) {
      if (!isObj(block) || block.type !== "tool_use") continue;
      const callId = str(block.id);
      const name = str(block.name) ?? "unknown";
      const input = isObj(block.input) ? block.input : {};
      const info = describeTool(name, input);
      if (callId) tools.set(callId, info);
      const tool = { name, category: info.category, ...opt("callId", callId) };
      const privacy = {
        promptCaptured: false,
        argumentsCaptured: false,
        resultCaptured: false,
        redactionsApplied: info.redactions,
      };
      if (info.category === "shell") {
        emit(
          base("command.started", {
            ...extraModel,
            status: "started",
            tool,
            command: { ...opt("executable", info.executable), ...opt("display", info.display) },
            privacy,
          }),
        );
      } else if (SUBAGENT_TOOLS.has(name)) {
        emit(base("subagent.started", { ...extraModel, status: "started", tool }));
      } else {
        emit(
          base("tool.started", {
            ...extraModel,
            status: "started",
            tool,
            ...opt("file", info.filePath ? { path: info.filePath } : undefined),
          }),
        );
        if (ASK_USER_TOOLS.has(name)) emit(base("session.awaiting-user", { tool }));
      }
    }

    if (m.stop_reason === "end_turn" && key) {
      // Split lines of one API message share the id; dedupe the turn on it.
      emit(base("turn.completed", { ...extraModel, providerEventId: key }));
    }
  }

  function onUser(
    d: Json,
    offset: number,
    ts: string,
    psid: string,
    base: EventBuilder,
    emit: (e: NormalizedEvent) => void,
  ) {
    if (d.isMeta === true || d.isCompactSummary === true) return;
    if (d.interruptedByShutdown === true) {
      emit(base("agent.interrupted"));
      return;
    }
    const m = isObj(d.message) ? d.message : {};
    const content = m.content;
    const blocks = Array.isArray(content) ? content.filter(isObj) : [];
    const results = blocks.filter((b) => b.type === "tool_result");

    if (results.length === 0) {
      const texts =
        typeof content === "string"
          ? [content]
          : blocks
              .filter((b) => b.type === "text")
              .map((b) => (typeof b.text === "string" ? b.text : ""));
      if (texts.some((t) => t.startsWith(INTERRUPT_MARKER))) emit(base("agent.interrupted"));
      else emit(base("prompt.submitted"));
      return;
    }

    for (const block of results) {
      const callId = str(block.tool_use_id);
      const info = (callId && tools.get(callId)) || inferTool(d.toolUseResult);
      const tool = { name: info.name, category: info.category, ...opt("callId", callId) };
      if (str(d.toolDenialKind)) {
        emit(base("approval.resolved", { status: "denied", tool }));
        continue;
      }
      const failed = block.is_error === true;
      const status: EventStatus = failed ? "failure" : "success";
      const resultText = resultTextOf(block.content);
      if (resultText.startsWith(INTERRUPT_MARKER)) {
        emit(base("agent.interrupted", { tool }));
        continue;
      }
      if (info.category === "shell") {
        emit(
          base(failed ? "command.failed" : "command.completed", {
            status,
            tool,
            command: { ...opt("executable", info.executable), ...opt("display", info.display) },
            privacy: {
              promptCaptured: false,
              argumentsCaptured: false,
              resultCaptured: false,
              redactionsApplied: info.redactions,
            },
          }),
        );
      } else if (SUBAGENT_TOOLS.has(info.name)) {
        emit(base("subagent.ended", { status, tool }));
      } else {
        emit(
          base(failed ? "tool.failed" : "tool.completed", {
            status,
            tool,
            ...opt("file", info.filePath ? { path: info.filePath } : undefined),
          }),
        );
      }
      if (!failed) {
        const patch = patchFrom(d.toolUseResult, psid, ts, offset, callId);
        if (patch) {
          patches.push(patch);
          emit(
            base("edit.applied", {
              status: "success",
              tool,
              file: {
                path: patch.path,
                operation: patch.operation === "create" ? "create" : "modify",
              },
            }),
          );
        }
      }
    }
  }

  function onSystem(d: Json, base: EventBuilder, emit: (e: NormalizedEvent) => void) {
    if (d.subtype === "api_error") {
      emit(base("error", { status: "failure", error: { code: "api-error" } }));
    } else {
      stats.ignored++;
    }
  }

  function patchFrom(
    r: unknown,
    psid: string,
    ts: string,
    offset: number,
    callId: string | undefined,
  ): PatchDraft | undefined {
    if (!isObj(r)) return undefined;
    const path = str(r.filePath);
    if (!path?.startsWith("/") || !Array.isArray(r.structuredPatch)) return undefined;
    const added: string[] = [];
    const removed: string[] = [];
    for (const hunk of r.structuredPatch) {
      if (!isObj(hunk) || !Array.isArray(hunk.lines)) continue;
      for (const l of hunk.lines) {
        if (typeof l !== "string") continue;
        if (l.startsWith("+")) added.push(l.slice(1));
        else if (l.startsWith("-")) removed.push(l.slice(1));
      }
    }
    let operation: PatchOperation = "modify";
    if (r.type === "create") {
      operation = "create";
      if (added.length === 0 && typeof r.content === "string") {
        added.push(...r.content.split(/\r?\n/));
        if (added.at(-1) === "") added.pop();
      }
    }
    if (added.length === 0 && removed.length === 0) return undefined;
    const fps = ctx.fingerprinter.fingerprintDiff(added, removed);
    return {
      providerSessionId: psid,
      ...opt("toolCallId", callId),
      timestamp: ts,
      path,
      operation,
      addedLineFps: fps.added,
      removedLineFps: fps.removed,
      addedLineCountRaw: added.length,
      removedLineCountRaw: removed.length,
      sourceRef: { file: ctx.sourceFile, offset, parserVersion: CLAUDE_PARSER_VERSION },
    };
  }
}

function describeTool(name: string, input: Json): ToolInfo {
  const category = categorizeTool(name);
  if (category === "shell") {
    const command = str(input.command);
    if (!command) return { name, category, redactions: 0 };
    const s = sanitizeCommand(command);
    return {
      name,
      category,
      ...opt("executable", s.executable),
      display: s.display,
      redactions: s.redactions,
    };
  }
  const filePath = str(input.file_path) ?? str(input.notebook_path);
  return {
    name,
    category,
    ...opt("filePath", filePath?.startsWith("/") ? filePath : undefined),
    redactions: 0,
  };
}

/** When the tool_use was in an earlier pass, guess the tool family from the result's shape. */
function inferTool(r: unknown): ToolInfo {
  if (isObj(r) && ("stdout" in r || "stderr" in r))
    return { name: "unknown", category: "shell", redactions: 0 };
  if (isObj(r) && typeof r.filePath === "string") {
    return { name: "unknown", category: "file", filePath: r.filePath, redactions: 0 };
  }
  return { name: "unknown", category: "other", redactions: 0 };
}

function resultTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const first = content.find((c) => isObj(c) && c.type === "text");
    return isObj(first) && typeof first.text === "string" ? first.text : "";
  }
  return "";
}

function maxUsage(a: UsageDraft, b: UsageDraft): UsageDraft {
  const pick = (x?: number, y?: number) =>
    x === undefined ? y : y === undefined ? x : Math.max(x, y);
  return {
    ...a,
    ...opt("model", a.model ?? b.model),
    ...opt("inputTokens", pick(a.inputTokens, b.inputTokens)),
    ...opt("outputTokens", pick(a.outputTokens, b.outputTokens)),
    ...opt("cachedInputTokens", pick(a.cachedInputTokens, b.cachedInputTokens)),
  };
}

/** The provider this importer produces, for callers that must not hard-code vendor names. */
export const CLAUDE_PROVIDER = PROVIDER;
