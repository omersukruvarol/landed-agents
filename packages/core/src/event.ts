import { z } from "zod";
import {
  AgentProviderSchema,
  CostConfidenceSchema,
  EventStatusSchema,
  EventTypeSchema,
  FileOperationSchema,
  ToolCategorySchema,
} from "./enums";
import {
  CountSchema,
  ExternalIdSchema,
  IdSchema,
  NonEmptyStringSchema,
  SourceRefSchema,
  TimestampSchema,
} from "./primitives";

export const UsageSchema = z.strictObject({
  inputTokens: CountSchema.optional(),
  outputTokens: CountSchema.optional(),
  cachedInputTokens: CountSchema.optional(),
  reasoningTokens: CountSchema.optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  costConfidence: CostConfidenceSchema.optional(),
  /** Pricing table version used for an estimate (PRD §17). */
  pricingVersion: NonEmptyStringSchema.optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const EventPrivacySchema = z.strictObject({
  promptCaptured: z.boolean(),
  argumentsCaptured: z.boolean(),
  resultCaptured: z.boolean(),
  redactionsApplied: CountSchema,
});
export type EventPrivacy = z.infer<typeof EventPrivacySchema>;

/**
 * Vendor-neutral event. Vendor payloads are immutable input; this is product truth.
 * Strict: unknown keys are rejected so raw vendor fields can never leak into storage.
 */
export const NormalizedEventSchema = z
  .strictObject({
    id: IdSchema,
    schemaVersion: z.number().int().positive(),

    provider: AgentProviderSchema,
    providerEventId: ExternalIdSchema.optional(),
    providerEventType: NonEmptyStringSchema,
    providerVersion: NonEmptyStringSchema.optional(),

    sessionId: ExternalIdSchema,
    parentSessionId: ExternalIdSchema.optional(),
    userId: ExternalIdSchema.optional(),

    timestamp: TimestampSchema,
    receivedAt: TimestampSchema,
    sequence: CountSchema.optional(),

    eventType: EventTypeSchema,
    status: EventStatusSchema.optional(),

    cwd: NonEmptyStringSchema.optional(),
    repoRoot: NonEmptyStringSchema.optional(),
    repoRemoteHash: NonEmptyStringSchema.optional(),
    projectName: NonEmptyStringSchema.optional(),
    gitBranch: NonEmptyStringSchema.optional(),
    gitHead: NonEmptyStringSchema.optional(),

    model: NonEmptyStringSchema.optional(),

    tool: z
      .strictObject({
        name: NonEmptyStringSchema,
        category: ToolCategorySchema.optional(),
        callId: ExternalIdSchema.optional(),
      })
      .optional(),

    command: z
      .strictObject({
        executable: NonEmptyStringSchema.optional(),
        /** Sanitized, redacted display form — never the raw command line. */
        display: z.string().optional(),
        exitCode: z.number().int().optional(),
      })
      .optional(),

    file: z
      .strictObject({
        path: NonEmptyStringSchema,
        operation: FileOperationSchema.optional(),
      })
      .optional(),

    usage: UsageSchema.optional(),

    error: z
      .strictObject({
        code: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),

    /** Only present when the user explicitly enabled capture (PRD §23). */
    content: z
      .strictObject({
        prompt: z.string().optional(),
        toolArguments: z.unknown().optional(),
        toolResult: z.unknown().optional(),
      })
      .optional(),

    privacy: EventPrivacySchema,

    sourceRef: SourceRefSchema.optional(),
    rawPayloadRef: NonEmptyStringSchema.optional(),
  })
  .superRefine((e, ctx) => {
    // Privacy flags must truthfully describe what the event carries.
    const c = e.content;
    if (c?.prompt !== undefined && !e.privacy.promptCaptured) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "prompt"],
        message: "prompt present but privacy.promptCaptured is false",
      });
    }
    if (c?.toolArguments !== undefined && !e.privacy.argumentsCaptured) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "toolArguments"],
        message: "tool arguments present but privacy.argumentsCaptured is false",
      });
    }
    if (c?.toolResult !== undefined && !e.privacy.resultCaptured) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "toolResult"],
        message: "tool result present but privacy.resultCaptured is false",
      });
    }
  });
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
