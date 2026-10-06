import { z } from "zod";

export const AgentProviderSchema = z.enum(["claude-code", "codex", "unknown"]);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

/**
 * `completed` requires reliable vendor evidence (PRD §11.1). A process ending is not enough —
 * without evidence the status stays `unknown`.
 */
export const SessionStatusSchema = z.enum([
  "active",
  "completed",
  "failed",
  "interrupted",
  "awaiting-user",
  "abandoned",
  "unknown",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Every claim shown to a user carries one of these (PRD §6.14):
 * observed  — read directly from a source file or git
 * derived   — deterministic computation over observed data
 * inferred  — heuristic that may be wrong
 * generated — produced by an LLM
 */
export const ProvenanceSchema = z.enum(["observed", "derived", "inferred", "generated"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const EventTypeSchema = z.enum([
  "session.started",
  "session.ended",
  "session.awaiting-user",
  "prompt.submitted",
  "turn.completed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "command.started",
  "command.completed",
  "command.failed",
  "file.changed",
  "edit.applied",
  "approval.requested",
  "approval.resolved",
  "usage.reported",
  "subagent.started",
  "subagent.ended",
  "agent.interrupted",
  "error",
  "unknown",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventStatusSchema = z.enum(["started", "success", "failure", "denied", "unknown"]);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const ToolCategorySchema = z.enum(["shell", "file", "search", "mcp", "network", "other"]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const FileOperationSchema = z.enum([
  "read",
  "create",
  "modify",
  "delete",
  "rename",
  "unknown",
]);
export type FileOperation = z.infer<typeof FileOperationSchema>;

export const PatchOperationSchema = z.enum(["create", "modify", "delete", "rename"]);
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const OutcomeClassSchema = z.enum([
  "landed", // matched in a commit after the edit
  "uncommitted", // present in working tree, not committed
  "partial", // some lines matched, below thresholds
  "lost", // nowhere in commits or working tree
  "superseded", // replaced later by the same session (net view hides it)
  "unknown", // repo missing / file outside repo / unreadable / no signal
]);
export type OutcomeClass = z.infer<typeof OutcomeClassSchema>;

/** Why an outcome could not be classified (PRD §12.2). */
export const OutcomeUnknownReasonSchema = z.enum([
  "no-signal", // no significant added lines (pure deletions, whitespace)
  "outside-repo", // the edited file is in no git repository
  "repo-missing", // the repository no longer exists on disk
  "git-error", // git failed or timed out for this repository
  "gitignored", // the file is ignored by the repo (e.g. .env.local, build output), never committed
]);
export type OutcomeUnknownReason = z.infer<typeof OutcomeUnknownReasonSchema>;

export const OutcomeConfidenceSchema = z.enum(["normal", "low"]);
export type OutcomeConfidence = z.infer<typeof OutcomeConfidenceSchema>;

export const OutcomeScopeSchema = z.enum(["patch", "session-file"]);
export type OutcomeScope = z.infer<typeof OutcomeScopeSchema>;

export const SurvivalSchema = z.enum(["surviving", "churned", "reverted", "unknown"]);
export type Survival = z.infer<typeof SurvivalSchema>;

export const UsageCoverageSchema = z.enum(["none", "partial", "complete"]);
export type UsageCoverage = z.infer<typeof UsageCoverageSchema>;

export const CostConfidenceSchema = z.enum(["exact", "estimated"]);
export type CostConfidence = z.infer<typeof CostConfidenceSchema>;

export const ThreadStatusSchema = z.enum(["active", "landed", "dangling", "abandoned", "unknown"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const ThreadLinkKindSchema = z.enum([
  "continuation",
  "same-branch",
  "file-overlap",
  "line-overlap",
]);
export type ThreadLinkKind = z.infer<typeof ThreadLinkKindSchema>;

export const OpenLoopTypeSchema = z.enum([
  "uncommitted-output",
  "unmerged-agent-branch",
  "orphan-worktree",
  "awaiting-user",
  "failed-unresolved",
  "lost-work",
]);
export type OpenLoopType = z.infer<typeof OpenLoopTypeSchema>;

export const OpenLoopStateSchema = z.enum(["open", "dismissed", "resolved"]);
export type OpenLoopState = z.infer<typeof OpenLoopStateSchema>;

export const CollisionKindSchema = z.enum(["concurrent-edit", "overwrite", "possible-duplicate"]);
export type CollisionKind = z.infer<typeof CollisionKindSchema>;

export const InsightTypeSchema = z.enum([
  "repeated-failure",
  "tokens-on-non-landed",
  "overhead-share",
  "stale-session",
  "interrupted-session",
  "failed-session",
  "high-activity",
]);
export type InsightType = z.infer<typeof InsightTypeSchema>;

export const SeveritySchema = z.enum(["info", "warning", "attention"]);
export type Severity = z.infer<typeof SeveritySchema>;
