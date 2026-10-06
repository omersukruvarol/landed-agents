import type { AgentProvider, PatchOperation, Provenance, SessionStatus } from "./enums";
import type { NormalizedEvent } from "./event";
import type { SourceRef } from "./primitives";

/**
 * Contract between vendor importers and the vendor-neutral ingest pipeline. Importers turn raw
 * session-file lines into these drafts; the pipeline resolves repos, assigns internal ids and
 * persists. Drafts never carry prompt text, code or tool output.
 */

/** What one parse pass observed about a session. Merged with what is already stored. */
export interface SessionFacts {
  provider: AgentProvider;
  providerSessionId: string;
  /** Vendor id of the parent session, for subagents. */
  parentProviderSessionId?: string;
  /** Absent when the pass only saw metadata lines (e.g. a title change) for this session. */
  firstEventAt?: string;
  lastEventAt?: string;
  cwd?: string;
  gitBranchFirst?: string;
  gitBranchLast?: string;
  model?: string;
  providerVersion?: string;
  title?: string;
  titleProvenance?: Provenance;
  /** A status the vendor states directly. Usually absent; the pipeline derives status from events. */
  status?: SessionStatus;
  estimatedCostUsd?: number;
  sourceFile: string;
}

export interface PatchDraft {
  providerSessionId: string;
  toolCallId?: string;
  timestamp: string;
  /** Absolute path as recorded by the agent. */
  path: string;
  operation: PatchOperation;
  addedLineFps: string[];
  removedLineFps: string[];
  addedLineCountRaw: number;
  removedLineCountRaw: number;
  sourceRef: SourceRef;
}

export interface UsageDraft {
  providerSessionId: string;
  /** Provider dedupe key, e.g. an API message id or a turn id. */
  usageKey: string;
  timestamp: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export interface FailureDraft {
  sourceFile: string;
  offset: number;
  /** Machine-readable, e.g. "invalid-json", "missing-field", "invalid-timestamp". */
  reasonCode: string;
  /** Short and content-free: never include the line itself. */
  message?: string;
}

export interface ParseStats {
  lines: number;
  /** Known line types that carry nothing Landed uses. */
  ignored: number;
  /** Line types this parser version does not recognize, by type name. */
  unknownTypes: Record<string, number>;
}

export interface ParsedChunk {
  sessions: SessionFacts[];
  events: NormalizedEvent[];
  patches: PatchDraft[];
  usage: UsageDraft[];
  failures: FailureDraft[];
  stats: ParseStats;
}

/** How many leading bytes of a line `SourceFileParser.skipLine` is shown. */
export const LINE_HEAD_BYTES = 256;

/** Stateful parser for one pass over one source file. */
export interface SourceFileParser {
  /** Feed one complete line (without the newline) that starts at byte `offset`. */
  push(line: string, offset: number): void;
  /**
   * Optional fast path. Given the first bytes of a line (up to `LINE_HEAD_BYTES`), return true to
   * skip it: the reader then neither buffers nor decodes the rest, which keeps multi-hundred-MB
   * lines out of memory. A skipped line still counts as read; the parser accounts for it.
   */
  skipLine?(head: string): boolean;
  finish(): ParsedChunk;
}

/**
 * A live signal from a vendor hook. Hooks add what session files lack (a pending permission
 * request, a session end) and point at the transcript to import right away. Built from ids and
 * event names only — hook payloads also carry prompts and tool input, which are never kept.
 */
export interface HookSignal {
  provider: AgentProvider;
  providerSessionId: string;
  hookEvent: string;
  /** The session file to import immediately, when the hook names it. */
  transcriptPath?: string;
  events: NormalizedEvent[];
}
